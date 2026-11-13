import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FRAME, METRICS, pageBounds, sidebarWidth } from '../../src/shared/layout.ts';
import { CALLS, EVENTS } from '../../src/shared/ipc.ts';
import { COMMANDS, accelerators, isCommand } from '../../src/shared/commands.ts';

const read = (file: string) => readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8');

test('the page fills what the chrome leaves free and clamps at tiny sizes', () => {
  const { strip, toolbar, side, gap, caption } = METRICS;
  assert.deepEqual(pageBounds('top', 1280, 860, true), { x: gap, y: strip + toolbar, width: 1280 - 2 * gap, height: 860 - strip - toolbar - gap });
  assert.deepEqual(pageBounds('side', 1280, 860, true), { x: side, y: gap, width: 1280 - side - gap, height: 860 - 2 * gap });
  // Windows/Linux keep the caption-button band above the page card.
  assert.deepEqual(pageBounds('side', 1280, 860, false), { x: side, y: caption, width: 1280 - side - gap, height: 860 - caption - gap });
  assert.deepEqual(pageBounds('side', 100, 4, true), { x: side, y: gap, width: 0, height: 0 }, 'never negative');
});

test('the chrome takes its sizes and frame colours from the shared values', () => {
  const css = read('renderer/shell.css');
  for (const [rule] of css.matchAll(/grid-template[^;]*;/g)) assert.doesNotMatch(rule, /\b(36|40|240)px/, 'no shared size is written out in a grid template');
  for (const name of ['strip', 'toolbar', 'side']) assert.match(css, new RegExp(`var\\(--${name}\\)`), `shell.css uses --${name}`);
  const tokens = read('renderer/style.css');
  const dark = tokens.slice(tokens.indexOf('prefers-color-scheme: dark'));
  assert.match(tokens.slice(0, tokens.indexOf('prefers-color-scheme: dark')), new RegExp(`--frame: ${FRAME.light.frame};`));
  assert.match(dark, new RegExp(`--frame: ${FRAME.dark.frame};`));
});

test('only the .drag elements are drag regions, and the overlay page has none', () => {
  const drag = (css: string) => [...css.matchAll(/([^{}]*)\{[^}]*-webkit-app-region:\s*drag[^}]*\}/g)].map((m) => m[1].trim());
  assert.deepEqual(drag(read('renderer/shell.css')), ['.drag']);
  for (const file of ['renderer/overlay.css', 'renderer/settings.css', 'renderer/style.css']) assert.deepEqual(drag(read(file)), [], file);
});

test('commands have unique shortcuts and bridge names never collide', () => {
  assert.ok(isCommand('tab.new'));
  assert.ok(!isCommand('toString') && !isCommand('nope') && !isCommand(1));
  for (const mac of [true, false]) {
    const used = Object.keys(COMMANDS).flatMap((id) => accelerators(id as keyof typeof COMMANDS, mac));
    assert.equal(new Set(used).size, used.length, 'no shortcut is bound twice');
  }
  // A call and an event never share a name: both become the channel cave:<name>.
  for (const name of Object.keys(EVENTS)) assert.ok(!Object.hasOwn(CALLS, name), name);
});

test('sidebar width defaults and clamps', () => {
  assert.equal(sidebarWidth(undefined), METRICS.side);
  assert.equal(sidebarWidth(NaN), METRICS.side);
  assert.equal(sidebarWidth(100), 200);
  assert.equal(sidebarWidth(500), 420);
  assert.equal(pageBounds('side', 1000, 800, true, 300).x, 300);
});
