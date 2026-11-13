import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { moveOrder, pinOrder } from '../../src/main/shell/tab-order.ts';

test('pin and unpin preserve the order within each zone', () => {
  const a = { pinned: true }, b = { pinned: false }, c = { pinned: false };
  b.pinned = true;
  assert.deepEqual(pinOrder([a, b, c], b, true), [a, b, c]);
  a.pinned = false;
  assert.deepEqual(pinOrder([a, b, c], a, false), [b, a, c]);
});

 test('moves clamp to the pinned or normal zone', () => {
  const a = { pinned: true }, b = { pinned: true }, c = { pinned: false }, d = { pinned: false };
  assert.deepEqual(moveOrder([a, b, c, d], a, 99), [b, a, c, d]);
  assert.deepEqual(moveOrder([a, b, c, d], d, 0), [a, b, d, c]);
  assert.deepEqual(moveOrder([a, b, c, d], d, 99), [a, b, c, d]);
});
