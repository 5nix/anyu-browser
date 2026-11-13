import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { launch, startWorld } from './harness.mjs';
import { devtoolsPort, evaluate, gateState, waitFor, withTarget } from './cdp.mjs';

const chrome = (u) => u.endsWith('/shell.html');

test('tab strip pointer reorder works in top and side layouts', async (t) => {
  const { port, shell } = await launch(t, { blank: true });
  await waitFor(() => shell('cave.getState()'));
  while ((await shell('cave.getState().then(s => s.tabs.length)')) < 5) await shell("cave.run('tab.new')");
  await waitFor(() => shell("!document.querySelector('.tab.entering')"));
  for (const layout of ['top', 'side']) {
    await shell(`cave.setTabLayout('${layout}')`);
    await waitFor(() => shell(`document.body.classList.contains('${layout}')`));
    await shell("document.querySelector('#tablist').scrollTo(0, 0)");
    const before = await shell('cave.getState().then(s => s.tabs.map(t => t.id))');
    const points = await shell("(() => [...document.querySelectorAll('.tab')].slice(0, 3).map(x => { const r = x.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }))()");
    if (layout === 'top') points[2].x += 45; else points[2].y += 15;
    await withTarget(port, chrome, async (send) => {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points[0], button: 'left', clickCount: 1 });
      await new Promise((r) => setTimeout(r, 150));
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points[2], button: 'left', buttons: 1 });
      await new Promise((r) => setTimeout(r, 150));
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points[2], button: 'left', clickCount: 1 });
    });
    await waitFor(() => shell(`cave.getState().then(s => s.tabs.indexOf(s.tabs.find(t => t.id === ${before[0]})) >= 2)`));
  }
});

test('tab drag cancellation, boundaries and session restore', async (t) => {
  const first = await startWorld({ blank: true, keepDir: true, extra: ['--remote-debugging-port=0'] });
  let second;
  t.after(async () => { await first.stop(); if (second) await second.stop(); await rm(first.dir, { recursive: true, force: true }); });
  const port = await devtoolsPort(first.log);
  const shell = (expr) => evaluate(port, chrome, expr);
  await waitFor(() => shell('cave.getState()'));
  await waitFor(async () => (await gateState(port)) === 'open', 60000);
  await shell('cave.setRestoreSession(true)');
  await shell("cave.navigate('http://one.cave.test/')");
  for (const name of ['two', 'three', 'four']) {
    await shell(`cave.newTab('http://${name}.cave.test/')`);
    await waitFor(() => shell(`cave.getState().then(s => s.tabs.some(t => t.url === 'http://${name}.cave.test/'))`));
  }
  await waitFor(() => shell("!document.querySelector('.tab.entering')"));
  const initial = await shell('cave.getState().then(s => s.tabs.map(t => t.id))');
  const dom = () => shell("[...document.querySelectorAll('.tab')].map(t => Number(t.dataset.tabId))");
  const gesture = async (from, to, action = 'release') => {
    const points = await shell("(() => [...document.querySelectorAll('.tab')].map(t => { const r = t.getBoundingClientRect(); return { x: r.left + 16, end: r.right - 10, y: r.top + r.height / 2 }; }))()");
    await withTarget(port, chrome, async (send) => {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points[from], button: 'left', clickCount: 1 });
      if (to !== null) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points[to].end, y: points[to].y, button: 'left', buttons: 1 });
      if (action === 'escape') await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape' });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...(to === null ? points[from] : { x: points[to].end, y: points[to].y }), button: 'left', clickCount: 1 });
    });
  };
  await gesture(0, null);
  assert.deepEqual(await shell('cave.getState().then(s => s.tabs.map(t => t.id))'), initial);
  await gesture(0, 3, 'escape');
  assert.deepEqual(await shell('cave.getState().then(s => s.tabs.map(t => t.id))'), initial);
  assert.deepEqual(await dom(), initial);
  await shell(`cave.pinTab(${initial[0]}, true)`);
  await waitFor(() => shell('cave.getState().then(s => s.tabs[0].pinned)'));
  await gesture(0, 3);
  assert.deepEqual(await shell('cave.getState().then(s => s.tabs.map(t => t.id))'), initial);
  await gesture(1, 0);
  assert.deepEqual(await shell('cave.getState().then(s => s.tabs.map(t => t.id))'), initial);
  await gesture(1, 3);
  const expected = [initial[0], initial[2], initial[3], initial[1]];
  await waitFor(async () => JSON.stringify(await shell('cave.getState().then(s => s.tabs.map(t => t.id))')) === JSON.stringify(expected));
  assert.deepEqual(await dom(), expected);
  const urls = await shell('cave.getState().then(s => s.tabs.map(t => t.url))');
  const exited = new Promise((resolve) => first.child.once('exit', resolve));
  void shell("cave.run('app.quit')").catch(() => {});
  await exited; await first.stop();
  second = await startWorld({ dir: first.dir, blank: true, keepDir: true, extra: ['--remote-debugging-port=0'] });
  const port2 = await devtoolsPort(second.log);
  const restored = await waitFor(async () => { const s = await evaluate(port2, chrome, 'cave.getState()'); return s.tabs.length === 4 && s; });
  assert.deepEqual(restored.tabs.map((t) => t.url), urls);
  assert.equal(restored.tabs[0].pinned, true);
});

