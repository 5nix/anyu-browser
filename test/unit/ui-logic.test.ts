import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextEnabled, typeAhead } from '../../src/renderer/ui/logic.ts';

test('roving focus skips disabled entries and wraps', () => {
  assert.equal(nextEnabled([false, true, false], 0, 1), 2);
  assert.equal(nextEnabled([false, true, false], 0, -1), 2);
  assert.equal(nextEnabled([true, true], -1, 1), -1);
  assert.equal(nextEnabled([], -1, 1), -1);
});
test('type ahead matches enabled labels after current entry', () => {
  assert.equal(typeAhead(['Alpha', 'Alpine', 'Beta'], [false, true, false], 'al', 0), 0);
  assert.equal(typeAhead(['Alpha', 'Alpine', 'Beta'], [false, false, false], 'AL', 0), 1);
  assert.equal(typeAhead(['Alpha'], [false], '', -1), -1);
  assert.equal(typeAhead(['Alpha'], [false], 'z', -1), -1);
});
