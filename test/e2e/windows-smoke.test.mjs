// Windows source/packaged smoke coverage. All traffic goes to the local fixture node;
// this does not certify a real subscription, SmartScreen, TUN or Windows Hello.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile as callbackExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { createServer } from 'node:net';
import { startWorld } from './harness.mjs';
import { devtoolsPort, evaluate, waitFor, screenshot } from './cdp.mjs';

const execFile = promisify(callbackExecFile);
const shell = u => u.endsWith('/shell.html');
const settings = u => u.endsWith('/settings.html');
const artifacts = process.env.CAVE_WINDOWS_ARTIFACTS;
async function debuggingArgs() {
  // Port zero makes Chromium expose navigator.webdriver=true. Use a reserved nonzero port.
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return [`--remote-debugging-port=${port}`];
}
async function save(name, data) {
  if (!artifacts) return;
  await mkdir(artifacts, { recursive: true });
  await writeFile(join(artifacts, name), data);
}
async function corePid(parent) {
  const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${parent} AND Name = 'cave-core.exe'" | Select-Object -ExpandProperty ProcessId`], { windowsHide: true });
  return Number(stdout.trim());
}

test('Windows: fresh profile blocks navigation before any node is imported', { skip: process.platform !== 'win32' }, async t => {
  const w = await startWorld({ fresh: true, blank: true, extra: await debuggingArgs() });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const state = await waitFor(async () => { const s = await evaluate(port, shell, 'cave.getState()'); return s.gate.state === 'closed' && s; });
  assert.equal(state.gate.state, 'closed');
  assert.equal(state.tabs.find(tab => tab.id === state.active)?.kind, 'settings');
  await evaluate(port, shell, "cave.setLocale('zh')");
  await save('fresh-settings.txt', await evaluate(port, settings, 'document.body.innerText'));
  await waitFor(() => evaluate(port, settings, '!!document.querySelector("[data-section=nodes]:not([hidden])")'));
  assert.equal((await evaluate(port, settings, 'cave.panelData()')).profile.connectionMode, 'system');
  await evaluate(port, shell, "cave.navigate('https://example.com')");
  await waitFor(() => evaluate(port, u => u.endsWith('/overlay.html'), 'document.body.innerText.includes("example.com")'));
  const text = await evaluate(port, u => u.endsWith('/overlay.html'), 'document.body.innerText');
  assert.match(text, /还没有导入节点/);
  assert.equal(w.fixture.requests.length, 0);
  assert.equal(w.socks.targets.length, 0);
  const checks = await evaluate(port, settings, 'cave.runChecks()');
  assert.equal(checks.length, 13);
  assert.equal(checks[10].pass, false);
  await save('fresh-state.json', JSON.stringify({ state, text, checks }, null, 2));
  await save('fresh-shell.png', await screenshot(port, shell));
});

