import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { startWorld } from './harness.mjs';
import { click, devtoolsPort, evaluate, rightClick, waitFor } from './cdp.mjs';

test('surface placement uses window coordinates for chrome menus', async t => {
  const w = await startWorld({ blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log), chrome = u => u.endsWith('/shell.html'), overlay = u => u.endsWith('/overlay.html');
  const shell = expr => evaluate(port, chrome, expr);
  await waitFor(() => shell('cave.getState()'));
  const card = async name => {
    try { await waitFor(() => evaluate(port, overlay, `!!document.querySelector('#${name}.in')`)); } catch (error) { t.diagnostic(`surface state: ${JSON.stringify(await shell('cave.getState()'))}`); throw error; }
    await new Promise(r => setTimeout(r, 600));
    const bounds = await waitFor(async () => { const b = await shell('cave.testSuggestionBounds()'); return b.width > 1 && b.height > 1 && b; });
    const rect = await evaluate(port, overlay, `document.querySelector('#${name}').getBoundingClientRect().toJSON()`);
    // The overlay view is the card itself; the shadow lives in its own click-through window.
    assert.deepEqual([rect.x, rect.y, Math.ceil(rect.width), Math.ceil(rect.height)], [0, 0, bounds.width, bounds.height], JSON.stringify({ bounds, rect }));
    assert.deepEqual(await evaluate(port, u => u.endsWith('/shadow.html'), "[document.body.classList.contains('in'), innerWidth, innerHeight]"), [true, bounds.width + 128, bounds.height + 128]);
    return { x: bounds.x + rect.x, y: bounds.y + rect.y, width: rect.width, height: rect.height };
  };
  for (const layout of ['top', 'side']) {
    await shell(`cave.setTabLayout('${layout}')`);
    if (layout === 'side') await shell('cave.setSidebarWidth(320)');
    await waitFor(() => shell(`document.body.classList.contains('${layout}')`));
    await click(port, chrome, '#menu-button');
    const anchor = await shell('cave.getState().then(s => s.surface.anchor)'), rect = await card('menu');
    assert.ok(Math.abs((layout === 'top' ? rect.y - anchor.y - anchor.height : anchor.y - rect.y - rect.height) - 4) < 2, JSON.stringify({ anchor, rect }));
    await shell('cave.closeSurface()');
    await waitFor(() => shell('cave.getState().then(s => !s.surface)'));
    await new Promise(r => setTimeout(r, 200));
    const point = await shell("(() => { const r = document.querySelector('.tab').getBoundingClientRect(); return { x: r.x + 25, y: r.y + 15 }; })()");
    await rightClick(port, chrome, point.x, point.y);
    const context = await card('contextMenu');
    assert.ok(Math.abs(context.x - point.x) < 2 && Math.abs(context.y - point.y) < 2, JSON.stringify({ point, context }));
    await shell('cave.closeSurface()');
    await waitFor(() => shell('cave.getState().then(s => !s.surface)'));
    await new Promise(r => setTimeout(r, 200));
    const address = await shell("(() => { const r = document.querySelector('#address').getBoundingClientRect(); return { x: r.x + 50, y: r.y + 15 }; })()");
    await rightClick(port, chrome, address.x, address.y);
    const addressCard = await card('contextMenu');
    assert.ok(Math.abs(addressCard.x - address.x) < 2 && Math.abs(addressCard.y - address.y) < 2, JSON.stringify({ address, addressCard }));
    await shell('cave.closeSurface()');
  }
});

test('address editing ends on sidebar presses', async t => {
  const w = await startWorld({ blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log), chrome = u => u.endsWith('/shell.html');
  const shell = expr => evaluate(port, chrome, expr);
  await waitFor(() => shell('cave.getState()'));
  await shell("cave.setTabLayout('side')");
  await waitFor(() => shell("document.body.classList.contains('side')"));
  for (const selector of ['#tabs', '.tab', '#menu-button']) {
    await click(port, chrome, '#address');
    await waitFor(() => shell('document.activeElement.id === "address"'));
    await click(port, chrome, selector);
    await waitFor(() => shell('document.activeElement.id !== "address"'));
    assert.equal(await shell('cave.getState().then(s => !!s.address)'), false);
    await shell('cave.closeSurface()');
  }
});

test('surface placement follows page context clicks', async t => {
  const w = await startWorld({ extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log), chrome = u => u.endsWith('/shell.html'), overlay = u => u.endsWith('/overlay.html');
  const shell = expr => evaluate(port, chrome, expr);
  await waitFor(() => shell('cave.getState().then(s => s.gate.state === "open")'), 60000);
  const check = async (target, x, y, offset, scale = 1) => {
    await rightClick(port, target, x, y);
    await waitFor(() => shell('cave.getState().then(s => s.surface?.name === "contextMenu")'));
    await waitFor(() => evaluate(port, overlay, "!!document.querySelector('#contextMenu.in')"));
    await new Promise(r => setTimeout(r, 500));
    const bounds = await shell('cave.testSuggestionBounds()');
    const rect = await evaluate(port, overlay, "document.querySelector('#contextMenu').getBoundingClientRect().toJSON()");
    assert.ok(Math.abs(bounds.x + rect.x - x * scale - offset.x) < 2 && Math.abs(bounds.y + rect.y - y * scale - offset.y) < 2, JSON.stringify({ bounds, rect, x, y, offset }));
    await shell('cave.closeSurface()');
    await new Promise(r => setTimeout(r, 200));
  };
  await shell("cave.setTabLayout('side')"); await shell('cave.setSidebarWidth(320)');
  await waitFor(() => shell("document.body.classList.contains('side')"));
  const mac = await shell("document.body.classList.contains('mac')");
  const offset = { x: 320, y: mac ? 8 : 44 };
  const page = u => u.startsWith('http://fp.cave.test/');
  await waitFor(() => evaluate(port, page, 'document.readyState === "complete"'));
  await shell("cave.run('zoom.in')");
  await waitFor(() => shell('cave.getState().then(s => s.zoom > 100)'));
  await check(page, 300, 250, offset, await shell('cave.getState().then(s => s.zoom / 100)'));
  await shell("cave.run('tab.new')");
  const home = u => u.endsWith('/home.html');
  await waitFor(() => evaluate(port, home, '!!document.querySelector("main")'));
  await check(home, 300, 250, offset);
  for (const [command, suffix] of [["cave.openSettings('privacy')", '/settings.html'], ["cave.run('history.open')", '/history.html'], ["cave.run('bookmarks.open')", '/bookmarks.html']]) {
    await shell(command);
    const target = u => u.endsWith(suffix);
    await waitFor(() => evaluate(port, target, 'document.readyState === "complete"'));
    await new Promise(r => setTimeout(r, 300));
    await check(target, 300, 250, offset);
  }
});
