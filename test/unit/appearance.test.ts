import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { ACCENTS, accentValue, themeValue } from '../../src/shared/appearance.ts';

test('appearance preferences validate presets and fall back to defaults', () => {
  for (const accent of ACCENTS) assert.equal(accentValue(accent), accent);
  for (const value of [undefined, null, '', 'graphite', 'TEAL', 1, {}]) assert.equal(accentValue(value), 'teal');
  for (const theme of ['system', 'light', 'dark']) assert.equal(themeValue(theme), theme);
  for (const value of [undefined, null, '', 'auto', 1, {}]) assert.equal(themeValue(value), 'system');
});