test('Windows: local node passes checks, core crash rechecks, mismatch remains closed', { skip: process.platform !== 'win32' }, async t => {
  const w = await startWorld({ blank: true, extra: await debuggingArgs() });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const state = () => evaluate(port, shell, 'cave.getState()');
  await waitFor(async () => (await state()).gate.state === 'open', 60000);
  await evaluate(port, shell, "cave.openSettings('overview')");
  const checks = await evaluate(port, settings, 'cave.runChecks()');
  await save('checks.json', JSON.stringify(checks, null, 2));
  assert.equal(checks.length, 13);
  assert.deepEqual(checks.filter(check => !check.pass), []);
  await evaluate(port, settings, 'cave.copyReport()');
  // Read exactly what the application's Copy Report action put on the clipboard.
  const { stdout: report } = await execFile('powershell.exe', ['-NoProfile', '-Command', '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard -Raw'], { windowsHide: true, encoding: 'utf8' });
  await save('self-check-report.txt', report);
  const runtime = parse(await readFile(join(w.dir, 'runtime.yaml'), 'utf8'));
  assert.equal(runtime['interface-name'], undefined, 'default routing must still follow the system TUN');
  assert.ok(runtime.listeners.every(listener => listener.listen === '127.0.0.1' && ![7890, 9090].includes(listener.port)));
  assert.ok(![7890, 9090].includes(Number(runtime['external-controller'].split(':').at(-1))));
  const originalNodes = (await evaluate(port, settings, 'cave.panelData()')).profile.proxy;
  await evaluate(port, settings, 'cave.updateProfile({connectionMode:"independent"})');
  await waitFor(async () => (await state()).gate.state === 'open', 30000);
  assert.ok(parse(await readFile(join(w.dir, 'runtime.yaml'), 'utf8'))['interface-name']);
  assert.deepEqual((await evaluate(port, settings, 'cave.panelData()')).profile.proxy, originalNodes, 'the switch must not rewrite node definitions');
  await evaluate(port, settings, 'cave.pause()');
  await evaluate(port, settings, 'cave.updateProfile({connectionMode:"system"})');
  assert.equal((await state()).gate.paused, true, 'a routing change must not undo a manual pause');
  assert.equal(await corePid(w.child.pid), 0);
  await evaluate(port, settings, 'cave.resume()');
  await waitFor(async () => (await state()).gate.state === 'open', 30000);
  assert.equal(parse(await readFile(join(w.dir, 'runtime.yaml'), 'utf8'))['interface-name'], undefined);
  await evaluate(port, shell, "cave.navigate('http://fp.cave.test/find.html')");
  const page = u => u === 'http://fp.cave.test/find.html';
  await waitFor(() => evaluate(port, page, 'document.title'));
  const identity = await evaluate(port, page, `(async()=>({ua:navigator.userAgent, platform:navigator.platform, webdriver:navigator.webdriver, uaData:await navigator.userAgentData.getHighEntropyValues(['platformVersion','architecture','bitness','fullVersionList']), worker:await new Promise(resolve=>{const worker=new Worker(URL.createObjectURL(new Blob(['postMessage({ua:navigator.userAgent,platform:navigator.platform,languages:navigator.languages})'])));worker.onmessage=e=>{worker.terminate();resolve(e.data)}})}))()`);
  await save('identity.json', JSON.stringify(identity, null, 2));
  assert.equal(identity.platform, 'Win32');
  assert.equal(identity.worker.platform, 'Win32');
  assert.equal(identity.webdriver, false);
  assert.doesNotMatch(identity.ua, /Electron/);
  await save('open-shell.png', await screenshot(port, shell));

  const first = await corePid(w.child.pid);
  assert.ok(first > 0);
  const killedAt = Date.now();
  await execFile('taskkill', ['/PID', String(first), '/F'], { windowsHide: true });
  await waitFor(async () => (await state()).gate.state !== 'open', 5000, 25);
  const closedAfterMs = Date.now() - killedAt;
  const blocked = await evaluate(port, page, "fetch('/during-core-crash').then(()=>'reached',()=>'blocked')");
  assert.equal(blocked, 'blocked');
  await waitFor(async () => (await state()).gate.state === 'open', 20000, 50);
  const reopenedAfterMs = Date.now() - killedAt;
  const second = await corePid(w.child.pid);
  assert.ok(second > 0 && second !== first);
  assert.ok(!w.fixture.requests.some(request => request.url === '/during-core-crash'));

  w.fixture.server.country = 'QN';
  await execFile('taskkill', ['/PID', String(second), '/F'], { windowsHide: true });
  await waitFor(async () => { const gate = (await state()).gate; return gate.state === 'closed' && gate.reason.includes('QN'); }, 20000);
  assert.equal(await evaluate(port, page, "fetch('/mismatch').then(()=>'reached',()=>'blocked')"), 'blocked');
  assert.ok(!w.fixture.requests.some(request => request.url === '/mismatch'));
  await save('crash-result.json', JSON.stringify({ closedAfterMs, reopenedAfterMs, mismatch: (await state()).gate }, null, 2));
  await save('core.log', await readFile(join(w.dir, 'logs/core.log')));
  await save('app.log', w.log());
});
