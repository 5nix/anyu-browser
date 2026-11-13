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

test('independent core egress is opt-in and survives profile normalization', () => {
  assert.equal(defaultProfile('en', 'UTC').bypassHostTun, false);
  assert.equal(normalizeProfile({}, base).bypassHostTun, false);
  assert.equal(normalizeProfile({ bypassHostTun: 'true' }, base).bypassHostTun, false);
  assert.equal(normalizeProfile({ bypassHostTun: true }, base).bypassHostTun, true);
  assert.equal(validateProfile({ bypassHostTun: false }, { ...base, bypassHostTun: true }).bypassHostTun, false);
});

test('languagesFor adds the base language', () => {
  assert.deepEqual(languagesFor('de-DE'), ['de-DE', 'de']);
  assert.deepEqual(languagesFor('en'), ['en']);
});

test('subscription fetch route survives migration', () => {
  const node = { name: 'a', type: 'ss' };
  const p = normalizeProfile({ proxy: { subscriptionUrl: 'https://example.com', subscriptionVia: 'proxy', selectedNode: 'a' } }, base, [node]);
  assert.equal(p.proxy.sources[0].origin.kind, 'subscription');
  assert.deepEqual(p.proxy.selected, { source: 'legacy', node: 'a' });
});

test('stored garbage yields safe defaults', () => {
  const p = normalizeProfile({ timezone: 'bad', egressCountry: 'XXX', platform: 'linux', acceptLanguages: [], proxy: 3 }, base);
  assert.equal(p.egressCountry, '');
  assert.equal(p.platform, 'host');
  assert.deepEqual(p.proxy, { sources: [], selected: null });
  assert.deepEqual(normalizeProfile(null, base).proxy, { sources: [], selected: null });
});

test('profile errors follow the selected language', async () => {
  const { setLocale } = await import('../../src/shared/i18n/index.ts');
  setLocale('en');
  try { assert.throws(() => validateProfile(null, defaultProfile('en-US', 'UTC')), /must be a JSON object/); }
  finally { setLocale('zh'); }
});

test('a saved profile validation error can be translated after a locale change', async () => {
  const { setLocale } = await import('../../src/shared/i18n/index.ts');
  const { ProfileError } = await import('../../src/shared/profile.ts');
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
