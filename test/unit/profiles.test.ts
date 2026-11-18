import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACCENTS, type Accent } from '../../src/shared/appearance.ts';
import {
  DEFAULT_PROFILE_ID,
  MAX_PROFILES,
  MAX_PROFILE_NAME_LENGTH,
  defaultProfilesRegistry,
  isValidProfileId,
  normalizeProfilesRegistry,
  parseProfileCliArg,
  pickNextAccent,
  sanitizeProfileName,
} from '../../src/shared/profiles.ts';

test('profile IDs are restricted to safe directory segments', () => {
  for (const id of ['default', 'prof_a1b2c3d4', `prof_${'a'.repeat(24)}`]) {
    assert.equal(isValidProfileId(id), true);
  }
  for (const id of [
    '../evil', 'prof_UPPER123', 'prof_short', '', 'prof_a1b2c3d4\n',
    'prof_a1b2/c3d4', 'prof_a1b2.c3d4', `prof_${'a'.repeat(25)}`, null, 12345678,
  ]) {
    assert.equal(isValidProfileId(id), false, JSON.stringify(id));
  }
});

test('profile names remove control characters and normalize spaces', () => {
  assert.equal(sanitizeProfileName('  Wo\x00rk\x7f\x85   Profile  '), 'Work Profile');
  const longest = 'a'.repeat(MAX_PROFILE_NAME_LENGTH);
  assert.equal(sanitizeProfileName(` ${longest} `), longest);
  for (const name of ['', ' \t\x00 ', `${longest}a`, null, 42]) {
    assert.equal(sanitizeProfileName(name), null);
  }
});

test('accent selection cycles through the ordered palette and balances usage', () => {
  const existing: { accent: Accent }[] = [];
  for (const accent of [...ACCENTS, ...ACCENTS]) {
    assert.equal(pickNextAccent(existing), accent);
    existing.push({ accent });
  }
  assert.equal(pickNextAccent([{ accent: 'teal' }, { accent: 'indigo' }]), 'blue');
});

test('registry normalization recovers from missing or malformed data', () => {
  const expected = {
    version: 1,
    lastActiveId: DEFAULT_PROFILE_ID,
    entries: [{ id: DEFAULT_PROFILE_ID, name: 'Primary', accent: 'teal', createdAt: 100 }],
  };
  assert.deepEqual(defaultProfilesRegistry(' Primary ', 100), expected);
  assert.equal(defaultProfilesRegistry(' ', 100).entries[0].name, 'Default');
  for (const input of [null, [], 'corrupt', { entries: {} }, { entries: [null, 1, []] }]) {
    assert.deepEqual(normalizeProfilesRegistry(input, ' Primary ', 100), expected);
  }
});

test('registry normalization preserves valid profiles and repairs invalid fields', () => {
  const active = { id: 'prof_a1b2c3d4', name: 'Work', accent: 'indigo', createdAt: 0 };
  const entries = [
    { id: '../evil', name: 'Invalid ID' },
    { id: active.id, name: '  ' },
    { ...active, name: ' Work ' },
    { ...active, name: 'Duplicate' },
    { id: 'prof_e5f6g7h8', name: 'Personal', accent: 'invalid', createdAt: -1 },
    { id: 'prof_i9j0k1l2', name: 'Travel', accent: 'blue', createdAt: Infinity },
  ];
  const normalized = normalizeProfilesRegistry({ entries, lastActiveId: active.id }, 'Primary', 100);
  assert.deepEqual(normalized, {
    version: 1,
    lastActiveId: active.id,
    entries: [
      { id: DEFAULT_PROFILE_ID, name: 'Primary', accent: 'teal', createdAt: 100 },
      active,
      { id: 'prof_e5f6g7h8', name: 'Personal', accent: 'teal', createdAt: 100 },
      { id: 'prof_i9j0k1l2', name: 'Travel', accent: 'blue', createdAt: 100 },
    ],
  });
  assert.equal(normalizeProfilesRegistry({ entries, lastActiveId: 'prof_missing0' }).lastActiveId, DEFAULT_PROFILE_ID);
});

test('registry normalization reserves a default slot at capacity', () => {
  const entries = Array.from({ length: MAX_PROFILES + 1 }, (_, index) => ({
    id: `prof_${String(index).padStart(8, '0')}`,
    name: `Profile ${index}`,
    accent: 'teal',
    createdAt: index,
  }));
  const kept = entries.slice(0, MAX_PROFILES - 1);
  const lastActiveId = entries[MAX_PROFILES - 1].id;
  const withoutDefault = normalizeProfilesRegistry({ entries, lastActiveId }, 'Primary', 100);
  assert.equal(withoutDefault.entries[0].id, DEFAULT_PROFILE_ID);
  assert.deepEqual(withoutDefault.entries.slice(1), kept);
  assert.equal(withoutDefault.lastActiveId, DEFAULT_PROFILE_ID);

  const existingDefault = { id: DEFAULT_PROFILE_ID, name: 'Original', accent: 'moss', createdAt: 5 };
  const withDefault = normalizeProfilesRegistry({ entries: [...entries, existingDefault] }, 'Primary', 100);
  assert.deepEqual(withDefault.entries, [...kept, existingDefault]);
});

test('CLI profile selection accepts the first exact flag with a valid ID', () => {
  assert.equal(parseProfileCliArg(['anyu', '--profile-id=prof_a1b2c3d4']), 'prof_a1b2c3d4');
  assert.equal(parseProfileCliArg(['--profile-id=default']), DEFAULT_PROFILE_ID);
  for (const argv of [
    [], ['--profile-id', 'default'], ['--profile-id='], ['--profile-id=../evil'],
    ['other--profile-id=default'], ['--profile-id=invalid', '--profile-id=default'],
  ]) {
    assert.equal(parseProfileCliArg(argv), null);
  }
});
