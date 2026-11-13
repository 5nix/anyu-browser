import { tmpdir } from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startWorld } from './harness.mjs';
import { devtoolsPort, evaluate, waitFor, screenshot, gateState, click } from './cdp.mjs';

const dir = `${tmpdir()}/anyu-e2e/leftovers`;
test('certificate details follow the selected locale', async t => {
  const w = await startWorld({ blank: true, tls: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log), shellTarget = u => u.endsWith('/shell.html'), overlayTarget = u => u.endsWith('/overlay.html');
  const shell = expr => evaluate(port, shellTarget, expr), overlay = expr => evaluate(port, overlayTarget, expr);
  await mkdir(dir, { recursive: true });
  await waitFor(async () => (await gateState(port)) === 'open', 60000);
  await shell(`cave.navigate(${JSON.stringify(w.httpsUrl)})`);
  await waitFor(async () => { const s = await shell('cave.getState()'); return s.tabs.find(t => t.id === s.active)?.url === w.httpsUrl && !s.tabs.find(t => t.id === s.active)?.loading; });
  await shell("cave.setLocale('zh')");
  await shell("document.querySelector('#site-icon').click()");
  await waitFor(() => overlay("!!document.querySelector('.site-info-certificate')"));
  await click(port, overlayTarget, '.site-info-certificate summary');
  await waitFor(() => overlay("document.querySelector('.site-info-certificate').open"));
  assert.match(await overlay("document.querySelector('.site-info-certificate dd:nth-of-type(3)').textContent"), /\d{4}年\d{1,2}月\d{1,2}日/);
  await writeFile(`${dir}/certificate-zh.png`, await screenshot(port, overlayTarget));
  await shell("cave.setLocale('en')");
  await waitFor(() => overlay("/^[A-Z][a-z]{2} \\d{1,2}, \\d{4}$/.test(document.querySelector('.site-info-certificate dd:nth-of-type(3)').textContent)"));
  await writeFile(`${dir}/certificate-en.png`, await screenshot(port, overlayTarget));
});
