import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { startWorld } from './harness.mjs';
import { click, devtoolsPort, evaluate, key, waitFor } from './cdp.mjs';

test('shortcut menu dismisses on outside press and Escape', async (t) => {
  const w = await startWorld({ blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log), chrome = u => u.endsWith('/shell.html'), home = u => u.endsWith('/home.html'), overlay = u => u.endsWith('/overlay.html');
  const shell = expr => evaluate(port, chrome, expr);
  await waitFor(() => evaluate(port, home, '!!document.querySelector(".shortcuts")'));
  await evaluate(port, home, "cave.saveShortcut({ name: 'Example', url: 'https://example.com' })");
  await waitFor(() => evaluate(port, home, '!!document.querySelector(".more")'));
  const open = async () => { await click(port, home, '.more'); await waitFor(() => shell("cave.getState().then(s => s.surface?.name === 'contextMenu')")); };
  const closed = () => waitFor(() => shell('cave.getState().then(s => !s.surface)'));
  await open();
  await new Promise(r => setTimeout(r, 400));
  const anchor = await shell('cave.getState().then(s => s.surface.anchor)');
  const bounds = await shell('cave.testSuggestionBounds()');
  assert.ok(bounds.y >= anchor.y + anchor.height || bounds.x >= anchor.x + anchor.width, JSON.stringify({ anchor, bounds }));
  const card = await evaluate(port, overlay, "document.querySelector('#contextMenu').getBoundingClientRect().toJSON()");
  assert.ok(Math.abs(bounds.x + card.x - anchor.x - anchor.width - 4) < 2 && Math.abs(bounds.y + card.y - anchor.y - anchor.height - 4) < 2, JSON.stringify({ anchor, bounds, card }));
  await click(port, home, '.more'); await closed();
  await open(); await click(port, home, 'main'); await closed();
  await open(); await click(port, chrome, '#nav'); await closed();
  await open(); await key(port, overlay, 'Escape'); await closed();
});
