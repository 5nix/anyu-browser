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
test('point menus flip at each edge and stay inside small windows', () => {
  const menu = { width: 100, height: 80 }, small = { width: 300, height: 200 };
  assert.deepEqual(place({ x: 10, y: 10, width: 0, height: 0 }, menu, small, 'bottom-right'), { x: 10, y: 10 });
  assert.deepEqual(place({ x: 290, y: 190, width: 0, height: 0 }, menu, small, 'bottom-right'), { x: 190, y: 110 });
  assert.deepEqual(place({ x: 290, y: 10, width: 0, height: 0 }, menu, small, 'bottom-right'), { x: 190, y: 10 });
  assert.deepEqual(place({ x: 10, y: 190, width: 0, height: 0 }, menu, small, 'bottom-right'), { x: 10, y: 110 });
  assert.deepEqual(place({ x: 5, y: 5, width: 0, height: 0 }, { width: 400, height: 300 }, small, 'bottom-right'), { x: 0, y: 0 });
});
