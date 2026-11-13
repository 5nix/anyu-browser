// First-run setup against the local fixtures: a fresh profile, a subscription served by the fixture
// server (fetched directly, as the one permitted direct request), the fixture SOCKS node, and the
// fixture trace endpoint. Screenshots of every step go to the OS temp dir.
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startWorld } from './harness.mjs';
import { click as cdpClick, devtoolsPort, evaluate, waitFor, withTarget } from './cdp.mjs';

const shots = join(tmpdir(), 'anyu-e2e', 'welcome');
const welcomeTarget = (u) => u.endsWith('/welcome.html');
const shellTarget = (u) => u.endsWith('/shell.html');
const homeTarget = (u) => u.endsWith('/home.html');
// A profile that has never been set up: no source, no port, no exit country.
const FRESH = { version: 1 };

async function open(t) {
  const w = await startWorld({ profile: FRESH, blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const page = (expr) => evaluate(port, welcomeTarget, expr);
  const shell = (expr) => evaluate(port, shellTarget, expr);
  const click = async (selector) => {
    // Actions disable the buttons until the main process has answered.
    await waitFor(() => page(`(el => !!el && !el.disabled)(document.querySelector(${JSON.stringify(selector)}))`));
    await page(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center' })`);
    await cdpClick(port, welcomeTarget, selector);
  };
  // Replaces the field's text, as typing over a selection does.
  const type = async (selector, text) => {
    await click(selector);
    await page(`document.querySelector(${JSON.stringify(selector)}).select()`);
    await withTarget(port, welcomeTarget, (send) => send('Input.insertText', { text }));
  };
  const choose = (selector, value) => page(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const step = () => page("document.querySelector('.setup')?.dataset.step ?? null");
  const atStep = (name) => waitFor(async () => (await step()) === name, 60000);
  const state = () => shell('cave.getState()');
  // One picture per variant, light and dark at 1280×800, plus 720×480 for the key steps.
  const shoot = (name, { small = false, target = welcomeTarget } = {}) => withTarget(port, target, async (send) => {
    const variants = [['light', 1280, 800], ['dark', 1280, 800], ...(small ? [['light', 720, 480], ['dark', 720, 480]] : [])];
    for (const [theme, width, height] of variants) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
      await new Promise((r) => setTimeout(r, 250));
      const png = Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
      await writeFile(join(shots, `${name}-${theme}-${width}.png`), png);
    }
    await send('Emulation.clearDeviceMetricsOverride');
    await send('Emulation.setEmulatedMedia', { features: [] });
    // Back at the real size before anything is clicked again.
    await new Promise((r) => setTimeout(r, 250));
  });
  await mkdir(shots, { recursive: true });
  await waitFor(() => page("!!document.querySelector('#start')"), 60000);
  return { w, port, page, shell, click, type, choose, step, atStep, state, shoot };
}

test('a fresh profile goes from welcome to an open gate and the normal window', { timeout: 300000 }, async (t) => {
  const { w, page, shell, click, type, choose, atStep, state, shoot } = await open(t);
  w.fixture.server.country = 'JP';
  w.fixture.server.colo = 'NRT';

  // (c) During setup the browser's views are detached: the tab strip and toolbar are not drawn and
  // navigation commands do nothing.
  assert.equal((await state()).setup.step, 'welcome');
  assert.equal(await shell('document.visibilityState'), 'hidden');
  const tabs = (await state()).tabs.length;
  await shell("cave.run('tab.new')");
  await shell("cave.run('address.focus')");
  assert.equal((await state()).tabs.length, tabs);
  assert.equal(await page('document.visibilityState'), 'visible');
  assert.equal(await page("getComputedStyle(document.querySelector('.setup-bar')).height"), '52px');
  // Setup may only make the calls it needs.
  await assert.rejects(page("cave.openSettings('overview')"), /forbidden/);
  await assert.rejects(page("cave.updateProfile({ monitorUrls: [] })"), /forbidden/);
  await assert.rejects(page("cave.addSubscription('http://sub.cave.test/sub.yaml', 'proxy')"), /forbidden/);
  await assert.rejects(page("cave.setSetup({ finished: true })"), /forbidden/);
  await shoot('01-welcome', { small: true });

  await click('#start');
  await atStep('path');
  await shoot('02-path');
  await click('#next');
  await atStep('source');
  await shoot('03-source');

  // The fetch is real: a 404, then a file with no Clash nodes, then the subscription.
  const base = `http://127.0.0.1:${w.fixture.port}`;
  await type('#sub-url', `${base}/missing.yaml`);
  await click('#import');
  await waitFor(() => page("document.querySelector('.fix.bad')?.textContent.includes('404')"));
  await shoot('04-source-failed', { small: true });
  w.fixture.server.subscription = 'rules: []\n';
  await type('#sub-url', `${base}/sub.yaml`);
  await click('#import');
  await waitFor(() => page("document.querySelector('.fix.warn')?.textContent.includes('Clash')"));
  await shoot('05-source-no-nodes');
  w.fixture.server.subscription = `proxies:\n  - { name: Test Node, type: socks5, server: 127.0.0.1, port: ${w.socks.port}, udp: false }\n  - { name: Offline, type: socks5, server: 127.0.0.1, port: 1, udp: false }\n`;
  await click('#import');
  await atStep('node');

  // The first node is taken and its exit measured; the gate stays closed until the user confirms.
  await waitFor(() => page("document.querySelector('#country').value === 'JP'"), 30000);
  assert.notEqual((await state()).gate.state, 'open');
  assert.match(await page("document.querySelector('.nodes li.selected').textContent"), /Test Node/);
  await shoot('06-node', { small: true });

  // A wrong country: the real check fails and says what it measured.
  await choose('#country', 'US');
  await click('#check-exit');
  await atStep('verify');
  await waitFor(() => page("!!document.querySelector('#use-observed')"), 60000);
  assert.equal((await state()).gate.state, 'closed');
  await shoot('07-verify-mismatch', { small: true });
  // A dead node: the check fails with the core's own error.
  await click('#back');
  await atStep('node');
  await click('.nodes li:nth-child(2) label');
  await choose('#country', 'JP');
  await click('#check-exit');
  await atStep('verify');
  await waitFor(() => page("document.querySelector('[data-condition=exit]')?.classList.contains('failed')"), 60000);
  await shoot('08-verify-failed');
  await click('#back');
  await atStep('node');
  await click('.nodes li:nth-child(1) label');
  await waitFor(() => page("document.querySelector('.nodes li.selected')?.textContent.includes('Test Node')"));
  await click('#check-exit');
  await atStep('verify');
  await waitFor(() => page("document.querySelector('[data-condition=exit]')?.classList.contains('ok')"), 60000);
  assert.equal((await state()).gate.state, 'open');
  assert.equal(await page("document.querySelectorAll('.steps li.done').length"), 2);
  await shoot('09-verify-ok', { small: true });

  // Identity from the measured site: Tokyo, rounded, nothing written before it is confirmed.
  await click('#next');
  await atStep('identity');
  await waitFor(() => page("document.querySelector('#identity-location').textContent.includes('东京')"), 30000);
  assert.equal(await page("document.querySelector('#identity-timezone').textContent"), 'Asia/Tokyo');
  assert.equal(await page("document.querySelector('#identity-languages').textContent"), 'ja-JP, ja');
  const before = JSON.parse(await readFile(join(w.dir, 'profile.json'), 'utf8'));
  assert.equal(before.setup.identityHandled, false);
  assert.equal(before.geolocation, null);
  await shoot('10-identity', { small: true });
  await click('details.more > summary');
  await shoot('11-identity-adjust');
  // Applying identity needs a restart, which a test cannot follow; keeping it is the same step.
  await click('#keep-identity');
  await atStep('personalise');
  await shoot('12-personalise', { small: true });
  await click('#finish');
  await atStep('done');
  await shoot('13-done', { small: true });
  // Back loses nothing and comes forward again.
  await click('#back');
  await atStep('personalise');
  await click('#finish');
  await atStep('done');
  await click('#start-browsing');
  await waitFor(async () => (await state()).setup.step === 'normal');
  await waitFor(async () => (await shell('document.visibilityState')) === 'visible');
  assert.equal((await state()).gate.state, 'open');
  const after = JSON.parse(await readFile(join(w.dir, 'profile.json'), 'utf8'));
  assert.deepEqual(after.setup, { started: true, identityHandled: true, personaliseHandled: true, dismissed: false, finished: true });
  assert.equal(after.egressCountry, 'JP');
  assert.equal(after.timezone, before.timezone);
});

test('set up later lands in the normal window; continue setup returns to the derived step', { timeout: 300000 }, async (t) => {
  const { port, page, click, type, choose, atStep, state, shoot } = await open(t);
  await click('#start');
  await atStep('path');
  await click('label.choice:nth-of-type(2)');
  await click('#next');
  await atStep('port');
  // Nothing listens on port 1: the check fails, and setup asks the port itself.
  await type('#ext-port', '1');
  await shoot('14-port');
  await click('#next');
  await atStep('node');
  await waitFor(() => page("!document.querySelector('.live')"), 30000);
  await choose('#country', 'JP');
  await shoot('15-node-external');
  await click('#check-exit');
  await atStep('verify');
  await waitFor(() => page("document.querySelector('[data-condition=node]')?.classList.contains('failed')"), 60000);
  assert.match(await page("document.querySelector('.fix.bad').textContent"), /127\.0\.0\.1:1/);
  await shoot('16-verify-port', { small: true });

  await click('#later');
  await waitFor(async () => (await state()).setup.step === 'normal');
  assert.equal((await state()).setup.pending, true);
  assert.notEqual((await state()).gate.state, 'open');
  await waitFor(() => evaluate(port, homeTarget, "!!document.querySelector('#continue-setup')"), 30000);
  await shoot('17-later-home', { target: homeTarget, small: true });
  await cdpClick(port, homeTarget, '#continue-setup');
  await waitFor(async () => (await state()).setup.step === 'verify');
  await atStep('verify');
  assert.equal(await page("document.querySelector('#ext-port') === null && document.querySelector('[data-condition=node] small').textContent.includes('127.0.0.1:1')"), true);

  // One overview of the built flow, composed in the page from the pictures above.
  const files = (await readdir(shots)).filter((f) => /-light-1280\.png$/.test(f)).sort();
  const images = await Promise.all(files.map(async (f) => [f.replace(/-light-1280\.png$/, ''), (await readFile(join(shots, f))).toString('base64')]));
  const overview = await page(`(async () => {
    const images = ${JSON.stringify(images)};
    const cols = 4, w = 400, h = 250, gap = 16, label = 22;
    const rows = Math.ceil(images.length / cols);
    const canvas = new OffscreenCanvas(cols * (w + gap) + gap, rows * (h + label + gap) + gap);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#e5e6e8'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '13px system-ui'; ctx.fillStyle = '#1b1c1e';
    for (const [i, [name, b64]] of images.entries()) {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const x = gap + (i % cols) * (w + gap), y = gap + Math.floor(i / cols) * (h + label + gap);
      ctx.drawImage(bitmap, x, y, w, h);
      ctx.strokeStyle = 'rgb(0 0 0 / .15)'; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
      ctx.fillText(name, x, y + h + 16);
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  })()`);
  await writeFile(join(shots, 'overview.png'), Buffer.from(overview, 'base64'));
});
