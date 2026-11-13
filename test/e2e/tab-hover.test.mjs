import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startWorld } from './harness.mjs';
import { devtoolsPort, evaluate, waitFor, withTarget, screenshot } from './cdp.mjs';

const dir = '/private/tmp/claude-501/-Volumes-Ti-Projects-T3-cave/ec4490f8-814b-4682-a852-004923570123/scratchpad/leftovers';
test('dark top tab hover remains distinct from frame and active tab', async t => {
  const w = await startWorld({ blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log), target = u => u.endsWith('/shell.html');
  const shell = expr => evaluate(port, target, expr);
  await waitFor(() => shell('cave.getState()'));
  await shell("cave.setTabLayout('top'); cave.setTheme('dark'); cave.newTab()");
  await waitFor(() => shell("document.body.classList.contains('top') && document.querySelector('.tab:not(.active)') && !document.querySelector('.tab.entering') && getComputedStyle(document.body).getPropertyValue('--tab-frame-hover').trim() === '#171718'"));
  const point = await shell("(() => { const r = document.querySelector('.tab:not(.active)').getBoundingClientRect(); return {x:r.left + r.width / 2, y:r.top + r.height / 2}; })()");
  await withTarget(port, target, send => send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point }));
  await waitFor(() => shell("document.querySelector('.tab:not(.active):hover')"));
  assert.equal(await shell("getComputedStyle(document.querySelector('.tab:not(.active)'), '::after').backgroundColor"), 'rgb(23, 23, 24)');
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/dark-tab-hover.png`, await screenshot(port, target));
});
