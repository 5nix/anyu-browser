import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const source = readFileSync(new URL('../../src/main/shell/surfaces.ts', import.meta.url), 'utf8');
const { code } = transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022' });
const { Surfaces } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('surface bounds acknowledge only the current open', () => {
  const bounds: unknown[] = [];
  const overlay = { setBounds: (r: unknown) => bounds.push(r), webContents: { focus() {}, isFocused: () => false } };
  const surfaces = new Surfaces({ getBounds: () => ({ width: 800, height: 600 }) } as never, overlay as never, () => null, () => {});
  surfaces.open('menu');
  const first = surfaces.state!.generation;
  surfaces.close(false);
  surfaces.open('menu');
  const second = surfaces.state!.generation;
  const rect = { x: 10, y: 20, width: 200, height: 300 };
  assert.notEqual(first, second);
  const parked = bounds.length;
  assert.equal(surfaces.setBounds(rect, 'menu', first), false);
  assert.equal(bounds.length, parked);
  assert.equal(surfaces.setBounds(rect, 'menu', second), true);
  assert.deepEqual(bounds.at(-1), rect);
});
