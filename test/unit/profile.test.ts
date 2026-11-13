import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfile, normalizeProfile, validateProfile, languagesFor, ProfileError } from '../../src/shared/profile.ts';

const base = defaultProfile('zh-CN', 'UTC');

test('default profile keeps the gate closed and never invents a location', () => {
  assert.equal(base.egressCountry, '');
  assert.equal(base.geolocation, null);
  assert.equal(base.platform, 'host');
  assert.equal(base.notifications, false);
  assert.deepEqual(base.acceptLanguages, ['zh-CN', 'zh']);
});

test('bad host values fall back to safe defaults', () => {
  const p = defaultProfile('not a locale!!', 'Mars/Olympus');
  assert.equal(p.locale, 'en');
  assert.equal(p.timezone, 'UTC');
});

test('normalize: locale leads accept-languages, country is uppercased', () => {
  const p = normalizeProfile({ locale: 'en-US', acceptLanguages: ['en', 'en-US', 'ja'], egressCountry: ' qm ' }, base);
  assert.deepEqual(p.acceptLanguages, ['en-US', 'en', 'ja']);
  assert.equal(p.egressCountry, 'QM');
});

test('normalize: geolocation counts only when complete and in range', () => {
  const ok = { latitude: 1, longitude: 2, accuracy: 30 };
  assert.deepEqual(normalizeProfile({ geolocation: ok }, base).geolocation, ok);
  assert.equal(normalizeProfile({ geolocation: { latitude: 1, longitude: 2 } }, base).geolocation, null);
  assert.equal(normalizeProfile({ geolocation: { latitude: 91, longitude: 0, accuracy: 10 } }, base).geolocation, null);
  assert.equal(normalizeProfile({ geolocation: 'here' }, base).geolocation, null);
});

test('normalize: rejects invalid values with a field-specific error', () => {
  assert.throws(() => validateProfile({ timezone: 'Nowhere/Land' }, base), ProfileError);
  assert.throws(() => validateProfile({ egressCountry: 'XXX' }, base), /egressCountry/);
  assert.throws(() => validateProfile({ platform: 'linux' }, base), /platform/);
  assert.throws(() => validateProfile({ acceptLanguages: [] }, base), /acceptLanguages/);
  assert.throws(() => validateProfile([], base), ProfileError);
});

test('normalize: unknown keys are dropped, booleans must be true to enable', () => {
  const p = normalizeProfile({ extra: 1, notifications: 'yes', allowPrivateNetwork: true }, base) as unknown as Record<string, unknown>;
  assert.equal(p.extra, undefined);
  assert.equal(p.notifications, false);
  assert.equal(p.allowPrivateNetwork, true);
});

test('connection mode defaults to system and survives normalization', () => {
  assert.equal(base.connectionMode, 'system');
  assert.equal(normalizeProfile({}, base).connectionMode, 'system');
  assert.equal(normalizeProfile({ connectionMode: 'external' }, base).connectionMode, 'external');
  assert.equal(normalizeProfile({ connectionMode: 'bogus' }, base).connectionMode, 'system');
  assert.throws(() => validateProfile({ connectionMode: 'bogus' }, base), /connectionMode/);
});

test('legacy bypassHostTun migrates to independent mode', () => {
  assert.equal(normalizeProfile({ bypassHostTun: true }, base).connectionMode, 'independent');
  assert.equal(normalizeProfile({ bypassHostTun: 'true' }, base).connectionMode, 'system');
  assert.equal(validateProfile({ bypassHostTun: true }, base).connectionMode, 'independent');
  assert.equal(validateProfile({ connectionMode: 'system', bypassHostTun: true }, base).connectionMode, 'system');
});

test('external proxy and monitor URL list are validated', () => {
  const p = normalizeProfile({ externalProxy: { protocol: 'http', host: ' 127.0.0.1 ', port: 7890, username: 'u', password: 'x' }, monitorUrls: [' https://example.com/trace ', 'https://example.com/trace', 'https://other.example/trace'] }, base);
  assert.deepEqual(p.externalProxy, { protocol: 'http', host: '127.0.0.1', port: 7890, username: 'u', password: 'x' });
  // Entries are trimmed and deduplicated.
  assert.deepEqual(p.monitorUrls, ['https://example.com/trace', 'https://other.example/trace']);
  // A malformed endpoint falls back to the safe default instead of enabling a capability.
  assert.equal(normalizeProfile({ externalProxy: { protocol: 'socks5', host: '127.0.0.1', port: 70000, username: '', password: '' } }, base).externalProxy.port, 0);
  // Plaintext is not accepted: the monitor answers are what open the gate. One bad entry
  // drops the whole stored list back to the default endpoint instead of silently narrowing it.
  assert.deepEqual(normalizeProfile({ monitorUrls: ['https://example.com/trace', 'http://example.com/trace'] }, base).monitorUrls, []);
  assert.throws(() => validateProfile({ externalProxy: { protocol: 'socks5', host: '127.0.0.1', port: -1, username: '', password: '' } }, base), /externalProxy/);
  assert.throws(() => validateProfile({ monitorUrls: ['not a url'] }, base), /monitorUrls/);
  assert.throws(() => validateProfile({ monitorUrls: ['http://example.com/trace'] }, base), /monitorUrls/);
  assert.throws(() => validateProfile({ monitorUrls: Array(11).fill('https://example.com/trace') }, base), /monitorUrls/);
  // The previous build's single monitorUrl migrates into the list.
  assert.deepEqual(normalizeProfile({ monitorUrl: 'https://example.com/trace' }, base).monitorUrls, ['https://example.com/trace']);
  assert.deepEqual(validateProfile({ monitorUrls: [] }, base).monitorUrls, []);
});

test('languagesFor adds the base language', () => {
  assert.deepEqual(languagesFor('de-DE'), ['de-DE', 'de']);
  assert.deepEqual(languagesFor('en'), ['en']);
});

test('stored garbage yields safe defaults', () => {
  const p = normalizeProfile({ timezone: 'bad', egressCountry: 'XXX', platform: 'linux', acceptLanguages: [], proxy: 3 }, base);
  assert.equal(p.egressCountry, '');
  assert.equal(p.platform, 'host');
  assert.deepEqual(p.proxy, { sources: [], selected: null });
  assert.deepEqual(normalizeProfile(null, base).proxy, { sources: [], selected: null });
});

test('a saved profile validation error can be translated after a locale change', async () => {
  const { setLocale } = await import('../../src/shared/i18n/index.ts');
  setLocale('zh');
  try {
    let error: unknown;
    try { validateProfile(null, defaultProfile('en-US', 'UTC')); } catch (e) { error = e; }
    assert.ok(error instanceof ProfileError);
    assert.equal(error.localized(), 'profile.json 必须是一个 JSON 对象');
    setLocale('en');
    assert.equal(error.localized(), 'profile.json must be a JSON object');
  } finally { setLocale('zh'); }
});
