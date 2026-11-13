import { test } from 'node:test';
import assert from 'node:assert/strict';
import { place } from '../../src/renderer/ui/place.ts';

const viewport = { width: 800, height: 600 }, size = { width: 200, height: 100 };
test('places below the anchor and shifts at the window edge', () => {
  assert.deepEqual(place({ x: 750, y: 30, width: 30, height: 30 }, size, viewport), { x: 580, y: 64 });
});
test('flips above when there is no room below', () => {
  assert.deepEqual(place({ x: 500, y: 550, width: 30, height: 30 }, size, viewport), { x: 330, y: 446 });
});
test('places the side-layout card to the right of its anchor', () => {
  assert.deepEqual(place({ x: 200, y: 5, width: 30, height: 30 }, size, viewport, 'bottom-right'), { x: 234, y: 39 });
});
