import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FRAME, METRICS, captionHeight, pageBounds, sidebarWidth, trafficLights } from '../../src/shared/layout.ts';
import { setLocale } from '../../src/shared/i18n/index.ts';
import { CALLS, EVENTS } from '../../src/shared/ipc.ts';
import { COMMANDS, label, accelerator, accelerators, isCommand } from '../../src/shared/commands.ts';

const read = (file: string) => readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8');

test('the page fills what the chrome leaves free', () => {
  const { strip, toolbar, side, gap, caption } = METRICS;
  assert.deepEqual(pageBounds('top', 1280, 860, true), { x: gap, y: strip + toolbar, width: 1280 - 2 * gap, height: 860 - strip - toolbar - gap });
  assert.equal(strip + toolbar, 85);
  assert.deepEqual(pageBounds('side', 1280, 860, true), { x: side, y: gap, width: 1280 - side - gap, height: 860 - 2 * gap });
  // Windows/Linux keep the caption-button band above the page card.
  assert.deepEqual(pageBounds('side', 1280, 860, false), { x: side, y: caption, width: 1280 - side - gap, height: 860 - caption - gap });
  assert.equal(caption, 44, 'the side layout keeps its caption band');
  assert.deepEqual(pageBounds('side', 100, 4, true), { x: side, y: gap, width: 0, height: 0 }, 'never negative');
});

test('window buttons and caption band follow the layout', () => {
  const { gap, button, strip, tab, light } = METRICS;
  const top = trafficLights('top');
  // Top: the red light's centre is the back button's centre and the tab's centre.
  assert.equal(top.x + light / 2, gap + button / 2);
  assert.equal(top.y + light / 2, strip - tab / 2);
  assert.deepEqual(top, { x: 17, y: 17 });
  const side = trafficLights('side');
  assert.equal(side.x, 14);
  assert.equal(side.y + light / 2, METRICS.sideTop / 2);
  assert.deepEqual(side, { x: 14, y: 17 });
  assert.equal(captionHeight('top'), strip);
  assert.equal(captionHeight('side'), METRICS.caption);
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

test('commands and bridge names', () => {
  setLocale('zh'); assert.equal(label('tab.new'), '新建标签页');
  setLocale('en'); assert.equal(label('tab.new'), 'New Tab');
  setLocale('zh');
  assert.ok(isCommand('tab.new'));
  assert.ok(!isCommand('toString') && !isCommand('nope') && !isCommand(1));
  assert.equal(accelerator('downloads.open', true), 'Cmd+Shift+J');
  assert.equal(accelerator('downloads.open', false), 'Ctrl+J');
  assert.equal(accelerator('page.back', true), 'Cmd+[');
  assert.equal(accelerator('page.back', false), 'Alt+Left');
  assert.equal(accelerator('page.stop', true), undefined);
  assert.deepEqual(accelerators('page.reload', false), ['CmdOrCtrl+R', 'F5']);
  assert.deepEqual(accelerators('tab.next', true), ['Ctrl+Tab', 'Cmd+Alt+Right']);
  assert.deepEqual(accelerators('tab.previous', false), ['Ctrl+Shift+Tab', 'Ctrl+PageUp']);
  assert.deepEqual(accelerators('devtools.toggle', false), ['F12', 'Ctrl+Shift+I']);
  assert.equal(accelerator('window.fullscreen', true), 'Ctrl+Cmd+F');
  assert.equal(accelerator('app.quit', true), 'Cmd+Q');
  const keys = Object.keys(COMMANDS).flatMap((id) => [accelerator(id as keyof typeof COMMANDS, true), accelerator(id as keyof typeof COMMANDS, false)].filter(Boolean).map((k) => `${k}`));
  for (const mac of [true, false]) {
    const used = Object.keys(COMMANDS).flatMap((id) => accelerators(id as keyof typeof COMMANDS, mac));
    assert.equal(new Set(used).size, used.length, 'no shortcut is bound twice');
  }
  assert.ok(keys.length > 0);
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

test('setup reserves a 52px band and fills the remaining window', async () => {
  const { setupPageBounds } = await import('../../src/shared/layout.ts');
  assert.deepEqual(setupPageBounds(720, 480), { x: 0, y: 52, width: 720, height: 428 });
});
