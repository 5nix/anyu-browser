import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { place } from '../../src/renderer/ui/place.ts';

test('point menus flip at each edge and stay inside small windows', () => {
  const size = { width: 100, height: 80 }, viewport = { width: 300, height: 200 };
  assert.deepEqual(place({ x: 10, y: 10, width: 0, height: 0 }, size, viewport, 'bottom-right'), { x: 10, y: 10 });
  assert.deepEqual(place({ x: 290, y: 190, width: 0, height: 0 }, size, viewport, 'bottom-right'), { x: 190, y: 110 });
  assert.deepEqual(place({ x: 290, y: 10, width: 0, height: 0 }, size, viewport, 'bottom-right'), { x: 190, y: 10 });
  assert.deepEqual(place({ x: 10, y: 190, width: 0, height: 0 }, size, viewport, 'bottom-right'), { x: 10, y: 110 });
  assert.deepEqual(place({ x: 5, y: 5, width: 0, height: 0 }, { width: 400, height: 300 }, viewport, 'bottom-right'), { x: 0, y: 0 });
});
