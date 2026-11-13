import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { isZoom, zoomOrigin, zoomStep } from '../../src/shared/zoom.ts';

test('zoom steps have fixed bounds and reject invalid values', () => {
  assert.equal(zoomStep(50, -1), 50); assert.equal(zoomStep(300, 1), 300);
  assert.equal(zoomStep(100, 1), 110); assert.equal(zoomStep(100, -1), 90);
  assert.equal(isZoom(NaN), false); assert.equal(isZoom(101), false);
  assert.equal(zoomStep(NaN, 1), 100);
});
test('zoom origins normalize and isolate scheme and port', () => {
  assert.equal(zoomOrigin('https://EXAMPLE.com:443/a'), 'https://example.com');
  assert.notEqual(zoomOrigin('http://example.com'), zoomOrigin('https://example.com'));
  assert.notEqual(zoomOrigin('https://example.com:444'), zoomOrigin('https://example.com'));
  assert.equal(zoomOrigin('about:blank'), null); assert.equal(zoomOrigin('invalid'), null);
});