test('duplicate creates a neighboring tab and settings cannot be pinned', async (t) => {
  const { shell } = await launch(t, { blank: true, open: true });
  await shell("cave.navigate('http://duplicate.cave.test/headers')");
  await waitFor(async () => (await shell('cave.getState()')).tabs[0].url === 'http://duplicate.cave.test/headers');
  const a = (await shell('cave.getState()')).active;
  await shell('cave.newTab()');
  await shell(`cave.duplicateTab(${a})`);
  await waitFor(async () => {
    const tabs = (await shell('cave.getState()')).tabs;
    return tabs.length === 3 && tabs[1].url === 'http://duplicate.cave.test/headers';
  });
  const tabs = (await shell('cave.getState()')).tabs;
  assert.equal(tabs[0].id, a);
  assert.notEqual(tabs[1].id, a);
  assert.equal(tabs[1].url, tabs[0].url);
  await shell('cave.openSettings()');
  const settingsId = await waitFor(async () => (await shell('cave.getState()')).tabs.find((x) => x.kind === 'settings')?.id);
  await shell(`cave.pinTab(${settingsId}, true)`);
  assert.equal((await shell('cave.getState()')).tabs.find((x) => x.id === settingsId).pinned, false);
  await shell("cave.run('tab.duplicate')");
  assert.equal((await shell('cave.getState()')).tabs.length, 4);
});

test('mute controls only the target audio tab', async (t) => {
  const { port, shell } = await launch(t, { blank: true, open: true });
  const audioPage = (u) => u === 'http://audio.cave.test/audio.html';
  await shell("cave.navigate('http://audio.cave.test/audio.html')");
  await waitFor(() => evaluate(port, audioPage, 'document.title'));
  await waitFor(() => evaluate(port, audioPage, 'window.audioReady'));
  await withTarget(port, audioPage, (send) => send('Runtime.evaluate', { expression: "document.querySelector('#play').click()", userGesture: true }));
  assert.equal(await evaluate(port, audioPage, 'ctx.state'), 'running');
  const a = (await shell('cave.getState()')).active;
  await shell('cave.newTab()');
  const b = (await shell('cave.getState()')).active;
  await shell(`cave.setTabMuted(${a}, true)`);
  await waitFor(async () => (await shell('cave.getState()')).tabs.find((x) => x.id === a).muted);
  assert.equal((await shell('cave.getState()')).tabs.find((x) => x.id === b).muted, false);
  await shell(`cave.activate(${a})`);
  await waitFor(() => shell("!!document.querySelector('.tab.active .audio')"));
  await shell("document.querySelector('.tab.active .audio').click()");
  await waitFor(async () => !(await shell('cave.getState()')).tabs.find((x) => x.id === a).muted);
  await shell("cave.run('tab.mute')");
  await waitFor(async () => (await shell('cave.getState()')).tabs.find((x) => x.id === a).muted);
});
