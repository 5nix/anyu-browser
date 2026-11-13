import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startWorld } from './harness.mjs';
import { devtoolsPort, evaluate, waitFor, withTarget, screenshot, gateState } from './cdp.mjs';

const dir = '/private/tmp/claude-501/-Volumes-Ti-Projects-T3-cave/ec4490f8-814b-4682-a852-004923570123/scratchpad/tabs1';
test('tab strip overflow and pointer reorder', async t => {
  const w = await startWorld({ blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log), chrome = u => u.endsWith('/shell.html');
  const shell = expr => evaluate(port, chrome, expr);
  await mkdir(dir, { recursive: true });
  await waitFor(() => shell('cave.getState()'));
  await shell("cave.setTabLayout('top')");
  for (const count of [5, 30, 80]) {
    while ((await shell('cave.getState().then(s => s.tabs.length)')) < count) await shell("cave.run('tab.new')");
    await waitFor(() => shell("!document.querySelector('.tab.entering')"));
    const result = await shell(`(() => { const list = document.querySelector('#tablist').getBoundingClientRect(), tabs = [...document.querySelectorAll('.tab')].map(x => x.getBoundingClientRect()), active = document.querySelector('.tab.active').getBoundingClientRect(), add = document.querySelector('#new-tab').getBoundingClientRect(); return { widths: tabs.map(x => x.width), overlap: tabs.some((x, i) => i && x.left < tabs[i-1].right - 0.1), visible: active.left >= list.left - 1 && active.right <= list.right + 1 && add.right <= innerWidth }; })()`);
    assert.ok(!result.overlap && result.visible, JSON.stringify({ count, ...result }));
    assert.ok(result.widths.every(x => x >= 35 && x <= 240));
    await writeFile(`${dir}/top-${count}.png`, await screenshot(port, chrome));
  }
  for (const layout of ['top', 'side']) {
    await shell(`cave.setTabLayout('${layout}')`);
    await waitFor(() => shell(`document.body.classList.contains('${layout}')`));
    await shell("document.querySelector('#tablist').scrollTo(0, 0)");
    const before = await shell('cave.getState().then(s => s.tabs.map(t => t.id))');
    const points = await shell(`(() => { const a = [...document.querySelectorAll('.tab')].slice(0, 3).map(x => x.getBoundingClientRect()); return a.map(r => ({x: r.x + r.width / 2, y: r.y + r.height / 2})); })()`);
    if (layout === 'top') points[2].x += 45; else points[2].y += 15;
    await withTarget(port, chrome, async send => {
      await send('Input.dispatchMouseEvent', {type:'mousePressed', ...points[0], button:'left', clickCount:1});
      await new Promise(r => setTimeout(r, 150));
      await send('Input.dispatchMouseEvent', {type:'mouseMoved', ...points[2], button:'left', buttons:1});
      await new Promise(r => setTimeout(r, 150));
      await writeFile(`${dir}/${layout}-drag.png`, Buffer.from((await send('Page.captureScreenshot', {format:'png'})).data, 'base64'));
      await send('Input.dispatchMouseEvent', {type:'mouseReleased', ...points[2], button:'left', clickCount:1});
    });
    await waitFor(() => shell(`cave.getState().then(s => s.tabs.indexOf(s.tabs.find(t => t.id === ${before[0]})) >= 2)`));
  }
});

test('tab drag cancellation, boundaries and session restore', async t => {
  const { rm } = await import('node:fs/promises');
  const first = await startWorld({ blank: true, keepDir: true, extra: ['--remote-debugging-port=0'] });
  let second;
  t.after(async () => { await first.stop(); if (second) await second.stop(); await rm(first.dir, { recursive: true, force: true }); });
  const port = await devtoolsPort(first.log), chrome = u => u.endsWith('/shell.html');
  const shell = expr => evaluate(port, chrome, expr);
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
    const points = await shell(`(() => [...document.querySelectorAll('.tab')].map(t => { const r = t.getBoundingClientRect(); return {x:r.left + 16, end:r.right - 10, y:r.top + r.height/2}; }))()`);
    await withTarget(port, chrome, async send => {
      await send('Input.dispatchMouseEvent', { type:'mousePressed', ...points[from], button:'left', clickCount:1 });
      if (to !== null) await send('Input.dispatchMouseEvent', { type:'mouseMoved', x: points[to].end, y: points[to].y, button:'left', buttons:1 });
      if (action === 'escape') await send('Input.dispatchKeyEvent', { type:'keyDown', key:'Escape' });
      await send('Input.dispatchMouseEvent', { type:'mouseReleased', ...(to === null ? points[from] : { x: points[to].end, y: points[to].y }), button:'left', clickCount:1 });
    });
  };
  await gesture(0, null);
  assert.deepEqual(await shell('cave.getState().then(s => s.tabs.map(t => t.id))'), initial);
  await gesture(0, 3, 'escape');
  assert.deepEqual(await shell('cave.getState().then(s => s.tabs.map(t => t.id))'), initial);
  assert.deepEqual(await dom(), initial);
  await shell(`cave.pinTab(${initial[0]}, true)`);
  await waitFor(() => shell(`cave.getState().then(s => s.tabs[0].pinned)`));
  await gesture(0, 3);
  assert.deepEqual(await shell('cave.getState().then(s => s.tabs.map(t => t.id))'), initial);
  await gesture(1, 0);
  assert.deepEqual(await shell('cave.getState().then(s => s.tabs.map(t => t.id))'), initial);
  await gesture(1, 3);
  const expected = [initial[0], initial[2], initial[3], initial[1]];
  await waitFor(async () => JSON.stringify(await shell('cave.getState().then(s => s.tabs.map(t => t.id))')) === JSON.stringify(expected));
  assert.deepEqual(await dom(), expected);
  const urls = await shell('cave.getState().then(s => s.tabs.map(t => t.url))');
  const exited = new Promise(resolve => first.child.once('exit', resolve));
  void shell("cave.run('app.quit')").catch(() => {});
  await exited; await first.stop();
  second = await startWorld({ dir:first.dir, blank:true, keepDir:true, extra:['--remote-debugging-port=0'] });
  const port2 = await devtoolsPort(second.log);
  const restored = await waitFor(async () => { const s = await evaluate(port2, chrome, 'cave.getState()'); return s.tabs.length === 4 && s; });
  assert.deepEqual(restored.tabs.map(t => t.url), urls);
  assert.equal(restored.tabs[0].pinned, true);
});
