import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startWorld } from './harness.mjs';
import { devtoolsPort, evaluate, waitFor } from './cdp.mjs';

test('chrome layout: tabs stay above the pinned new-tab row', async (t) => {
  const w = await startWorld({ blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = (expr) => evaluate(port, (u) => u.endsWith('/shell.html'), expr);
  await waitFor(() => shell("!!document.querySelector('#tabs')"));
  await shell("cave.setTabLayout('side')");
  await waitFor(() => shell("document.body.classList.contains('side')"));
  assert.equal(await shell("document.querySelector('#tablist').nextElementSibling.id"), 'new-tab');
  for (let i = 0; i < 39; i++) await shell("cave.run('tab.new')");
  await waitFor(() => shell("document.querySelector('#tabs').classList.contains('overflowing')"));
  await waitFor(() => shell("!document.querySelector('.tab.active').classList.contains('entering')"));
  const result = await shell(`(() => {
    const list = document.querySelector('#tablist'), row = document.querySelector('#new-tab').getBoundingClientRect(),
      tools = document.querySelector('#tools').getBoundingClientRect(), active = list.querySelector('.active').getBoundingClientRect(), box = list.getBoundingClientRect();
    return { scrolls: list.scrollHeight > list.clientHeight, row: row.bottom, tools: tools.top, activeTop: active.top, activeBottom: active.bottom, top: box.top, bottom: box.bottom };
  })()`);
  assert.ok(result.scrolls && result.row <= result.tools);
  assert.ok(result.activeTop >= result.top && result.activeBottom <= result.bottom);
});

test('chrome layout: sidebar width and address dismissal persist across views', async (t) => {
  const { rm } = await import('node:fs/promises');
  const { click } = await import('./cdp.mjs');
  const w = await startWorld({ blank: true, keepDir: true, extra: ['--remote-debugging-port=0'] });
  let next;
  t.after(async () => { await w.stop(); if (next) await next.stop(); await rm(w.dir, { recursive: true, force: true }); });
  const port = await devtoolsPort(w.log), chrome = u => u.endsWith('/shell.html'), home = u => u.endsWith('/home.html'), settings = u => u.endsWith('/settings.html');
  const shell = expr => evaluate(port, chrome, expr);
  await waitFor(() => shell('cave.getState()'));
  await shell("cave.setTabLayout('side')");
  await shell('cave.setSidebarWidth(320)');
  await waitFor(() => shell("getComputedStyle(document.documentElement).getPropertyValue('--side') === '320px'"));
  const width = await shell('innerWidth');
  await waitFor(() => evaluate(port, home, `innerWidth === ${width - 328}`));
  await click(port, chrome, '#address');
  await click(port, home, 'body');
  await waitFor(() => shell("document.activeElement !== document.querySelector('#address') && cave.getState().then(s => !s.surface)"));
  await click(port, chrome, '#address');
  await click(port, chrome, '#tabs');
  await waitFor(() => shell("document.activeElement !== document.querySelector('#address')"));
  await shell("cave.openSettings('privacy')");
  await waitFor(() => evaluate(port, settings, "!!document.querySelector('#clear-data')"));
  await click(port, chrome, '#address');
  await click(port, settings, '#content');
  await waitFor(() => shell("document.activeElement !== document.querySelector('#address') && cave.getState().then(s => !s.surface)"));
  await w.stop();
  next = await startWorld({ dir: w.dir, blank: true, keepDir: true, extra: ['--remote-debugging-port=0'] });
  const port2 = await devtoolsPort(next.log);
  await waitFor(() => evaluate(port2, chrome, "cave.getState().then(s => s.tabLayout === 'side' && s.sidebarWidth === 320)"));
  const width2 = await evaluate(port2, chrome, 'innerWidth');
  await waitFor(() => evaluate(port2, home, `innerWidth === ${width2 - 328}`));
});

test('Windows side chrome places navigation below the caption band', async (t) => {
  process.env.CAVE_TEST_WINDOWS_CHROME = '1';
  const w = await startWorld({ blank: true, extra: ['--remote-debugging-port=0'] });
  delete process.env.CAVE_TEST_WINDOWS_CHROME;
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log), shell = expr => evaluate(port, u => u.endsWith('/shell.html'), expr);
  await waitFor(() => shell("document.body.classList.contains('win')"));
  await shell("cave.setTabLayout('side')");
  await waitFor(() => shell("document.body.classList.contains('side')"));
  const rects = await shell(`(() => { const r = id => { const b = document.querySelector(id).getBoundingClientRect(); return { x: b.x, y: b.y, bottom: b.bottom }; }; return { nav: r('#nav'), sheet: r('#sheet'), band: r('#drag-bar') }; })()`);
  assert.equal(rects.nav.y, 44);
  assert.equal(rects.nav.x, 0);
  assert.equal(rects.sheet.y, 44);
  assert.equal(rects.band.bottom, 44);
  // Top layout: the caption band is the 40px tab strip; tabs stand on its bottom edge and the
  // + shares their centre line; the page card starts below the 50px toolbar band.
  await shell("cave.setTabLayout('top')");
  await waitFor(() => shell("document.body.classList.contains('top')"));
  await waitFor(() => shell("!document.querySelector('.tab.entering')"));
  const top = await shell(`(() => { const r = s => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x, y: b.y, right: innerWidth - b.right, bottom: b.bottom, cy: b.y + b.height / 2 }; };
    return { band: r('#drag-bar'), tab: r('.tab'), add: r('#new-tab svg'), fav: r('.tab .fav svg, .tab .fav img'), sheet: r('#sheet'), field: r('#address-form'), site: r('#site-icon'), star: r('#bookmark') }; })()`);
  assert.equal(top.band.bottom, 40);
  assert.deepEqual([top.tab.x, top.tab.y, top.tab.bottom], [8, 8, 40]);
  assert.equal(top.add.cy, top.tab.cy);
  assert.equal(top.fav.cy, top.tab.cy);
  assert.equal(top.sheet.y, 85);
  assert.equal(top.site.x - top.field.x, top.star.right - top.field.right, 'site icon and star are mirrored');
  assert.equal(top.site.cy, top.star.cy);
});
