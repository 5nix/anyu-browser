import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CITY_ACCURACY, COUNTRIES, identityPatch, proposeIdentity } from '../../src/shared/identity.ts';
import { defaultProfile, validateProfile } from '../../src/shared/profile.ts';

const current = { timezone: 'Asia/Shanghai', locale: 'zh-CN', acceptLanguages: ['zh-CN', 'zh'] };

test('a known site in the measured country proposes its zone, languages and a city rounded to one decimal', () => {
  const p = proposeIdentity('JP', 'NRT');
  assert.equal(p.timezone, 'Asia/Tokyo');
  assert.deepEqual(p.languages, ['ja-JP', 'ja']);
  assert.deepEqual(p.city && { lat: p.city.latitude, lon: p.city.longitude, name: p.city.name }, { lat: 35.7, lon: 139.7, name: 'Tokyo' });
  assert.deepEqual(identityPatch(p, { timezone: p.timezone, languages: 'exit', location: 'city' }, current), {
    timezone: 'Asia/Tokyo', locale: 'ja-JP', acceptLanguages: ['ja-JP', 'ja'], geolocation: { latitude: 35.7, longitude: 139.7, accuracy: CITY_ACCURACY },
  });
  const us = proposeIdentity('US', 'LAX');
  assert.equal(us.timezone, 'America/Los_Angeles');
  assert.ok(us.timezones.length > 1 && us.timezones.includes('America/New_York'));
});

test('an unknown site, or one in another country, proposes no city: location denied, the most populous zone', () => {
  for (const colo of ['', 'ZZZ', 'NRT']) {
    const p = proposeIdentity('US', colo);
    assert.equal(p.city, null, colo);
    assert.equal(p.timezone, 'America/New_York');
    assert.deepEqual(p.languages, ['en-US', 'en']);
    assert.equal(identityPatch(p, { timezone: p.timezone, languages: 'exit', location: 'city' }, current).geolocation, null);
  }
  assert.equal(proposeIdentity('JP', '').timezone, 'Asia/Tokyo');
  assert.equal(proposeIdentity('RU', '').timezone, 'Europe/Moscow');
});

test('regions Intl does not know propose nothing and keep the current values', () => {
  const p = proposeIdentity('QM', '');
  assert.equal(p.timezone, '');
  assert.deepEqual(identityPatch(p, { timezone: '', languages: 'exit', location: 'deny' }, current), { timezone: 'Asia/Shanghai', locale: 'zh-CN', acceptLanguages: ['zh-CN', 'zh'], geolocation: null });
});

test('language choices: the exit’s, the exit’s first then the current one, or unchanged', () => {
  const p = proposeIdentity('JP', 'NRT');
  assert.deepEqual(identityPatch(p, { timezone: '', languages: 'both', location: 'deny' }, current).acceptLanguages, ['ja-JP', 'zh-CN']);
  assert.deepEqual(identityPatch(p, { timezone: '', languages: 'keep', location: 'deny' }, current), { timezone: 'Asia/Tokyo', locale: 'zh-CN', acceptLanguages: ['zh-CN', 'zh'], geolocation: null });
});

test('every offered country is a valid exit country for the profile', () => {
  const base = defaultProfile('en', 'UTC');
  assert.ok(COUNTRIES.length > 240);
  assert.equal(new Set(COUNTRIES).size, COUNTRIES.length);
  for (const code of COUNTRIES) assert.equal(validateProfile({ ...base, egressCountry: code }, base).egressCountry, code);
  for (const code of ['JP', 'US', 'HK', 'TW', 'SG', 'DE']) assert.ok(COUNTRIES.includes(code));
});
