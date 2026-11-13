// End-to-end on a real Cave window (Linux, Xvfb). Everything stays on this machine: the "node"
// is a local SOCKS5 server and every page is served by the local fixture server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { X509Certificate, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { launch, startWorld, PROFILE } from './harness.mjs';
import { startFixtureServer } from '../server.mjs';
import { startSocks } from '../socks.mjs';
import { click, devtoolsPort, evaluate, gateState, listTargets, rightClick, waitFor, withTarget } from './cdp.mjs';

const isFixture = (u) => u.startsWith('http://fp.cave.test/');

test('find displays match counts and clears them', async (t) => {
  const w = await startWorld({ blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = (expr) => evaluate(port, (u) => u.endsWith('/shell.html'), expr);
  await waitFor(async () => (await gateState(port)) === 'open', 60000);
  await shell("cave.navigate('http://find.cave.test/find.html')");
  await waitFor(() => evaluate(port, (u) => u === 'http://find.cave.test/find.html', 'document.title'));
  await shell("cave.run('page.find')");
  const input = (value) => shell(`(() => { const el = document.querySelector('#find-input'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const count = () => shell("document.querySelector('#find-count').textContent");
  await input('Example');
  await waitFor(async () => (await count()) === '1/2');
  await shell("document.querySelector('#find-next').click()");
  await waitFor(async () => (await count()) === '2/2');
  await shell("document.querySelector('#find-previous').click()");
  await waitFor(async () => (await count()) === '1/2');
  await shell("document.querySelector('#find-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))");
  await waitFor(async () => (await count()) === '2/2');
  await shell("document.querySelector('#find-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))");
  await waitFor(async () => (await count()) === '1/2');
  await input('absentword');
  await waitFor(async () => (await count()) === '0/0');
  await input('Example');
  await input('absentword');
  await waitFor(async () => (await count()) === '0/0');
  await input('');
  assert.equal(await count(), '');
  assert.equal(await shell("document.querySelector('#find-next').disabled && document.querySelector('#find-previous').disabled"), true);
  await input('Example');
  await waitFor(async () => (await count()) === '1/2');
  await shell("document.querySelector('#find-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  assert.equal(await shell("document.querySelector('#find').hidden"), true);
  await waitFor(async () => (await evaluate(port, (u) => u === 'http://find.cave.test/find.html', 'window.getSelection().toString()')) === 'Example');
  await shell("cave.run('page.find')");
  assert.deepEqual(await shell("[document.querySelector('#find-input').value, document.querySelector('#find-input').selectionStart, document.querySelector('#find-input').selectionEnd]"), ['Example', 0, 7]);
  const first = await shell('cave.getState().then(s => s.active)');
  await shell('cave.newTab()');
  await waitFor(async () => (await shell('cave.getState()')).active !== first);
  await waitFor(() => shell("document.querySelector('#find').hidden && document.querySelector('#find-input').value === ''"));
  await shell("cave.run('page.find')");
  assert.equal(await shell("document.querySelector('#find').hidden"), true);
  await shell(`cave.activate(${first})`);
  await shell("cave.run('page.find')");
  await input('Example');
  await waitFor(async () => (await count()) === '1/2');
  await shell("cave.navigate('http://find.cave.test/')");
  await waitFor(() => shell("document.querySelector('#find').hidden && document.querySelector('#find-input').value === ''"));
  await shell("cave.openSettings()");
  await waitFor(async () => { const s = await shell('cave.getState()'); return s.tabs.find(t => t.id === s.active)?.kind === 'settings'; });
  await shell("cave.run('page.find')");
  assert.equal(await shell("document.querySelector('#find').hidden"), true);
});

test('TLS fixture pins only the trusted certificate through the proxy', async (t) => {
  const w = await startWorld({ tls: true, blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = (expr) => evaluate(port, (u) => u.endsWith('/shell.html'), expr);
  await waitFor(async () => (await gateState(port)) === 'open');
  await shell(`cave.navigate(${JSON.stringify(w.httpsUrl)})`);
  assert.equal(await waitFor(() => evaluate(port, (u) => u === w.httpsUrl, 'document.title')), 'Example Domain');
  await shell("cave.navigate('https://bad.cave.test/')");
  const warning = await waitFor(async () => (await shell('cave.getState()')).recovery);
  assert.equal(warning.kind, 'certificate');
  const recovery = (u) => u.endsWith('/internal-error.html');
  assert.equal(await waitFor(() => evaluate(port, recovery, 'document.querySelector("h1")?.textContent')), '连接不安全');
  await click(port, recovery, '.primary');
  await waitFor(async () => !(await shell('cave.getState()')).recovery);
  assert.ok(w.socks.targets.some(({ host, port }) => host === 'secure.cave.test' && port === 443));
  assert.ok(w.socks.targets.some(({ host, port }) => host === 'bad.cave.test' && port === 443));
  assert.equal(w.untrustedFixture.requests.length, 0);
  assert.equal(await waitFor(() => evaluate(port, (u) => u === w.httpsUrl, 'typeof window.cave')), 'undefined');
  await shell("cave.newTab('https://bad.cave.test/')");
  const second = await waitFor(async () => (await shell('cave.getState()')).recovery);
  assert.notEqual(second.tabId, warning.tabId);
  await click(port, recovery, '.primary');
  await waitFor(async () => { const s = await shell('cave.getState()'); return !s.recovery && s.tabs.find((tab) => tab.id === second.tabId)?.url === ''; });
});

test('fingerprint: profile values reach the main thread and every worker; nothing says Electron', async (t) => {
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const debugPort = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const w = await startWorld({ tls: true, blank: true, extra: [`--remote-debugging-port=${debugPort}`] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = u => u.endsWith('/shell.html');
  const overlay = u => u.endsWith('/overlay.html');
  await waitFor(async () => (await gateState(port)) === 'open', 60000);
  await evaluate(port, shell, `cave.navigate(${JSON.stringify(w.httpsUrl + 'fp.html')})`);
  await waitFor(() => evaluate(port, overlay, '!!document.querySelector("#permission")'));
  await click(port, overlay, '#permission .actions button:nth-child(2)');
  const r = await w.httpsFixture.nextReport(45000);

  const scopes = { main: r.main, worker: r.worker, shared: r.shared, serviceWorker: r.serviceWorker };
  for (const [name, s] of Object.entries(scopes)) {
    assert.ok(s, `${name} reported`);
    assert.equal(s.timezone, PROFILE.timezone, `${name} timezone`);
    assert.equal(s.intlLocale, PROFILE.locale, `${name} Intl locale`);
    assert.deepEqual(s.languages, PROFILE.acceptLanguages, `${name} languages`);
    assert.doesNotMatch(s.userAgent, /Electron|Cave|HeadlessChrome/, `${name} UA`);
    assert.match(s.userAgent, /Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/, `${name} UA is reduced Chrome`);
    assert.deepEqual(s.uaData.brands.map((b) => b.brand).sort(), ['Chromium', 'Google Chrome', 'Not:A-Brand'], `${name} brands`);
    assert.equal(s.uaData.high.fullVersionList.find((b) => b.brand === 'Google Chrome').version.split('.').length, 4);
  }
  assert.equal(r.main.userAgent, r.headers['user-agent']);
  assert.equal(r.headers['accept-language'], 'de-DE,de;q=0.9,en;q=0.8');
  assert.match(r.headers['sec-ch-ua'], /"Google Chrome";v="\d+"/);
  assert.deepEqual(r.geolocation, PROFILE.geolocation);
  assert.equal(r.main.webdriver, false);
  // WebRTC: only mDNS host candidates, never an address.
  for (const c of r.webrtc) assert.doesNotMatch(c, / (\d{1,3}\.){3}\d{1,3} | [0-9a-f]*:[0-9a-f:]+ /i, c);
  assert.equal(r.permissions.notifications, 'denied');
  assert.equal(r.permissions.camera, 'denied');
  // The node only ever saw names (remote resolution), all of them fixtures.
  assert.ok(w.socks.targets.length > 0);
  for (const target of w.socks.targets) {
    assert.equal(target.atyp, 3, `${target.host} sent as a hostname`);
    assert.match(target.host, /\.cave\.test$/);
  }
});

test('leak: with a host proxy present, the process tree only uses its own core; killing the core locks the gate', { skip: process.platform === 'darwin' ? 'strace is Linux-only' : false }, async (t) => {
  // A host proxy client is "running": something listens on 7890. Cave must not use it.
  const decoy = await listenDecoy(7890);
  t.after(() => decoy.close());
  const traceFile = join(await mkdtemp(join(tmpdir(), 'cave-strace-')), 'trace.log');
  const w = await startWorld({
    wrap: ['strace', '-f', '-qq', '-yy', '-e', 'trace=connect,sendto,sendmmsg', '-e', 'signal=none', '-o', traceFile],
    extra: ['--remote-debugging-port=0'],
  });
  t.after(() => w.stop());
  await w.fixture.nextReport(60000);
  const port = await devtoolsPort(w.log);
  assert.equal(await waitFor(async () => (await gateState(port)) === 'open' && 'open'), 'open');

  const runtime = parse(await readFile(join(w.dir, 'runtime.yaml'), 'utf8'));
  const corePid = Number(execFileSync('pgrep', ['-f', `^[^ ]*cave-core -d ${w.dir}`], { encoding: 'utf8' }).trim());
  assert.ok(corePid > 0, 'core is running');

  // The node moves to another country while the core is down: the gate must stay locked.
  w.fixture.server.country = 'QN';
  process.kill(corePid, 'SIGKILL');
  await waitFor(async () => (await gateState(port)) !== 'open');
  const seen = w.fixture.requests.length;
  const leaked = await evaluate(port, isFixture, `fetch('http://fp.cave.test/leak?' + Date.now()).then(() => 'reached', () => 'blocked')`);
  assert.equal(leaked, 'blocked');
  await waitFor(async () => (await gateState(port)) === 'closed' && w.fixture.requests.slice(seen).some((r) => r.url.startsWith('/cdn-cgi/trace')), 20000);
  await new Promise((r) => setTimeout(r, 3000));
  assert.equal(await gateState(port), 'closed', 'mismatched country keeps it closed after the core restarts');
  const again = await evaluate(port, isFixture, `fetch('http://fp.cave.test/leak2').then(() => 'reached', () => 'blocked')`);
  assert.equal(again, 'blocked');
  const after = w.fixture.requests.slice(seen).map((r) => r.url);
  assert.deepEqual(after.filter((u) => !u.startsWith('/cdn-cgi/trace')), [], 'only egress checks reached the node');
  assert.ok(runtime.listeners.every((l) => l.listen === '127.0.0.1'));

  await w.stop();
  const allowed = new Set([runtime.listeners[0].port, runtime.listeners[1].port, Number(runtime['external-controller'].split(':')[1]), w.socks.port]);
  const traffic = unexpectedTraffic((await readFile(traceFile, 'utf8')).split('\n'), allowed);
  assert.ok(traffic.seen > 0, 'strace saw network calls');
  assert.deepEqual(traffic.leaks, [], 'nothing went anywhere but Cave\'s own ports and the node');
  assert.equal(decoy.connections, 0, 'the host proxy port was never touched');
});

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;

/**
 * Real traffic only: a TCP connect, or a UDP datagram sent, to anything but Cave's own loopback ports
 * and the test node. (Chromium connects never-used UDP sockets to 8.8.8.8 and 2001:4860:4860::8888
 * to learn the default route; nothing is sent on them, so a bare UDP connect is not traffic.)
 */
function unexpectedTraffic(lines, allowedPorts) {
  let seen = 0;
  const leaks = [];
  for (const line of lines) {
    const m = /^\d+ +(connect|sendto|sendmmsg)\(\d+<(TCP|TCPv6|UDP|UDPv6):\[([^\]]*)\]>(.*)$/.exec(line);
    if (!m) continue;
    seen++;
    const [, call, proto, socketInfo, rest] = m;
    const udp = proto.startsWith('UDP');
    // TCP: the connect is the event (sends follow an already-checked connect or are a server's
    // replies). UDP: the datagram is the event; a bare connect sends nothing.
    if (udp === (call === 'connect')) continue;
    const explicit = /htons\((\d+)\).*?(?:inet_addr\("([^"]+)"\)|inet_pton\(AF_INET6, "([^"]+)")/.exec(rest);
    const peer = /->\[?([^\]]*?)\]?:(\d+)$/.exec(socketInfo);
    const [addr, port] = explicit ? [explicit[2] ?? explicit[3], Number(explicit[1])] : peer ? [peer[1], Number(peer[2])] : [];
    if (!addr) continue;
    if (LOOPBACK.test(addr) && allowedPorts.has(port)) continue;
    leaks.push(line.slice(0, 300));
  }
  return { seen, leaks };
}

function listenDecoy(port) {
  const decoy = { connections: 0, close: () => new Promise((r) => server.close(r)) };
  const server = createServer((c) => (decoy.connections++, c.destroy()));
  return new Promise((resolve) => {
    server.once('error', () => resolve({ connections: 0, close: async () => undefined }));
    server.listen(port, '127.0.0.1', () => resolve(decoy));
  });
}

test('settings: all self-checks pass when open; pause stops the core and resume re-verifies', async (t) => {
  const w = await startWorld({ extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  await w.fixture.nextReport(45000);
  const port = await devtoolsPort(w.log);
  const settings = (expr) => evaluate(port, (u) => u.endsWith('/settings.html'), expr);

  const checks = await settings('cave.runChecks()');
  assert.equal(checks.length, 13);
  assert.deepEqual(checks.filter((c) => !c.pass).map((c) => `${c.title}: ${c.detail}`), []);

  const corePids = () => execFileSync('pgrep', ['-f', `^[^ ]*cave-core -d ${w.dir}`], { encoding: 'utf8' }).trim();
  await settings('cave.pause()');
  assert.equal(await gateState(port), 'closed');
  assert.equal(await settings('cave.getState().then((s) => s.gate.paused)'), true);
  assert.equal(await waitFor(() => settings("document.querySelector('#pause.switch[role=switch]')?.checked === false")), true);
  assert.throws(corePids, 'no core process while paused');
  const blocked = await evaluate(port, isFixture, `fetch('http://fp.cave.test/paused').then(() => 'reached', () => 'blocked')`);
  assert.equal(blocked, 'blocked');

  await settings('cave.resume()');
  assert.equal(await waitFor(async () => (await gateState(port)) === 'open' && 'open'), 'open');
  assert.equal(await settings('cave.getState().then((s) => s.gate.paused)'), false);
  assert.equal(await waitFor(() => settings("document.querySelector('#pause.switch[role=switch]')?.checked === true")), true);
  assert.ok(corePids());
  assert.ok(!w.fixture.requests.some((r) => r.url === '/paused'));
});

test('nodes: subscription fetch direct or via the node; a click on a row selects it and the check follows', async (t) => {
  // A second "node" that exits in QN, listed first so the first fetch lands on it.
  const secondary = await startFixtureServer({ country: 'QN' });
  const secondaryNode = await startSocks({ map: (host) => (host.endsWith('.cave.test') ? { host: '127.0.0.1', port: secondary.port } : null) });
  const w = await startWorld({ extra: ['--remote-debugging-port=0'] });
  t.after(async () => (await w.stop(), await secondary.close(), await secondaryNode.close()));
  await w.fixture.nextReport(45000);
  const port = await devtoolsPort(w.log);
  const settings = (expr) => evaluate(port, (u) => u.endsWith('/settings.html'), expr);
  const gate = () => evaluate(port, (u) => u.endsWith('/shell.html'), 'cave.getState().then((s) => s.gate)');
  w.fixture.server.subscription = `proxies:
  - { name: "◆ Node B", type: socks5, server: 127.0.0.1, port: ${secondaryNode.port}, udp: false }
  - { name: "◇ Node A #2", type: socks5, server: 127.0.0.1, port: ${w.socks.port}, udp: false }
`;

  // Adding a source preserves the current selection; it does not pick the first new node.
  const direct = `http://127.0.0.1:${w.fixture.port}/sub.yaml`;
  await settings(`cave.addSubscription(${JSON.stringify(direct)}, 'direct')`);
  const fetched = w.fixture.requests.filter((r) => r.url === '/sub.yaml');
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].headers['user-agent'], 'clash.meta');
  assert.ok(![...w.socks.targets, ...secondaryNode.targets].some((x) => x.host === '127.0.0.1'), 'no node carried it');
  let data = await settings('cave.panelData()');
  const source = data.profile.proxy.sources.find(s => s.origin.url === direct);
  assert.ok(source);
  assert.deepEqual(source.nodes.map(n => n.name), ['◆ Node B', '◇ Node A #2']);
  assert.deepEqual(data.nodes.selected, { source: 'legacy', node: 'Test Node' });
  assert.equal(await gateState(port), 'open');

  await evaluate(port, (u) => u.endsWith('/shell.html'), "cave.openSettings('nodes')");
  const clickNode = name => settings(`[...document.querySelectorAll('[data-source="${source.id}"] li')].find(li => li.textContent.includes(${JSON.stringify(name)})).querySelector('.name').click()`);
  await waitFor(() => settings(`document.querySelector('[data-source="${source.id}"] li')`));
  await clickNode('Node B');
  await waitFor(() => dialog(settings));
  await answer(settings, 'ok');
  await waitFor(async () => (await gate()).reason.includes('QN'));
  assert.deepEqual((await settings('cave.panelData()')).nodes.selected, { source: source.id, node: '◆ Node B' });

  // Clicking the row switches to Node A and re-checks through that node.
  await clickNode('Node A');
  await waitFor(() => dialog(settings));
  await answer(settings, 'ok');
  assert.equal(await waitFor(async () => (await gateState(port)) === 'open' && 'open'), 'open');
  data = await settings('cave.panelData()');
  assert.deepEqual(data.nodes.selected, { source: source.id, node: '◇ Node A #2' });
  assert.deepEqual(data.nodes.nodes.filter(n => n.source === source.id).map(n => n.name), ['◆ Node B', '◇ Node A #2']);
  assert.deepEqual(source.origin, { kind: 'subscription', url: direct, via: 'direct' });
  await settings(`cave.updateSource(${JSON.stringify(source.id)})`);
  assert.deepEqual((await settings('cave.panelData()')).nodes.selected, { source: source.id, node: '◇ Node A #2' });
  assert.equal(await waitFor(async () => (await gateState(port)) === 'open' && 'open'), 'open');

  // A proxy-fetched source can be refreshed without disturbing the selected node.
  await settings(`cave.addSubscription('http://sub.cave.test/sub.yaml', 'proxy')`);
  const proxySource = (await settings('cave.panelData()')).profile.proxy.sources.find(s => s.origin.url === 'http://sub.cave.test/sub.yaml');
  assert.deepEqual(proxySource.origin, { kind: 'subscription', url: 'http://sub.cave.test/sub.yaml', via: 'proxy' });
  const before = w.socks.targets.filter(x => x.host === 'sub.cave.test').length;
  assert.ok(before > 0, 'fetched through the selected node');
  await settings(`cave.updateSource(${JSON.stringify(proxySource.id)})`);
  assert.ok(w.socks.targets.filter(x => x.host === 'sub.cave.test').length > before, 'refreshed through the selected node');
  assert.equal(await waitFor(async () => (await gateState(port)) === 'open' && 'open'), 'open');
  assert.deepEqual((await settings('cave.panelData()')).nodes.selected, { source: source.id, node: '◇ Node A #2' });
});

const dialog = (settings) => settings(`(() => { const d = document.getElementById('confirm'); return d.open && document.getElementById('confirm-title').textContent + ' | ' + document.getElementById('confirm-body').textContent; })()`);
const answer = (settings, value) => settings(`document.querySelector('#confirm button[value=${value}]').click()`);

test('switch: changing from a chosen node asks first; cancel keeps it, confirm switches', async (t) => {
  const w = await startWorld({ extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  await w.fixture.nextReport(45000);
  const port = await devtoolsPort(w.log);
  const settings = (expr) => evaluate(port, (u) => u.endsWith('/settings.html'), expr);
  const node = (p) => `{ name: "${p}", type: socks5, server: 127.0.0.1, port: ${w.socks.port}, udp: false }`;
  await settings(`cave.updateSourceText('legacy', ${JSON.stringify(`proxies:\n  - ${node('Test Node')}\n  - ${node('Second')}\n`)})`);
  await waitFor(async () => (await gateState(port)) === 'open');
  // Open the settings tab where the nodes are, as the user does before clicking in it.
  await evaluate(port, (u) => u.endsWith('/shell.html'), "cave.openSettings('nodes')");
  const click = () => settings(`[...document.querySelectorAll('[data-section=nodes] li')].find((li) => li.textContent.includes('Second')).querySelector('.name').click()`);
  const selected = async () => (await settings('cave.panelData()')).nodes.selected?.node;

  await click();
  const text = await waitFor(() => dialog(settings));
  assert.match(text, /从「Test Node」切换到「Second」/);
  assert.match(text, /连接都会断开/);
  assert.match(text, /重新核对出口国家/, 'Second has never been checked');
  await answer(settings, 'cancel');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await selected(), 'Test Node');
  assert.equal(await settings(`[...document.querySelectorAll('[data-section=nodes] input[name=node]')].filter((r) => r.checked).length`), 1);
  assert.equal(await settings(`document.querySelector('[data-section=nodes] li.selected').textContent.includes('Test Node')`), true);

  await click();
  await waitFor(() => dialog(settings));
  await answer(settings, 'ok');
  assert.equal(await waitFor(async () => (await selected()) === 'Second' && 'Second'), 'Second');
  assert.equal(await waitFor(async () => (await gateState(port)) === 'open' && 'open'), 'open');
});

test('site data: clearing one site leaves the others; a reset clears everything', async (t) => {
  const w = await startWorld({ extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  await w.fixture.nextReport(45000);
  const port = await devtoolsPort(w.log);
  const settings = (expr) => evaluate(port, (u) => u.endsWith('/settings.html'), expr);
  const shell = (expr) => evaluate(port, (u) => u.endsWith('/shell.html'), expr);
  await shell("cave.setLocale('zh')");
  await waitFor(async () => (await gateState(port)) === 'open');
  const stored = (site) =>
    evaluate(port, (u) => u.startsWith(`http://${site}/`), `fetch('/headers', { cache: 'no-store' }).then((r) => r.json()).then((h) => (h.cookie ?? '') + '|' + (localStorage.getItem('k') ?? ''))`);

  await shell(`cave.navigate('http://one.test/setcookie?a=1')`);
  await shell(`cave.newTab('http://two.test/setcookie?b=2')`);
  assert.equal(await waitFor(() => stored('one.test')), 'a=1|1');
  assert.equal(await waitFor(() => stored('two.test')), 'b=2|2');

  // Settings clears the site of the web tab last in front, after naming it in the confirmation.
  const first = await shell(`cave.getState().then((s) => s.tabs.find((t) => t.url.startsWith('http://one.test/')).id)`);
  await shell(`cave.activate(${first})`);
  await shell("cave.openSettings('privacy')");
  await waitFor(() => settings(`document.getElementById('site-name').textContent === 'one.test'`));
  await settings(`document.getElementById('clear-site').click()`);
  assert.match(await waitFor(() => dialog(settings)), /清除 one\.test 的网站数据/);
  await answer(settings, 'ok');
  assert.equal(await waitFor(async () => (await stored('one.test')) === '|' && '|'), '|');
  assert.equal(await stored('two.test'), 'b=2|2', 'the other site keeps its data');

  await settings(`document.getElementById('reset-env').click()`);
  assert.match(await waitFor(() => dialog(settings)), /重置整个环境/);
  await answer(settings, 'ok');
  await waitFor(() => shell(`cave.getState().then((s) => s.tabs.length === 1 && !s.tabs[0].url.startsWith('http'))`));
  await shell(`cave.navigate('http://two.test/')`);
  assert.equal(await waitFor(() => stored('two.test')), '|', 'nothing survives a reset');
});

test('chrome: a blocked address opens only the status popover; the tab layout persists', async (t) => {
  const w = await startWorld({ extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  await w.fixture.nextReport(45000);
  const port = await devtoolsPort(w.log);
  const shell = (expr) => evaluate(port, (u) => u.endsWith('/shell.html'), expr);
  await shell("cave.setLocale('zh')");
  const state = () => shell('cave.getState()');

  await shell('cave.pause()');
  await shell(`cave.navigate('http://fp.cave.test/headers')`);
  const s = await waitFor(async () => ((await state()).surface?.name === 'status' ? state() : null));
  assert.equal(s.tabs.find((tab) => tab.id === s.active).kind, 'web', 'the page stays in front');
  assert.ok(!s.tabs.some((tab) => tab.kind === 'settings'), 'no settings tab is forced open');
  assert.match(s.notice, /fp\.cave\.test/);
  assert.match(await evaluate(port, (u) => u.endsWith('/overlay.html'), `document.getElementById('notice').textContent`), /放行后会自动打开 fp\.cave\.test/);

  await shell('cave.resume()');
  await waitFor(async () => (await state()).tabs.some((tab) => tab.url === 'http://fp.cave.test/headers'));

  await shell(`cave.setTabLayout('side')`);
  assert.equal((await state()).tabLayout, 'side');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(w.dir, 'cave.sqlite'), { readOnly: true });
  assert.equal(JSON.parse(db.prepare("SELECT value FROM prefs WHERE key='tabLayout'").get().value), 'side');
  db.close();

  // No tab can load the shell's own pages, not even by a browser-initiated load (the link context menu).
  const page = new URL('../../dist/renderer/settings.html', import.meta.url).href;
  await shell(`cave.newTab(${JSON.stringify(page)})`);
  await new Promise((r) => setTimeout(r, 800));
  assert.ok(!(await state()).tabs.some((tab) => tab.url.startsWith('file:')), 'a file: URL never reaches a tab');
});

test('chrome: a surface opens by its anchor, takes presses, and closes on a press beside it', async (t) => {
  const w = await startWorld({ extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  await w.fixture.nextReport(45000);
  const port = await devtoolsPort(w.log);
  const isShell = (u) => u.endsWith('/shell.html');
  const isOverlay = (u) => u.endsWith('/overlay.html');
  const state = () => evaluate(port, isShell, 'cave.getState()');
  const box = (match, selector) => evaluate(port, match, `(({ x, y, width, height }) => ({ x, y, width, height }))(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect())`);

  for (const layout of ['top', 'side']) {
    await evaluate(port, isShell, `cave.setTabLayout('${layout}')`);
    // The card may already be open (a load that waited for the gate opens it); start from closed.
    await evaluate(port, isShell, 'cave.closeSurface()');
    await click(port, isShell, '#status');
    const s = await waitFor(async () => ((await state()).surface ? state() : null));
    assert.equal(s.surface.name, 'status');
    await click(port, isShell, '#status');
    await waitFor(async () => !(await state()).surface);
    await click(port, isShell, '#status');
    await waitFor(async () => (await state()).surface?.name === 'status');
    const anchor = await box(isShell, '#status');
    assert.deepEqual(s.surface.anchor, Object.fromEntries(Object.entries(anchor).map(([k, v]) => [k, Math.round(v)])));
    await waitFor(() => evaluate(port, isOverlay, "innerWidth > 300 && innerHeight > 100 && document.querySelector('#status')?.classList.contains('in')"));
    const card = await box(isOverlay, '#status');
    const size = await evaluate(port, isOverlay, '({ width: innerWidth, height: innerHeight })');
    const bounds = await evaluate(port, isShell, 'cave.testSuggestionBounds()');
    assert.deepEqual([card.x, card.y], [0, 0]);
    assert.ok(Math.abs(card.width - bounds.width) < 1 && Math.abs(card.height - bounds.height) < 1, JSON.stringify({ card, bounds }));
    assert.ok(layout === 'top' ? bounds.y >= anchor.y + anchor.height : bounds.y + bounds.height <= anchor.y, JSON.stringify({ layout, bounds, anchor }));
    assert.ok(card.x >= 0 && card.y >= 0 && card.x + card.width <= size.width + 1 && card.y + card.height <= size.height + 1, JSON.stringify({ layout, card, size, anchor }));
    assert.ok(size.width < s.surface.viewport.width && size.height < s.surface.viewport.height, `${layout}: overlay fits the card`);
    await click(port, isShell, '#menu-button');
    await waitFor(async () => (await state()).surface?.name === 'menu');
    await evaluate(port, isShell, 'cave.closeSurface()');
  }

  // A press on the card's button does what it says.
  await evaluate(port, isShell, 'cave.closeSurface()');
  await click(port, isShell, '#status');
  await waitFor(async () => (await state()).surface);
  await waitFor(() => evaluate(port, isOverlay, "document.querySelector('#status')?.classList.contains('in')"));
  await click(port, isOverlay, '#open-settings');
  const s = await waitFor(async () => ((await state()).tabs.some((tab) => tab.kind === 'settings') ? state() : null));
  assert.equal(s.tabs.find((tab) => tab.id === s.active).kind, 'settings');
  assert.equal(s.surface, null, 'the surface closes when the tab changes');

  // Commands run by name, from any shell page.
  const before = (await state()).tabs.length;
  await evaluate(port, isShell, `cave.run('tab.new')`);
  await waitFor(async () => (await state()).tabs.length === before + 1);
});

test('surfaces: toolbar card views never cover their anchors', async (t) => {
  const w = await startWorld({ blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log), shell = u => u.endsWith('/shell.html');
  const run = expr => evaluate(port, shell, expr);
  await waitFor(async () => (await gateState(port)) === 'open', 60000);
  await run("cave.navigate('http://download.cave.test/')");
  await waitFor(() => evaluate(port, u => u === 'http://download.cave.test/', 'document.title'));
  await evaluate(port, u => u === 'http://download.cave.test/', "location.href='/slow-download'");
  await waitFor(async () => (await run('cave.getState()')).downloads.length);
  await click(port, shell, '#bookmark');
  await waitFor(async () => (await run('cave.getState()')).bookmarked);
  for (const layout of ['top', 'side']) {
    await run(`cave.setTabLayout('${layout}')`);
    for (const [name, selector] of [['status', '#status'], ['downloads', '#downloads'], ['menu', '#menu-button'], ['bookmarkEdit', '#bookmark']]) {
      await run('cave.closeSurface()');
      await click(port, shell, selector);
      const state = await waitFor(async () => { const s = await run('cave.getState()'); return s.surface?.name === name && s; });
      const bounds = await waitFor(async () => { const b = await run('cave.testSuggestionBounds()'); return b.width > 100 && b; });
      const a = state.surface.anchor;
      assert.ok(bounds.x + bounds.width <= a.x || a.x + a.width <= bounds.x || bounds.y + bounds.height <= a.y || a.y + a.height <= bounds.y, `${layout}: ${name} view intersects its anchor`);
    }
  }
});

test('surfaces: a page press dismisses the card and reaches the page', async (t) => {
  const w = await startWorld({ blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log), shell = u => u.endsWith('/shell.html');
  const state = () => evaluate(port, shell, 'cave.getState()');
  await waitFor(async () => (await gateState(port)) === 'open', 60000);
  await evaluate(port, shell, "cave.navigate('http://find.cave.test/find.html')");
  const page = u => u === 'http://find.cave.test/find.html';
  await waitFor(() => evaluate(port, page, 'document.title'));
  await evaluate(port, page, "document.addEventListener('click', () => window.testPressed = true)");
  await click(port, shell, '#status');
  await waitFor(async () => (await state()).surface?.name === 'status');
  await withTarget(port, page, async send => {
    const event = { x: 50, y: 50, button: 'left', clickCount: 1 };
    await send('Input.dispatchMouseEvent', { ...event, type: 'mousePressed' });
    await send('Input.dispatchMouseEvent', { ...event, type: 'mouseReleased' });
  });
  await waitFor(async () => !(await state()).surface);
  assert.equal(await waitFor(() => evaluate(port, page, 'window.testPressed')), true);
});

test('chrome: the address bar gives the keyboard back to the page; a new window is its own', async (t) => {
  const w = await startWorld({ extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  await w.fixture.nextReport(45000);
  const port = await devtoolsPort(w.log);
  const isShell = (u) => u.endsWith('/shell.html');
  const shell = (expr) => evaluate(port, isShell, expr);
  const state = () => shell('cave.getState()');
  const typing = () => shell(`document.activeElement?.id === 'address'`);

  await shell(`cave.navigate('http://fp.cave.test/headers')`);
  await waitFor(async () => (await state()).tabs.some((tab) => tab.url === 'http://fp.cave.test/headers'));

  // Escape, like a press on the page, ends the edit and the page has the keyboard again.
  await shell(`cave.run('address.focus')`);
  await waitFor(async () => (await typing()) && (await state()).focus === 'chrome');
  await shell(`document.getElementById('address').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await waitFor(async () => !(await typing()) && (await state()).focus === 'page');

  // A second window has its own tabs; the first keeps its own.
  const pages = async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((p) => isShell(p.url)).length;
  const before = (await state()).tabs.length;
  assert.equal(await pages(), 1);
  await shell(`cave.run('window.new')`);
  await waitFor(async () => (await pages()) === 2);
  assert.equal((await state()).tabs.length, before);
});

test('i18n: a locale change reaches the settings page, the chrome and the status card, and is saved', async (t) => {
  const w = await startWorld({ extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  await w.fixture.nextReport(45000);
  const port = await devtoolsPort(w.log);
  const settings = (expr) => evaluate(port, (u) => u.endsWith('/settings.html'), expr);
  const labels = () => settings(`['[data-section="overview"] h2', '[data-section="nodes"] h2', '[data-section="privacy"] h2', '#reveal', '#pause', '#nav a[data-section="appearance"]'].map(s => (s === '#pause' ? document.querySelector(s).title : document.querySelector(s).textContent).trim())`);
  await settings(`cave.setLocale('en')`);
  await waitFor(async () => JSON.stringify(await labels()) === JSON.stringify(['Status and checks', 'Proxy', 'Privacy and site data', 'Open', 'Pause connection', 'Appearance']));
  await settings(`cave.setLocale('zh')`);
  await waitFor(async () => JSON.stringify(await labels()) === JSON.stringify(['状态与检查', '代理', '隐私与网站数据', '打开', '暂停外网', '外观']));

  const shell = (expr) => evaluate(port, (u) => u.endsWith('/shell.html'), expr);
  const overlay = (expr) => evaluate(port, (u) => u.endsWith('/overlay.html'), expr);
  await shell("cave.setLocale('en')");
  await waitFor(async () => (await shell('cave.getState()')).locale === 'en');
  assert.equal((await shell('cave.getState()')).localePreference, 'en');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(w.dir, 'cave.sqlite'), { readOnly: true });
  assert.equal(JSON.parse(db.prepare("SELECT value FROM prefs WHERE key='locale'").get().value), 'en');
  db.close();
  await waitFor(async () => (await shell("document.documentElement.lang")) === 'en');
  assert.equal(await shell("document.querySelector('#back').title"), 'Back');
  assert.equal(await shell("document.querySelector('#address').placeholder"), 'Search or enter address');
  await shell("cave.closeSurface()");
  await shell("cave.toggleSurface('status')");
  await waitFor(async () => (await overlay("document.querySelector('#title')?.textContent")) === 'Internet allowed · QM');
  assert.equal(await overlay("document.querySelector('#open-settings').textContent"), 'Open Settings');
  await shell("cave.setLocale('zh')");
  await waitFor(async () => (await shell('cave.getState()')).locale === 'zh');
  await waitFor(async () => (await shell("document.querySelector('#back').title")) === '后退');
});

test('search engine settings persist and synchronize', async (t) => {
  const w = await startWorld({ extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  await w.fixture.nextReport(45000);
  const port = await devtoolsPort(w.log);
  const shell = (expr) => evaluate(port, (u) => u.endsWith('/shell.html'), expr);
  const settings = (expr) => evaluate(port, (u) => u.endsWith('/settings.html'), expr);
  assert.deepEqual((await shell('cave.getState()')).searchEngine, { kind: 'default' });
  await shell("cave.openSettings('appearance')");
  await waitFor(() => settings('!!document.querySelector(\'[data-section="appearance"] select\')'));
  assert.equal(await settings("cave.setSearchEngine({kind:'custom',template:'https://example.net/search?q={query}'})"), true);
  assert.deepEqual((await shell('cave.getState()')).searchEngine, { kind: 'custom', template: 'https://example.net/search?q={query}' });
  assert.equal(await settings("cave.setSearchEngine({kind:'custom',template:'http://example.com/{query}'})"), false);
  assert.deepEqual((await shell('cave.getState()')).searchEngine, { kind: 'custom', template: 'https://example.net/search?q={query}' });
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(w.dir, 'cave.sqlite'), { readOnly: true });
  assert.deepEqual(JSON.parse(db.prepare("SELECT value FROM prefs WHERE key='searchEngine'").get().value), { kind: 'custom', template: 'https://example.net/search?q={query}' });
  db.close();
});

test('address empty and escape restore focus', async (t) => {
  const w = await startWorld({ extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  await w.fixture.nextReport(45000);
  const port = await devtoolsPort(w.log);
  const shell = (expr) => evaluate(port, (u) => u.endsWith('/shell.html'), expr);
  const before = await shell('cave.getState().then(s => s.tabs.find(t => t.id === s.active).url)');
  await shell("cave.run('address.focus')");
  await waitFor(() => shell("document.activeElement.id === 'address'"));
  await shell("document.querySelector('#address').value = 'unfinished'; document.querySelector('#address').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))");
  await waitFor(async () => (await shell('cave.getState()')).focus === 'page');
  assert.equal(await shell("document.querySelector('#address').value"), before);
  await shell("cave.run('address.focus')");
  await shell("document.querySelector('#address').value = '  '; document.querySelector('#address-form').requestSubmit()");
  await waitFor(async () => (await shell('cave.getState()')).focus === 'page');
  assert.equal(await shell('cave.getState().then(s => s.tabs.find(t => t.id === s.active).url)'), before);
});

test('new tab shortcuts persist and web content cannot open shell pages', async (t) => {
  const first = await startWorld({ blank: true, keepDir: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => first.stop());
  const port = await devtoolsPort(first.log);
  const home = (u) => u.endsWith('/home.html');
  await waitFor(() => evaluate(port, home, 'document.querySelector(".add") && true'));
  const initial = await evaluate(port, home, 'cave.getState()');
  assert.equal(initial.tabs[0].url, '');
  assert.equal(initial.tabs[0].title, '新标签页');
  await click(port, home, '.add');
  await evaluate(port, home, `(() => { const inputs = document.querySelectorAll('dialog input'); inputs[0].value = 'Fixture'; inputs[0].dispatchEvent(new Event('input', {bubbles:true})); inputs[1].value = 'http://fp.cave.test/fp.html'; inputs[1].dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await click(port, home, 'dialog button[type=submit]');
  await waitFor(() => evaluate(port, home, 'cave.shortcuts().then(s => s.length === 1)'));
  await first.stop();
  const second = await startWorld({ blank: true, dir: first.dir, extra: ['--remote-debugging-port=0'] });
  t.after(() => second.stop());
  const port2 = await devtoolsPort(second.log);
  await waitFor(() => evaluate(port2, home, 'document.querySelector(".tile-link .tile-name")?.textContent === "Fixture"'));
  await waitFor(async () => (await gateState(port2)) === 'open');
  await click(port2, home, '.tile .tile-link');
  await second.fixture.nextReport(45000);
  const shellUrl = await evaluate(port2, home, 'location.href');
  const attack = await evaluate(port2, isFixture, `(() => { const w = window.open(${JSON.stringify(shellUrl)}); location.href = ${JSON.stringify(shellUrl)}; return {bridge: typeof cave, opened: !!w}; })()`);
  assert.equal(attack.bridge, 'undefined');
  await new Promise(r => setTimeout(r, 500));
  assert.equal(await evaluate(port2, isFixture, 'location.href'), 'http://fp.cave.test/fp.html');
});

test('toolbar menu commands and single-use context tokens', async (t) => {
  const { port, shell, overlay } = await launch(t);
  await waitFor(() => shell('!!document.querySelector("#menu-button")'));
  await click(port, u => u.endsWith('/shell.html'), '#menu-button');
  const state = await waitFor(() => shell('cave.getState().then(s => s.contextMenu)'));
  assert.equal(state.items.find(i => i.id === 'history.open')?.enabled, true);
  await overlay(`cave.contextAction(${JSON.stringify(state.token)}, 'tab.new')`);
  await waitFor(() => shell('cave.getState().then(s => s.tabs.length >= 2 && !s.contextMenu)'));
  const before = await shell('cave.getState().then(s => s.tabs.length)');
  await overlay(`cave.contextAction(${JSON.stringify(state.token)}, 'tab.new')`);
  assert.equal(await shell('cave.getState().then(s => s.tabs.length)'), before);
});


test('menu keyboard navigation and Escape', async (t) => {
  const { port, shell, overlay } = await launch(t, { blank: true });
  await waitFor(() => shell('!!document.querySelector("#menu-button")'));
  await click(port, u => u.endsWith('/shell.html'), '#menu-button');
  await waitFor(() => overlay("document.activeElement?.getAttribute('role') === 'menu'"));
  await waitFor(() => overlay("document.querySelector('[data-surface=menu]')?.classList.contains('in')"));
  assert.ok((await shell('cave.testSuggestionBounds()')).width > 100);

  assert.equal(await overlay("!!document.querySelector('[role=menuitem]:focus')"), false);
  await overlay("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))");
  assert.ok((await shell('cave.getState()')).surface);
  await overlay("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp', bubbles: true}))");
  assert.equal(await overlay("document.activeElement === [...document.querySelectorAll('[role=menuitem]:not(:disabled)')].at(-1)"), true);
  await overlay("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}))");
  assert.equal(await overlay("document.activeElement === document.querySelector('[role=menuitem]:not(:disabled)')"), true);
  await overlay("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))");
  await waitFor(() => shell('cave.getState().then(s => !s.surface)'));
});

test('tab context targets inactive tab', async (t) => {
  const w = await startWorld({ extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = (u) => u.endsWith('/shell.html'), overlay = (u) => u.endsWith('/overlay.html');
  await waitFor(() => evaluate(port, shell, '!!document.querySelector("#new-tab")'));
  await evaluate(port, shell, 'cave.newTab()');
  const state = await waitFor(() => evaluate(port, shell, 'cave.getState().then(s => s.tabs.length >= 2 && s)'));
  const target = state.tabs.find(t => t.id !== state.active).id;
  const point = await evaluate(port, shell, `(() => { const r = document.querySelectorAll('[role=tab]')[0].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await rightClick(port, shell, point.x, point.y);
  const menu = await waitFor(() => evaluate(port, shell, 'cave.getState().then(s => s.contextMenu)'));
  await waitFor(() => evaluate(port, overlay, "document.activeElement?.getAttribute('role') === 'menu'"));
  assert.equal(await evaluate(port, overlay, "!!document.querySelector('[role=menuitem]:focus')"), false);
  assert.equal((await evaluate(port, shell, 'cave.getState()')).active, state.active);
  await evaluate(port, overlay, `cave.contextAction(${JSON.stringify(menu.token)}, 'tab.close')`);
  const after = await waitFor(() => evaluate(port, shell, `cave.getState().then(s => !s.tabs.some(t => t.id === ${target}) && s)`));
  assert.equal(after.active, state.active);
});

test('recovery: failed load retries through the proxy and internal page stays private', async (t) => {
  const w = await startWorld({ extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = (expr) => evaluate(port, (u) => u.endsWith('/shell.html'), expr);
  const recovery = (u) => u.endsWith('/internal-error.html');
  await waitFor(async () => (await gateState(port)) === 'open');
  w.blockedHosts.add('retry.cave.test');
  await shell("cave.navigate('http://retry.cave.test/headers?secret=1')");
  const state = await waitFor(async () => { const s = await shell('cave.getState()'); return s.recovery && s; });
  assert.equal(state.recovery.kind, 'network');
  await shell(`cave.retryTab(${state.recovery.tabId}, ${state.recovery.generation})`);
  assert.equal((await shell('cave.getState()')).recovery?.generation, state.recovery.generation);
  assert.equal(state.recovery.displayUrl, 'http://retry.cave.test/headers');
  assert.match(state.tabs.find((tab) => tab.id === state.active).url, /retry\.cave\.test/);
  assert.equal(await waitFor(() => evaluate(port, recovery, 'document.querySelector("h1")?.textContent')), '无法打开此页面');
  assert.equal(await evaluate(port, recovery, 'document.activeElement === document.querySelector(".primary")'), true);
  w.blockedHosts.delete('retry.cave.test');
  await withTarget(port, recovery, async (send) => {
    const event = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    await send('Input.dispatchKeyEvent', { ...event, type: 'rawKeyDown' });
    await send('Input.dispatchKeyEvent', { ...event, type: 'char', text: '\r' });
    await send('Input.dispatchKeyEvent', { ...event, type: 'keyUp' });
  });
  await waitFor(async () => !(await shell('cave.getState()')).recovery);
  await waitFor(() => evaluate(port, (u) => u.startsWith('http://retry.cave.test/'), 'document.body.textContent'));
  assert.ok(w.socks.targets.some((target) => target.host === 'retry.cave.test'));
  const result = await evaluate(port, (u) => u.startsWith('http://retry.cave.test/'), `(() => { const f = document.createElement('iframe'); f.src = ${JSON.stringify(new URL('../../dist/renderer/internal-error.html', import.meta.url).href)}; document.body.append(f); return typeof window.cave; })()`);
  assert.equal(result, 'undefined');
  const frames = await withTarget(port, (u) => u.startsWith('http://retry.cave.test/'), (send) => send('Page.getFrameTree'));
  assert.ok(!(frames.frameTree.childFrames ?? []).some((frame) => frame.frame.url.startsWith('file:')));
  await evaluate(port, (u) => u.startsWith('http://retry.cave.test/'), `location.href = ${JSON.stringify(new URL('../../dist/renderer/internal-error.html', import.meta.url).href)}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.match((await shell('cave.getState()')).tabs.find((tab) => tab.id === state.active).url, /^http:\/\/retry\.cave\.test\//);
  await shell(`cave.retryTab(${state.recovery.tabId}, ${state.recovery.generation})`);
  assert.equal((await shell('cave.getState()')).recovery, null);
});

test('recovery: crashed tab reloads', async (t) => {
  const w = await startWorld({ extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  await waitFor(async () => (await gateState(port)) === 'open');
  await waitFor(() => evaluate(port, isFixture, 'document.readyState === "complete"'));
  const shell = (expr) => evaluate(port, (u) => u.endsWith('/shell.html'), expr);
  const first = (await shell('cave.getState()')).active;
  await shell("cave.newTab('http://other.cave.test/headers')");
  await waitFor(() => evaluate(port, (u) => u.startsWith('http://other.cave.test/'), 'document.readyState === "complete"'));
  const other = (await shell('cave.getState()')).active;
  await shell(`cave.activate(${first})`);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((item) => isFixture(item.url));
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.send(JSON.stringify({ id: 1, method: 'Page.crash' }));
  await waitFor(async () => (await shell('cave.getState()')).recovery?.kind === 'crash');
  await shell(`cave.activate(${other})`);
  assert.equal((await shell('cave.getState()')).recovery, null);
  assert.equal(await evaluate(port, (u) => u.startsWith('http://other.cave.test/'), 'document.readyState'), 'complete');
  await shell(`cave.activate(${first})`);
  ws.close();
  const recovery = (u) => u.endsWith('/internal-error.html');
  assert.equal(await waitFor(() => evaluate(port, recovery, 'document.querySelector("h1")?.textContent')), '页面崩溃了');
  await click(port, recovery, '.primary');
  await waitFor(async () => !(await shell('cave.getState()')).recovery);
  await waitFor(() => evaluate(port, isFixture, 'document.readyState === "complete"'));
});


test('recovery: a failure while the gate is closed shows status', async (t) => {
  const w = await startWorld({ extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = (expr) => evaluate(port, (u) => u.endsWith('/shell.html'), expr);
  await waitFor(async () => (await gateState(port)) === 'open');
  await waitFor(() => evaluate(port, isFixture, 'document.readyState === "complete"'));
  await shell('cave.pause()');
  await evaluate(port, isFixture, "location.href = 'http://blocked.cave.test/'");
  const state = await waitFor(async () => { const s = await shell('cave.getState()'); return s.recovery && s; });
  assert.equal(state.recovery.kind, 'gate');
  const recovery = (u) => u.endsWith('/internal-error.html');
  assert.equal(await waitFor(() => evaluate(port, recovery, 'document.querySelector("h1")?.textContent')), '网络尚未放行');
  await click(port, recovery, '.actions button:last-child');
  await waitFor(async () => (await shell('cave.getState()')).surface?.name === 'status');
  await shell('cave.closeSurface()');
  await click(port, recovery, '.primary');
  assert.equal((await shell('cave.getState()')).recovery.kind, 'gate');
  await shell('cave.resume()');
  await waitFor(async () => !(await shell('cave.getState()')).recovery);
  await waitFor(() => evaluate(port, (u) => u.startsWith('http://blocked.cave.test/'), 'document.readyState === "complete"'));
});

test('address local suggestions keep input focus and reject stale choices', async (t) => {
  const w = await startWorld({ extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = (expr) => evaluate(port, u => u.endsWith('/shell.html'), expr);
  const overlay = (expr) => evaluate(port, u => u.endsWith('/overlay.html'), expr);
  await waitFor(() => shell("cave.getState().then(s => s.tabs.some(t => t.url.includes('fp.cave.test')))"), 45000);
  await shell("cave.newTab()");
  await waitFor(() => shell("cave.getState().then(s => s.tabs.length === 2 && s.focus === 'page')"));
  await shell("cave.run('address.focus')");
  await waitFor(() => shell('cave.getState().then(s => !!s.address)'));
  const before = w.socks.targets.length;
  await shell("(() => { const el = document.querySelector('#address'); el.value = 'fp.cave.test'; el.dispatchEvent(new Event('input', {bubbles:true})); })()");
  await waitFor(() => overlay("document.querySelectorAll('#suggestions [role=option]').length > 0"));
  assert.match(await overlay("document.querySelector('#suggestions [role=option]').textContent"), /fp\.cave\.test/);
  assert.equal(await shell("cave.getState().then(s => s.focus)"), 'chrome');
  assert.equal(await shell("document.querySelector('#address').getAttribute('aria-expanded')"), 'true');
  const at = await shell("(() => { const r = document.querySelector('#address').getBoundingClientRect(); return {x:r.x+100,y:r.y+r.height/2}; })()");
  await shell("document.querySelector('#address').setSelectionRange(0, 0)");
  await withTarget(port, u => u.endsWith('/shell.html'), async send => {
    await send('Input.dispatchMouseEvent', {type:'mousePressed', ...at, button:'left', clickCount:1});
    await send('Input.dispatchMouseEvent', {type:'mouseReleased', ...at, button:'left', clickCount:1});
  });
  assert.notEqual(await shell("document.querySelector('#address').selectionStart"), 0);
  assert.equal(await shell("cave.getState().then(s => s.focus)"), 'chrome');

  await shell("document.querySelector('#address').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown', bubbles:true}))");
  assert.match(await shell("document.querySelector('#address').value"), /fp\.cave\.test/);
  assert.match(await shell("document.querySelector('#address-form [aria-live]').textContent"), /fixture/i);
  await shell("document.querySelector('#address').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowUp', bubbles:true}))");
  assert.equal(await shell("document.querySelector('#address-form [aria-live]').textContent"), '');
  await shell("document.querySelector('#address').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown', bubbles:true}))");
  await waitFor(() => overlay("document.querySelector('#suggestions [role=option][aria-selected=true]')?.textContent.includes('fp.cave.test')"));
  await shell("document.querySelector('#address-form').requestSubmit()");
  await waitFor(() => shell('cave.getState().then(s => !s.address && s.tabs.find(t => t.id === s.active)?.url.includes("fp.cave.test"))'));
  assert.equal(w.socks.targets.length, before);
  await shell("cave.getState().then(s => cave.pinTab(s.active, true))");
  await waitFor(() => shell("!!document.querySelector('.tab.pinned')"));
  await shell("cave.setTabLayout('side')");
  await shell("cave.newTab()");
  await shell("cave.run('address.focus')");
  await waitFor(() => shell('cave.getState().then(s => !!s.address)'));
  await shell("(() => { const el = document.querySelector('#address'); el.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true})); el.value = 'fp.cave.test'; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown', bubbles:true, isComposing:true})); el.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, isComposing:true})); })()");
  assert.equal(await shell("cave.getState().then(s => !s.surface)"), true);
  await shell("document.querySelector('#address').dispatchEvent(new CompositionEvent('compositionend', {bubbles:true}))");
  await waitFor(() => overlay("document.querySelectorAll('#suggestions [role=option]').length > 0"));
  const sideAt = await shell("(() => { const r = document.querySelector('#address').getBoundingClientRect(); return {x:r.x+100,y:r.y+r.height/2}; })()");
  await shell("document.querySelector('#address').setSelectionRange(0, 0)");
  await withTarget(port, u => u.endsWith('/shell.html'), async send => {
    await send('Input.dispatchMouseEvent', {type:'mousePressed', ...sideAt, button:'left', clickCount:1});
    await send('Input.dispatchMouseEvent', {type:'mouseReleased', ...sideAt, button:'left', clickCount:1});
  });
  assert.notEqual(await shell("document.querySelector('#address').selectionStart"), 0);
  assert.equal(await shell("cave.getState().then(s => s.focus)"), 'chrome');
  await shell("document.querySelector('#address').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))");
  await waitFor(() => shell("cave.getState().then(s => !s.surface && !s.address)"));
  await shell("cave.run('address.focus')");
  await waitFor(() => shell('cave.getState().then(s => !!s.address)'));
  await shell("(() => { const el = document.querySelector('#address'); el.value = 'fp.cave.test'; el.dispatchEvent(new Event('input', {bubbles:true})); })()");
  await waitFor(() => overlay("(() => { const el = document.querySelector('#suggestions [role=option]'); if (!el) return false; const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x+r.width/2, r.y+r.height/2)); })()"));
  const rowAt = await overlay("(() => { const r = document.querySelector('#suggestions [role=option]').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()");
  await withTarget(port, u => u.endsWith('/overlay.html'), async send => {
    await send('Input.dispatchMouseEvent', {type:'mousePressed', ...rowAt, button:'left', clickCount:1});
    assert.equal(await shell("cave.getState().then(s => s.focus)"), 'chrome');
    await send('Input.dispatchMouseEvent', {type:'mouseReleased', ...rowAt, button:'left', clickCount:1});
  });
  await waitFor(() => shell('cave.getState().then(s => !s.address && s.tabs.find(t => t.id === s.active)?.url.includes("fp.cave.test"))'));
});

test('address suggestion receives a native-view mouse press after focus moves', async (t) => {
  const w = await startWorld({ extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = expr => evaluate(port, u => u.endsWith('/shell.html'), expr);
  const overlay = expr => evaluate(port, u => u.endsWith('/overlay.html'), expr);
  await waitFor(() => shell("cave.getState().then(s => s.tabs.some(t => t.url.includes('fp.cave.test')))"), 45000);
  await shell('cave.newTab()');
  await shell("cave.run('address.focus')");
  await waitFor(() => shell("document.activeElement?.id === 'address' && cave.getState().then(s => !!s.address)"));
  await shell("(() => { const el = document.querySelector('#address'); el.value = 'fp.cave.test'; el.dispatchEvent(new Event('input', {bubbles:true})); })()");
  const at = await waitFor(() => overlay("(() => { const el = document.querySelector('#suggestions [role=option]'); if (!el) return null; const r = el.getBoundingClientRect(); return {x:Math.floor(r.x+r.width/2),y:Math.floor(r.y+r.height/2)}; })()"));
  await shell(`cave.testSuggestionMouse(${at.x}, ${at.y})`);
  await waitFor(() => shell('cave.getState().then(s => !s.address && s.tabs.find(t => t.id === s.active)?.url.includes("fp.cave.test"))'), 5000);
});

test('suggestions align with the address field in both tab layouts', async (t) => {
  const w = await startWorld({ extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = expr => evaluate(port, u => u.endsWith('/shell.html'), expr);
  await waitFor(() => shell("cave.getState().then(s => s.tabs.some(t => t.url.includes('fp.cave.test')))"), 45000);
  for (const layout of ['top', 'side']) {
    await shell(`cave.setTabLayout('${layout}')`);
    await shell("cave.run('address.focus')");
    await waitFor(() => shell('cave.getState().then(s => !!s.address)'));
    await shell("(() => { const el = document.querySelector('#address'); el.value = 'fp.cave.test'; el.dispatchEvent(new Event('input', {bubbles:true})); })()");
    const field = await shell(`(() => { const r = document.querySelector('#address-form').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
    await waitFor(async () => { const b = await shell('cave.testSuggestionBounds()'); return b.x === field.x && b.y === field.y + field.height + 4 && b.width === field.width; });
    await shell("document.querySelector('#address').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))");
    await waitFor(() => shell('cave.getState().then(s => !s.address)'));
  }
});

test('address history row navigates and stale results cannot execute', async (t) => {
  const w = await startWorld({ extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = expr => evaluate(port, u => u.endsWith('/shell.html'), expr);
  const overlay = expr => evaluate(port, u => u.endsWith('/overlay.html'), expr);
  const old = await waitFor(() => shell("cave.getState().then(s => s.tabs.find(t => t.url.includes('fp.cave.test'))?.id)"), 45000);
  await shell('cave.newTab()');
  await waitFor(() => shell('cave.getState().then(s => s.tabs.length === 2 && s.active !== ' + old + ')'));
  await shell(`cave.closeTab(${old})`);
  await waitFor(() => shell('cave.getState().then(s => s.tabs.length === 1)'));
  await shell("cave.run('address.focus')");
  const session = await waitFor(() => shell('cave.getState().then(s => s.address?.session)'));
  const first = await shell(`cave.suggestAddress(${JSON.stringify(session)}, 1, 'fp.cave.test')`);
  assert.equal(first.items[0].kind, 'history');
  const second = await shell(`cave.suggestAddress(${JSON.stringify(session)}, 2, 'fp.cave.test')`);
  assert.equal(await shell(`cave.chooseAddress(${JSON.stringify(session)}, 1, ${JSON.stringify(first.items[0].id)})`), false);
  assert.equal(second.items[0].kind, 'history');
  await waitFor(() => overlay("(() => { const el = document.querySelector('#suggestions [role=option]'); if (!el) return false; const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x+r.width/2, r.y+r.height/2)); })()"));
  await click(port, u => u.endsWith('/overlay.html'), '#suggestions [role=option]');
  await waitFor(() => shell("cave.getState().then(s => !s.address && s.tabs.find(t => t.id === s.active)?.url.includes('fp.cave.test'))"));
});

test('site zoom persists, synchronizes and clears', async (t) => {
  const first = await startWorld({ blank: true, keepDir: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => first.stop());
  const port = await devtoolsPort(first.log);
  const shellMatch = u => u.endsWith('/shell.html');
  const firstShell = await waitFor(async () => (await listTargets(port)).find(target => shellMatch(target.url)));
  const shell = expr => evaluate(port, { targetId: firstShell.id }, expr);
  await waitFor(async () => (await gateState(port)) === 'open');
  await shell("cave.navigate('http://one.test/headers?zoom=1')");
  const one = u => u.includes('one.test/headers?zoom=1');
  const dpr = await waitFor(() => evaluate(port, one, 'window.devicePixelRatio'));
  await shell("cave.run('zoom.in')");
  await waitFor(async () => (await shell('cave.getState()')).zoom === 110);
  await waitFor(async () => Math.abs((await evaluate(port, one, 'window.devicePixelRatio')) / dpr - 1.1) < 0.01);
  assert.equal(await waitFor(() => shell("document.querySelector('#zoom-reset')?.textContent")), '110%');
  await shell("cave.newTab('http://one.test/headers?zoom=2')");
  const two = u => u.includes('one.test/headers?zoom=2');
  await waitFor(async () => Math.abs((await evaluate(port, two, 'window.devicePixelRatio')) / dpr - 1.1) < 0.01);
  await shell("cave.run('zoom.in')");
  await waitFor(async () => Math.abs((await evaluate(port, one, 'window.devicePixelRatio')) / dpr - 1.25) < 0.01);
  await shell("cave.run('zoom.out')");
  const before = new Set((await listTargets(port)).map(target => target.id));
  await shell("cave.run('window.new')");
  const newShell = await waitFor(async () => (await listTargets(port)).find(target => !before.has(target.id) && target.url.endsWith('/shell.html')));
  const shellWindow = expr => evaluate(port, { targetId: newShell.id }, expr);
  await shellWindow("cave.navigate('http://one.test/headers?zoom=window')");
  const windowPage = u => u.includes('one.test/headers?zoom=window');
  await waitFor(async () => Math.abs((await evaluate(port, windowPage, 'window.devicePixelRatio')) / dpr - 1.1) < 0.01);
  await shellWindow("cave.run('zoom.in')");
  await waitFor(async () => Math.abs((await evaluate(port, one, 'window.devicePixelRatio')) / dpr - 1.25) < 0.01);
  await shellWindow("cave.run('zoom.out')");
  await shell("cave.newTab('http://two.test/headers?zoom=3')");
  const other = u => u.includes('two.test/headers?zoom=3');
  await waitFor(() => evaluate(port, other, 'window.devicePixelRatio'));
  assert.equal((await shell('cave.getState()')).zoom, 100);
  assert.ok(Math.abs((await evaluate(port, other, 'window.devicePixelRatio')) / dpr - 1) < 0.01);
  await first.stop();
  const second = await startWorld({ blank: true, dir: first.dir, extra: ['--remote-debugging-port=0'] });
  t.after(() => second.stop());
  const port2 = await devtoolsPort(second.log);
  const shell2 = expr => evaluate(port2, shellMatch, expr);
  await waitFor(async () => (await gateState(port2)) === 'open');
  await shell2("cave.navigate('http://one.test/headers?zoom=4')");
  const restored = u => u.includes('one.test/headers?zoom=4');
  await waitFor(async () => (await shell2('cave.getState()')).zoom === 110);
  await waitFor(async () => Math.abs((await evaluate(port2, restored, 'window.devicePixelRatio')) / dpr - 1.1) < 0.01);
  await shell2("cave.setTabLayout('side')");
  await waitFor(() => shell2("document.body.classList.contains('side') && document.querySelector('#zoom-reset')?.textContent"));
  await click(port2, shellMatch, '#zoom-reset');
  await waitFor(async () => (await shell2('cave.getState()')).zoom === 100);
  await shell2("cave.run('zoom.in')");
  await shell2("cave.clearSite('http://one.test')");
  await waitFor(async () => (await shell2('cave.getState()')).zoom === 100);
  await waitFor(async () => Math.abs((await evaluate(port2, restored, 'window.devicePixelRatio')) / dpr - 1) < 0.01);
  assert.ok(second.socks.targets.every(target => target.host.endsWith('.test')));
});

test('certificate exceptions do not cross hosts, certificates, site clearing, reset or restart', async (t) => {
  const { w, port, shell } = await launch(t, { tls: true, blank: true, keepDir: true, open: true });
  let restarted;
  t.after(async () => { if (restarted) await restarted.stop(); else await rm(w.dir, { recursive: true, force: true }); });
  const recovery = u => u.endsWith('/internal-error.html');
  const warning = async () => waitFor(async () => (await shell('cave.getState()')).recovery?.kind === 'certificate');
  const accept = async () => { await waitFor(async () => (await shell('cave.getState()')).recovery?.canContinue); await click(port, recovery, '[aria-expanded]'); await click(port, recovery, '.advanced button'); await waitFor(() => evaluate(port, u => u === 'https://bad.cave.test/', 'document.title')); };
  await shell("cave.navigate('https://bad.cave.test/')"); await warning(); await accept();
  const cert = new X509Certificate(await readFile(join(w.dir, 'untrusted-cert.pem')));
  const digest = createHash('sha256').update(cert.raw).digest();
  async function checkFiles(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await checkFiles(path);
      else if (entry.isFile()) {
        const data = await readFile(path).catch(() => Buffer.alloc(0));
        assert.equal(data.includes(digest), false, `fingerprint bytes in ${path}`);
        assert.equal(data.includes(digest.toString('hex')), false, `fingerprint text in ${path}`);
      }
    }
  }
  await checkFiles(w.dir);
  assert.equal(await evaluate(port, u => u === 'https://bad.cave.test/', 'typeof window.cave'), 'undefined');
  await shell("cave.navigate('https://other.cave.test/')"); await warning();
  await shell("cave.navigate('https://bad.cave.test/')"); await waitFor(() => evaluate(port, u => u === 'https://bad.cave.test/', 'document.title'));
  await shell("cave.clearSite('https://bad.cave.test/')"); await warning();
  await accept();
  await shell('cave.resetEnvironment()');
  await shell("cave.navigate('https://bad.cave.test/')"); await warning();
  await accept();
  await w.rotateUntrusted();
  await shell("cave.navigate('http://fp.cave.test/')"); await waitFor(() => evaluate(port, u => u === 'http://fp.cave.test/', 'document.title'));
  await shell("cave.navigate('https://bad.cave.test/')"); await warning();
  await w.stop();
  restarted = await startWorld({ tls: true, blank: true, dir: w.dir, extra: ['--remote-debugging-port=0'] });
  const port2 = await devtoolsPort(restarted.log);
  const shell2 = expr => evaluate(port2, u => u.endsWith('/shell.html'), expr);
  await waitFor(async () => (await gateState(port2)) === 'open');
  await shell2("cave.navigate('https://bad.cave.test/')");
  assert.equal((await waitFor(async () => (await shell2('cave.getState()')).recovery)).kind, 'certificate');
});

test('permission decisions survive restart and both clear paths', async t => {
  const profile = { ...PROFILE, notifications: true };
  const { w: first, port, shell } = await launch(t, { tls: true, blank: true, keepDir: true, profile, open: true });
  let second;
  t.after(async () => { if (second) await second.stop(); else await rm(first.dir, { recursive: true, force: true }); });
  const overlay = u => u.endsWith('/overlay.html');
  const page = expr => evaluate(port, u => u.startsWith(first.httpsUrl), expr);
  await shell(`cave.navigate(${JSON.stringify(first.httpsUrl)})`);
  await waitFor(() => page('document.title'));
  await page("window.result = 'pending'; Notification.requestPermission().then(v => window.result = v); 'started'");
  const prompt = await waitFor(async () => (await shell('cave.getState()')).permissionPrompt);
  assert.equal(await page('typeof window.cave'), 'undefined');
  await shell(`cave.respondPermission(${JSON.stringify(prompt.id)}, 'once')`);
  assert.equal((await shell('cave.getState()')).permissionPrompt.id, prompt.id);
  await click(port, overlay, '#permission button:first-child');
  await waitFor(async () => (await page('window.result')) === 'denied');
  await first.stop();
  second = await startWorld({ tls: true, blank: true, dir: first.dir, profile, extra: ['--remote-debugging-port=0'] });
  const port2 = await devtoolsPort(second.log);
  const shell2 = expr => evaluate(port2, u => u.endsWith('/shell.html'), expr);
  const page2 = expr => evaluate(port2, u => u.startsWith(second.httpsUrl), expr);
  await waitFor(async () => (await gateState(port2)) === 'open');
  await shell2(`cave.navigate(${JSON.stringify(second.httpsUrl)})`);
  await waitFor(() => page2('document.title'));
  await page2("window.result = 'pending'; Notification.requestPermission().then(v => window.result = v); 'started'");
  await waitFor(async () => (await page2('window.result')) === 'denied');
  assert.equal((await shell2('cave.getState()')).permissionPrompt, null);
  await shell2(`cave.clearSite(${JSON.stringify(second.httpsUrl)})`);
  await waitFor(() => page2('document.title'));
  await page2("window.result = 'pending'; Notification.requestPermission().then(v => window.result = v); 'started'");
  await waitFor(async () => (await shell2('cave.getState()')).permissionPrompt);
  await click(port2, overlay, '#permission button:last-child');
  await waitFor(async () => (await page2('window.result')) === 'granted');
  await shell2('cave.resetEnvironment()');
  await shell2(`cave.navigate(${JSON.stringify(second.httpsUrl)})`);
  await waitFor(() => page2('document.title'));
  await page2("window.result = 'pending'; Notification.requestPermission().then(v => window.result = v); 'started'");
  await waitFor(async () => (await shell2('cave.getState()')).permissionPrompt);
});

test('settings lists and removes saved permissions', async t => {
  const w = await startWorld({ tls: true, blank: true, profile: { ...PROFILE, notifications: true }, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = expr => evaluate(port, u => u.endsWith('/shell.html'), expr);
  const page = expr => evaluate(port, u => u === w.httpsUrl, expr);
  const settings = u => u.endsWith('/settings.html');
  await waitFor(async () => (await gateState(port)) === 'open');
  await shell(`cave.navigate(${JSON.stringify(w.httpsUrl)})`);
  await waitFor(() => page('document.title'));
  await page("Notification.requestPermission(); 'started'");
  await waitFor(async () => (await shell('cave.getState()')).permissionPrompt);
  await click(port, u => u.endsWith('/overlay.html'), '#permission button:first-child');
  await shell("cave.openSettings('privacy')");
  assert.match(await waitFor(() => evaluate(port, settings, "document.querySelector('#site-permissions')?.textContent.includes('secure.cave.test') && document.querySelector('#site-permissions').textContent")), /通知.*拒绝/);
  await click(port, settings, '#site-permissions button');
  await waitFor(() => evaluate(port, settings, "!document.querySelector('#site-permissions button')"));
  assert.equal((await evaluate(port, settings, 'cave.panelData()')).permissions.length, 0);
});

test('dismissing a permission suppresses it until navigation', async t => {
  const w = await startWorld({ tls: true, blank: true, profile: { ...PROFILE, notifications: true }, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = expr => evaluate(port, u => u.endsWith('/shell.html'), expr);
  const page = expr => evaluate(port, u => u.startsWith(w.httpsUrl), expr);
  const overlay = expr => evaluate(port, u => u.endsWith('/overlay.html'), expr);
  await waitFor(async () => (await gateState(port)) === 'open');
  await shell(`cave.navigate(${JSON.stringify(w.httpsUrl)})`);
  await waitFor(() => page('document.title'));
  await page("window.result = 'pending'; Notification.requestPermission().then(v => window.result = v); 'started'");
  await waitFor(async () => (await shell('cave.getState()')).permissionPrompt);
  await overlay("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); 'dismissed'");
  await waitFor(async () => (await page('window.result')) === 'denied');
  await page("window.result = 'pending'; Notification.requestPermission().then(v => window.result = v); 'started'");
  await waitFor(async () => (await page('window.result')) === 'denied');
  assert.equal((await shell('cave.getState()')).permissionPrompt, null);
  await shell(`cave.navigate(${JSON.stringify(w.httpsUrl + '?new')})`);
  await waitFor(() => evaluate(port, u => u === w.httpsUrl + '?new', 'document.title'));
  await page("Notification.requestPermission(); 'started'");
  await waitFor(async () => (await shell('cave.getState()')).permissionPrompt);
});

test('HTTP basic authentication prompts, retries, and cancels', async t => {
  const w = await startWorld({ tls: true, blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = expr => evaluate(port, u => u.endsWith('/shell.html'), expr);
  const overlay = u => u.endsWith('/overlay.html');
  await waitFor(async () => (await gateState(port)) === 'open', 60000);
  await shell("cave.navigate('https://secure.cave.test/basic')");
  const prompt = await waitFor(async () => (await shell('cave.getState()')).httpAuthPrompt);
  assert.equal(prompt.origin, 'https://secure.cave.test');
  assert.equal(prompt.realm, 'Cave test');
  const submit = async (user, pass) => evaluate(port, overlay, `(() => { const fields = document.querySelectorAll('#httpAuth input'); fields[0].value = ${JSON.stringify(user)}; fields[1].value = ${JSON.stringify(pass)}; document.querySelector('#httpAuth form').requestSubmit(); })()`);
  await submit('bad', 'bad');
  await waitFor(async () => { const p = (await shell('cave.getState()')).httpAuthPrompt; return p && p.id !== prompt.id; });
  await submit('cave-user', 'cave-secret');
  await waitFor(() => evaluate(port, u => u === 'https://secure.cave.test/basic', "document.title === 'Authenticated'"));
  await shell("cave.navigate('http://auth.cave.test/basic')");
  await waitFor(async () => (await shell('cave.getState()')).httpAuthPrompt);
  assert.match(await evaluate(port, overlay, "document.querySelector('#httpAuth').textContent"), /密码将以明文发送/);
  await click(port, overlay, '#httpAuth button[type=button]');
  await waitFor(() => evaluate(port, u => u === 'http://auth.cave.test/basic', "document.body.textContent.includes('Authentication required')"));
  assert.ok(!w.log().includes('cave-secret'));
  async function scan(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (entry.isFile()) assert.equal((await readFile(path)).includes(Buffer.from('cave-secret')), false, path);
    }
  }
  await scan(w.dir);
});

test('HTTP auth rejects non-main and background requests and cancels on navigation and close', async t => {
  const w = await startWorld({ blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = expr => evaluate(port, u => u.endsWith('/shell.html'), expr);
  const overlay = u => u.endsWith('/overlay.html');
  await waitFor(async () => (await gateState(port)) === 'open', 60000);
  await shell("cave.navigate('http://auth.cave.test/auth-subresources')");
  await waitFor(() => evaluate(port, u => u.endsWith('/auth-subresources'), "document.readyState === 'complete'"));
  assert.equal((await shell('cave.getState()')).httpAuthPrompt, null);
  assert.equal(await evaluate(port, u => u.endsWith('/auth-subresources'), 'typeof window.cave'), 'undefined');
  const first = (await shell('cave.getState()')).active;
  await shell("cave.newTab('http://other.cave.test/')");
  await waitFor(async () => (await shell('cave.getState()')).active !== first);
  await evaluate(port, u => u.endsWith('/auth-subresources'), "location.href = '/basic'");
  await waitFor(() => evaluate(port, u => u.endsWith('/basic'), "document.body.textContent.includes('Authentication required')"));
  assert.equal((await shell('cave.getState()')).httpAuthPrompt, null);
  await shell(`cave.activate(${first})`);
  await shell("cave.navigate('http://another.cave.test/basic')");
  const prompt = await waitFor(async () => (await shell('cave.getState()')).httpAuthPrompt);
  await shell(`cave.respondHttpAuth(${JSON.stringify(prompt.id)}, {username:'cave-user',password:'cave-secret'})`);
  assert.equal((await shell('cave.getState()')).httpAuthPrompt.id, prompt.id);
  await shell("cave.navigate('http://other.cave.test/')");
  await waitFor(async () => !(await shell('cave.getState()')).httpAuthPrompt);
  await shell("cave.navigate('http://another.cave.test/basic')");
  await waitFor(async () => (await shell('cave.getState()')).httpAuthPrompt);
  await shell(`cave.closeTab(${first})`);
  await waitFor(async () => !(await shell('cave.getState()')).httpAuthPrompt);
  assert.equal(await evaluate(port, overlay, "!!document.querySelector('#httpAuth[open]')"), false);
});


test('HTTP auth cache is cleared on restart and environment reset', async t => {
  const w = await startWorld({ blank: true, keepDir: true, extra: ['--remote-debugging-port=0'] });
  t.after(async () => { await w.stop(); await rm(w.dir, { recursive: true, force: true }); });
  const port = await devtoolsPort(w.log);
  const shell = expr => evaluate(port, u => u.endsWith('/shell.html'), expr);
  const url = 'http://lifetime.cave.test/basic';
  await waitFor(async () => (await gateState(port)) === 'open', 60000);
  async function authenticate(p, call) {
    await call(`cave.navigate(${JSON.stringify(url)})`);
    await waitFor(async () => (await call('cave.getState()')).httpAuthPrompt);
    await evaluate(p, u => u.endsWith('/overlay.html'), `(() => { const inputs = document.querySelectorAll('#httpAuth input'); inputs[0].value = 'cave-user'; inputs[1].value = 'cave-secret'; document.querySelector('#httpAuth form').requestSubmit(); })()`);
    await waitFor(() => evaluate(p, u => u === url, "document.title === 'Authenticated'"));
  }
  await authenticate(port, shell);
  await w.stop();
  const restarted = await startWorld({ dir: w.dir, blank: true, keepDir: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => restarted.stop());
  const port2 = await devtoolsPort(restarted.log);
  const shell2 = expr => evaluate(port2, u => u.endsWith('/shell.html'), expr);
  await waitFor(async () => (await gateState(port2)) === 'open', 60000);
  await authenticate(port2, shell2);
  await shell2('cave.resetEnvironment()');
  await shell2(`cave.navigate(${JSON.stringify(url)})`);
  await waitFor(async () => (await shell2('cave.getState()')).httpAuthPrompt);
});

test('address inline completion follows typed input', async t => {
  const w = await startWorld({ blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const target = u => u.endsWith('/shell.html');
  const shell = expr => evaluate(port, target, expr);
  await waitFor(async () => (await gateState(port)) === 'open');
  const url = 'http://completion.cave.test/find.html';
  await shell(`cave.navigate(${JSON.stringify(url)})`);
  await waitFor(() => evaluate(port, u => u === url, 'document.title'));
  await click(port, target, '#address');
  await waitFor(() => shell("document.activeElement?.id === 'address' && cave.getState().then(s => !!s.address)"));
  const type = async text => withTarget(port, target, async send => {
    for (const char of text) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: char, text: char });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: char });
    }
  });
  const press = async key => withTarget(port, target, async send => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: key === 'Backspace' ? 8 : 13, ...(key === 'Enter' ? { text: '\r' } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key });
  });
  const state = () => shell("(() => { const e = document.querySelector('#address'); return [e.value, e.selectionStart, e.selectionEnd]; })()");
  await type('ht');
  const prefix = 'ht';
  await new Promise(r => setTimeout(r, 1000));
  assert.deepEqual(await state(), [url, prefix.length, url.length]);
  await press('Backspace');
  await waitFor(async () => (await state())[0] === prefix);
  await new Promise(r => setTimeout(r, 500));
  assert.deepEqual(await state(), [prefix, prefix.length, prefix.length]);
  await type('t');
  await waitFor(async () => (await state())[0] === url);
  assert.deepEqual(await state(), [url, prefix.length + 1, url.length]);
  await press('Enter');
  await waitFor(async () => !(await shell('cave.getState()')).address);
  await waitFor(async () => { const s = await shell('cave.getState()'); return s.tabs.find(t => t.id === s.active)?.url === url; });
  await click(port, target, '#address');
  await waitFor(() => shell('cave.getState().then(s => !!s.address)'));
  await type('completion words');
  await new Promise(r => setTimeout(r, 500));
  assert.deepEqual(await state(), ['completion words', 16, 16]);
});

test('address display and focus work in both tab layouts', async t => {
  const w = await startWorld({ blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const target = u => u.endsWith('/shell.html');
  const shell = expr => evaluate(port, target, expr);
  await waitFor(async () => (await gateState(port)) === 'open');
  const url = 'http://display.cave.test/find.html?x=1#part';
  await shell(`cave.navigate(${JSON.stringify(url)})`);
  await waitFor(() => evaluate(port, u => u === url, 'document.title'));
  for (const layout of ['top', 'side']) {
    await shell(`cave.setTabLayout(${JSON.stringify(layout)})`);
    await waitFor(() => shell(`document.body.classList.contains(${JSON.stringify(layout)})`));
    assert.equal(await shell("document.querySelector('#address-view').textContent"), 'display.cave.test/find.html?x=1#part');
    await click(port, target, '#address');
    await waitFor(() => shell("cave.getState().then(s => !!s.address)"));
    assert.deepEqual(await shell("(() => { const e = document.querySelector('#address'); return [e.value, e.selectionStart, e.selectionEnd]; })()"), [url, 0, url.length]);
    const geometry = await shell(`(() => { const e = document.querySelector('#address'), icon = document.querySelector('#site-icon'); const r = e.getBoundingClientRect(), i = icon.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, iconWidth: i.width, padding: parseFloat(getComputedStyle(e).paddingLeft), align: getComputedStyle(e).textAlign }; })()`);
    assert.ok(geometry.iconWidth > 0);
    assert.equal(geometry.align, 'left');
    assert.ok(geometry.padding < geometry.width / 2);
    await withTarget(port, target, async send => {
      const event = { x: geometry.x + geometry.padding + 1, y: geometry.y + geometry.height / 2, button: 'left', clickCount: 1 };
      await send('Input.dispatchMouseEvent', { ...event, type: 'mousePressed' });
      await send('Input.dispatchMouseEvent', { ...event, type: 'mouseReleased' });
    });
    assert.equal(await shell("document.querySelector('#address').selectionStart"), 0);
    await withTarget(port, target, async send => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', text: 'z', windowsVirtualKeyCode: 90 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ' });
    });
    assert.notEqual(await shell("document.querySelector('#address').value"), url);
    await withTarget(port, target, async send => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    });
    await waitFor(() => shell('cave.getState().then(s => !s.address)'));
    assert.equal(await shell("document.querySelector('#address-view').textContent"), 'display.cave.test/find.html?x=1#part');
  }
});

test('address security indicator reflects the active page', async t => {
  const w = await startWorld({ tls: true, blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const target = u => u.endsWith('/shell.html');
  const shell = expr => evaluate(port, target, expr);
  const label = () => shell("document.querySelector('#site-icon').title");
  await waitFor(async () => (await gateState(port)) === 'open');
  assert.equal(await label(), '连接状态未知');
  for (const [url, expected] of [[w.httpsUrl, 'HTTPS 连接'], ['http://fp.cave.test/', '不安全的 HTTP 连接']]) {
    await shell(`cave.navigate(${JSON.stringify(url)})`);
    await waitFor(() => evaluate(port, u => u === url, 'document.title'));
    await waitFor(async () => (await label()) === expected);
  }
  await shell("cave.navigate('https://bad.cave.test/')");
  await waitFor(async () => (await shell('cave.getState()')).recovery?.canContinue);
  const recovery = u => u.endsWith('/internal-error.html');
  await click(port, recovery, '[aria-expanded]');
  await click(port, recovery, '.advanced button');
  await waitFor(() => evaluate(port, u => u === 'https://bad.cave.test/', 'document.title'));
  await waitFor(async () => (await label()) === '证书例外');
  const s = await shell('cave.getState()');
  assert.equal(s.tabs.find(tab => tab.id === s.active).insecure, true);
});

test('prompts stay in their window and render auth realms as text', async t => {
  const w = await startWorld({ tls: true, blank: true, profile: { ...PROFILE, notifications: true }, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const targets = await waitFor(async () => { const all = await listTargets(port); return all.some(t => t.url.endsWith('/shell.html')) && all.some(t => t.url.endsWith('/overlay.html')) && all; });
  const a = { targetId: targets.find(t => t.url.endsWith('/shell.html')).id };
  const overlayA = { targetId: targets.find(t => t.url.endsWith('/overlay.html')).id };
  const shellA = expr => evaluate(port, a, expr);
  await waitFor(async () => (await gateState(port)) === 'open');
  const before = new Set(targets.map(t => t.id));
  await shellA("cave.run('window.new')");
  const b = await waitFor(async () => (await listTargets(port)).find(t => !before.has(t.id) && t.url.endsWith('/shell.html')));
  const shellB = expr => evaluate(port, { targetId: b.id }, expr);
  await shellA(`cave.navigate(${JSON.stringify(w.httpsUrl)})`);
  const page = u => u === w.httpsUrl;
  await waitFor(() => evaluate(port, page, 'document.title'));
  await evaluate(port, page, "window.permissionResult = 'pending'; Notification.requestPermission().then(v => window.permissionResult = v); 'started'");
  await waitFor(async () => (await shellA('cave.getState()')).permissionPrompt);
  assert.equal((await shellB('cave.getState()')).permissionPrompt, null);
  await click(port, overlayA, '#permission .actions button:first-child');
  await waitFor(() => evaluate(port, page, "window.permissionResult === 'denied'"));
  await shellA("cave.navigate('https://secure.cave.test/long-realm')");
  const auth = await waitFor(async () => (await shellA('cave.getState()')).httpAuthPrompt);
  assert.equal((await shellB('cave.getState()')).httpAuthPrompt, null);
  assert.equal(auth.realm.length, 256);
  assert.ok(auth.realm.startsWith('<b>'));
  assert.equal(await evaluate(port, overlayA, "!!document.querySelector('#httpAuth b')"), false);
  assert.ok((await evaluate(port, overlayA, "document.querySelector('#httpAuth').textContent")).includes(auth.realm));
  await click(port, overlayA, '#httpAuth button[type=button]');
  await waitFor(async () => !(await shellA('cave.getState()')).httpAuthPrompt);
});

test('reopen closed tab restores its URL, pin and position', async (t) => {
  const w = await startWorld({ blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = (expr) => evaluate(port, (u) => u.endsWith('/shell.html'), expr);
  await waitFor(async () => (await gateState(port)) === 'open', 60000);
  await shell("cave.navigate('http://find.cave.test/find.html')");
  await waitFor(() => evaluate(port, (u) => u === 'http://find.cave.test/find.html', 'document.title'));
  const id = await shell('cave.getState().then(s => s.active)');
  await shell(`cave.pinTab(${id}, true)`);
  await shell("cave.newTab('http://find.cave.test/')");
  await waitFor(async () => (await shell('cave.getState()')).tabs.length === 2);
  await shell(`cave.closeTab(${id})`);
  await waitFor(async () => (await shell('cave.getState()')).tabs.length === 1);
  await shell("cave.run('tab.reopen')");
  const state = await waitFor(async () => { const s = await shell('cave.getState()'); return s.tabs.length === 2 && s.tabs[0].url === 'http://find.cave.test/find.html' && s; });
  assert.equal(state.tabs[0].pinned, true);
  assert.equal(state.active, state.tabs[0].id);
});

test('environment reset clears saved session and closed tab stack', async (t) => {
  const w = await startWorld({ blank: true, keepDir: true, extra: ['--remote-debugging-port=0'] });
  t.after(async () => { await w.stop(); await rm(w.dir, { recursive: true, force: true }); });
  const port = await devtoolsPort(w.log);
  const shell = expr => evaluate(port, u => u.endsWith('/shell.html'), expr);
  await waitFor(async () => (await gateState(port)) === 'open', 60000);
  await shell("cave.navigate('http://find.cave.test/find.html')");
  await waitFor(() => evaluate(port, u => u === 'http://find.cave.test/find.html', 'document.title'));
  const id = await shell('cave.getState().then(s => s.active)');
  await new Promise(resolve => setTimeout(resolve, 1000));
  await shell('cave.newTab()');
  await shell(`cave.closeTab(${id})`);
  await waitFor(async () => (await shell('cave.getState()')).tabs.length === 1);
  await shell('cave.resetEnvironment()');
  await waitFor(async () => (await shell('cave.getState()')).tabs.length === 1);
  await shell("cave.run('tab.reopen')");
  assert.equal((await shell('cave.getState()')).tabs.length, 1);
  await new Promise(resolve => setTimeout(resolve, 1000));
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(w.dir, 'cave.sqlite'));
  try { assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get().n, 0); }
  finally { db.close(); }
});

test('session: clean startup restores tabs lazily and opt-out deletes snapshots', async t => {
  const first = await startWorld({ blank: true, keepDir: true, extra: ['--remote-debugging-port=0'] });
  let second;
  t.after(async () => { await first.stop(); if (second) await second.stop(); await rm(first.dir, { recursive: true, force: true }); });
  const port = await devtoolsPort(first.log);
  const shell = expr => evaluate(port, u => u.endsWith('/shell.html'), expr);
  await waitFor(async () => (await gateState(port)) === 'open', 60000);
  await shell('cave.setRestoreSession(true)');
  await shell("cave.navigate('http://one.cave.test/')");
  await waitFor(() => evaluate(port, u => u === 'http://one.cave.test/', 'document.title'));
  await shell('cave.getState().then(s => cave.pinTab(s.active, true))');
  await shell("cave.newTab('http://two.cave.test/')");
  await waitFor(() => evaluate(port, u => u === 'http://two.cave.test/', 'document.title'));
  const exited = new Promise(resolve => first.child.once('exit', resolve));
  void shell("cave.run('app.quit')").catch(() => {});
  await exited; await first.stop();
  second = await startWorld({ dir: first.dir, blank: true, keepDir: true, extra: ['--remote-debugging-port=0'] });
  const port2 = await devtoolsPort(second.log);
  const shell2 = expr => evaluate(port2, u => u.endsWith('/shell.html'), expr);
  const state = await waitFor(async () => { const s = await shell2('cave.getState()'); return s.tabs.length === 2 && s; });
  assert.deepEqual(state.tabs.map(tab => [tab.url, tab.pinned]), [['http://one.cave.test/', true], ['http://two.cave.test/', false]]);
  assert.equal(state.active, state.tabs[1].id);
  await waitFor(async () => (await gateState(port2)) === 'open', 60000);
  await waitFor(() => evaluate(port2, u => u === 'http://two.cave.test/', 'document.title'));
  assert.equal(second.socks.targets.some(x => x.host === 'one.cave.test'), false);
  await shell2(`cave.activate(${state.tabs[0].id})`);
  await waitFor(() => evaluate(port2, u => u === 'http://one.cave.test/', 'document.title'));
  await shell2('cave.setRestoreSession(false)');
  const exited2 = new Promise(resolve => second.child.once('exit', resolve));
  void shell2("cave.run('app.quit')").catch(() => {}); await exited2; await second.stop();
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(first.dir, 'cave.sqlite'));
  try { assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get().n, 0); } finally { db.close(); }
});

test('session: crash offers a saved session even when restore is off', async t => {
  const first = await startWorld({ blank: true, keepDir: true, extra: ['--remote-debugging-port=0'] });
  let second;
  t.after(async () => { await first.stop(); if (second) await second.stop(); await rm(first.dir, { recursive: true, force: true }); });
  const port = await devtoolsPort(first.log);
  const shell = expr => evaluate(port, u => u.endsWith('/shell.html'), expr);
  await waitFor(async () => (await gateState(port)) === 'open', 60000);
  await shell("cave.navigate('http://crash.cave.test/')");
  await waitFor(() => evaluate(port, u => u === 'http://crash.cave.test/', 'document.title'));
  const { DatabaseSync } = await import('node:sqlite');
  await waitFor(() => { const db = new DatabaseSync(join(first.dir, 'cave.sqlite')); try { return db.prepare('SELECT count(*) AS n FROM sessions').get().n > 0; } finally { db.close(); } });
  const exited = new Promise(resolve => first.child.once('exit', resolve));
  process.kill(-first.child.pid, 'SIGKILL'); await exited; await first.stop();
  second = await startWorld({ dir: first.dir, blank: true, keepDir: true, extra: ['--remote-debugging-port=0'] });
  const port2 = await devtoolsPort(second.log);
  const shell2 = expr => evaluate(port2, u => u.endsWith('/shell.html'), expr);
  await waitFor(async () => (await shell2('cave.getState()')).surface?.name === 'restoreSession');
  const oldShell = (await listTargets(port2)).find(target => target.url.endsWith('/shell.html')).id;
  void evaluate(port2, u => u.endsWith('/overlay.html'), 'cave.restoreSession()').catch(() => {});
  const restored = await waitFor(async () => (await listTargets(port2)).find(target => target.url.endsWith('/shell.html') && target.id !== oldShell));
  await waitFor(async () => (await evaluate(port2, { targetId: restored.id }, 'cave.getState()')).tabs.some(tab => tab.url === 'http://crash.cave.test/'));
});


test('downloads: bubble shows streaming progress, full list and clearing records', async t => {
  const { port, shell, overlay, settings } = await launch(t, { blank: true, open: true });
  await shell("cave.navigate('http://download.cave.test/')");
  await waitFor(() => evaluate(port, u => u === 'http://download.cave.test/', 'document.title'));
  await evaluate(port, u => u === 'http://download.cave.test/', "location.href='/slow-download'");
  await waitFor(async () => (await shell('cave.getState()')).downloads.some(d => d.received > 0 && d.received < d.total));
  await shell("document.querySelector('#downloads').click()");
  await waitFor(async () => (await shell('cave.getState()')).surface?.name === 'downloads');
  assert.match(await waitFor(() => overlay("document.querySelector('#downloads')?.textContent")), /slow.bin/);
  const completed = await waitFor(async () => (await shell('cave.getState()')).downloads.find(d => d.state === 'completed'), 15000);
  assert.match(await overlay("document.querySelector('#downloads')?.textContent"), /完成|Completed/);
  await shell("document.querySelector('#downloads').click()");
  await waitFor(async () => !(await shell('cave.getState()')).surface);
  await shell("cave.run('downloads.open')");
  await waitFor(() => settings("document.querySelector('[data-section=downloads]:not([hidden]) #downloads')?.textContent.includes('slow.bin')"));
  await settings("[...document.querySelectorAll('[data-section=downloads] button')].find(b => b.textContent === '清除记录').click()");
  await waitFor(async () => (await shell('cave.listDownloads()')).length === 0);
  assert.ok((await readFile(completed.path)).length > 0, 'clearing records keeps the file');
});


test('downloads: pause resume and cancel tolerate repeated and late actions', async t => {
  const w = await startWorld({ blank: true, extra: ['--remote-debugging-port=0'] }); t.after(() => w.stop());
  const port = await devtoolsPort(w.log), shell = expr => evaluate(port, u => u.endsWith('/shell.html'), expr);
  await waitFor(async () => (await gateState(port)) === 'open', 60000);
  await shell("cave.navigate('http://download.cave.test/')");
  await waitFor(() => evaluate(port, u => u === 'http://download.cave.test/', 'document.title'));
  await evaluate(port, u => u === 'http://download.cave.test/', "location.href='/slow-download'");
  const d = await waitFor(async () => (await shell('cave.getState()')).downloads.find(d => d.received > 0 && d.state === 'progressing'));
  await shell(`cave.downloadAction(${d.id}, 'pause')`);
  await waitFor(async () => (await shell('cave.getState()')).downloads[0].paused);
  await shell(`cave.downloadAction(${d.id}, 'pause')`);
  await shell(`cave.downloadAction(${d.id}, 'resume')`);
  await waitFor(async () => !(await shell('cave.getState()')).downloads[0].paused);
  await shell(`cave.downloadAction(${d.id}, 'cancel')`);
  await waitFor(async () => (await shell('cave.getState()')).downloads[0].state === 'cancelled');
  await shell(`Promise.all(['cancel', 'pause', 'resume'].map(a => cave.downloadAction(${d.id}, a)))`);
  assert.equal((await shell('cave.getState()')).downloads[0].state, 'cancelled');
});


test('downloads: registered paths are used for file actions and records can be removed', async t => {
  const w = await startWorld({ blank: true, downloadLog: true, extra: ['--remote-debugging-port=0'] }); t.after(() => w.stop());
  const port = await devtoolsPort(w.log), shell = expr => evaluate(port, u => u.endsWith('/shell.html'), expr);
  await waitFor(async () => (await gateState(port)) === 'open', 60000);
  await shell("cave.navigate('http://download.cave.test/')");
  await waitFor(() => evaluate(port, u => u === 'http://download.cave.test/', 'document.title'));
  await evaluate(port, u => u === 'http://download.cave.test/', "location.href='/slow-download'");
  const d = await waitFor(async () => (await shell('cave.getState()')).downloads.find(d => d.state === 'completed'), 15000);
  await shell(`cave.downloadAction(${d.id + 999}, 'open')`);
  await shell(`cave.downloadAction(${d.id}, 'open')`); await shell(`cave.downloadAction(${d.id}, 'reveal')`);
  assert.deepEqual((await readFile(join(w.dir, 'download-actions.log'), 'utf8')).trim().split('\n').map(JSON.parse), [['open', d.path], ['reveal', d.path]]);
  await rm(d.path);
  await shell(`cave.downloadAction(${d.id}, 'open')`);
  assert.equal((await shell('cave.getState()')).downloads[0].exists, false);
  await shell("cave.toggleSurface('downloads')");
  const overlay = expr => evaluate(port, u => u.endsWith('/overlay.html'), expr);
  assert.equal(await waitFor(() => overlay("document.querySelector('#downloads button[disabled]')?.title")), '文件不存在');
  await shell(`cave.downloadAction(${d.id}, 'remove')`);
  assert.equal((await shell('cave.getState()')).downloads.length, 0);
});


test('downloads: persistence, windows and environment reset', async t => {
  const first = await startWorld({ blank: true, keepDir: true, extra: ['--remote-debugging-port=0'] }); t.after(() => first.stop());
  const port = await devtoolsPort(first.log), shell = expr => evaluate(port, u => u.endsWith('/shell.html'), expr);
  await waitFor(async () => (await gateState(port)) === 'open', 60000);
  const before = new Set((await listTargets(port)).map(x => x.id));
  await shell("cave.run('window.new')");
  const target = await waitFor(async () => (await listTargets(port)).find(x => !before.has(x.id) && x.url.endsWith('/shell.html')));
  const other = expr => evaluate(port, { targetId: target.id }, expr);
  await shell("cave.navigate('http://download.cave.test/')");
  await waitFor(() => evaluate(port, u => u === 'http://download.cave.test/', 'document.title'));
  await evaluate(port, u => u === 'http://download.cave.test/', "location.href='/slow-download'");
  const d = await waitFor(async () => (await other('cave.listDownloads()')).find(x => x.received > 0));
  assert.ok(d.started && d.ended === null);
  await first.stop();
  const second = await startWorld({ blank: true, dir: first.dir, extra: ['--remote-debugging-port=0'] }); t.after(() => second.stop());
  const port2 = await devtoolsPort(second.log), shell2 = expr => evaluate(port2, u => u.endsWith('/shell.html'), expr);
  const restored = await waitFor(async () => (await shell2('cave.listDownloads()')).find(x => x.id === d.id));
  assert.equal(restored.state, 'interrupted'); assert.ok(restored.ended);
  await shell2('cave.resetEnvironment()');
  assert.deepEqual(await shell2('cave.listDownloads()'), []);
  await second.stop();
  const third = await startWorld({ blank: true, dir: first.dir, extra: ['--remote-debugging-port=0'] }); t.after(() => third.stop());
  const port3 = await devtoolsPort(third.log);
  assert.deepEqual(await waitFor(() => evaluate(port3, u => u.endsWith('/shell.html'), 'cave.listDownloads()')), []);
});


test('history: records committed pages and opens a shell tab', async (t) => {
  const w = await startWorld({ blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = (expr) => evaluate(port, (u) => u.endsWith('/shell.html'), expr);
  const historyPage = (expr) => evaluate(port, (u) => u.endsWith('/history.html'), expr);
  await waitFor(async () => (await gateState(port)) === 'open');
  await shell("cave.navigate('http://find.cave.test/find.html')");
  await waitFor(() => evaluate(port, (u) => u === 'http://find.cave.test/find.html', 'document.title'));
  await shell("cave.newTab('http://fp.cave.test/')");
  await waitFor(() => evaluate(port, isFixture, 'document.title'));
  await shell("cave.run('history.open')");
  await waitFor(async () => (await historyPage('document.querySelectorAll(".visit").length')) >= 2);
  const urls = await historyPage('[...document.querySelectorAll(".visit small")].map(x => x.textContent)');
  assert.deepEqual(urls.slice(0, 2), ['http://fp.cave.test/', 'http://find.cave.test/find.html']);
  assert.equal(await shell("cave.historyList('', null, 10)"), undefined);
  await historyPage('document.querySelector(".visit").click()');
  await waitFor(async () => (await shell('cave.getState()')).tabs.filter(t => t.url === 'http://fp.cave.test/').length === 2);
  await shell("cave.run('history.open')");
  await historyPage(`(() => { const input = document.querySelector('input[type=search]'); input.value = 'find'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitFor(async () => (await historyPage('document.querySelectorAll(".visit").length')) === 1);
  assert.ok((await historyPage('document.querySelector(".visit small").textContent')).includes('find'));
  await historyPage('document.querySelector(".row .btn").click()');
  await waitFor(async () => (await historyPage('document.querySelectorAll(".visit").length')) === 0);
  await historyPage(`(() => { const input = document.querySelector('input[type=search]'); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await shell("cave.newTab('http://fp.cave.test/find.html')");
  await waitFor(() => evaluate(port, (u) => u === 'http://fp.cave.test/find.html', 'document.title'));
  await shell("cave.run('history.open')");
  await waitFor(async () => (await historyPage('document.querySelectorAll(".visit").length')) === 3);
  await historyPage('document.querySelectorAll(".row input")[0].click()');
  await historyPage('document.querySelectorAll(".row input")[1].click()');
  await historyPage('document.querySelector(".toolbar button").click()');
  await waitFor(async () => (await historyPage('document.querySelectorAll(".visit").length')) === 0);
});

test('history: clear browsing data persists after restart', async (t) => {
  const { w, port, shell, settings } = await launch(t, { blank: true, keepDir: true, open: true });
  let next;
  t.after(async () => { if (next) await next.stop(); await rm(w.dir, { recursive: true, force: true }); });
  await shell("cave.navigate('http://download.cave.test/')");
  await waitFor(() => evaluate(port, (u) => u === 'http://download.cave.test/', 'document.title'));
  await evaluate(port, (u) => u === 'http://download.cave.test/', "location.href='/slow-download'");
  const download = await waitFor(async () => (await shell('cave.listDownloads()')).find(d => d.state === 'completed'), 15000);
  await shell("cave.openSettings('privacy')");
  await waitFor(() => settings('document.querySelector("#clear-data button")'));
  await settings("document.querySelectorAll('#clear-data input')[3].click()");
  await settings('document.querySelector("#clear-data button").click()');
  await waitFor(async () => (await shell('cave.getState()')).tabs.some(t => t.kind === 'settings'));
  await waitFor(async () => (await settings('document.querySelector("#clear-data button").disabled')) === false);
  await waitFor(async () => (await shell('cave.listDownloads()')).length === 0);
  assert.ok((await readFile(download.path)).length > 0);
  await shell("cave.run('history.open')");
  await waitFor(async () => (await evaluate(port, (u) => u.endsWith('/history.html'), "cave.historyList('', null, 10)"))?.length === 0);
  await w.stop();
  next = await startWorld({ dir: w.dir, blank: true, keepDir: true, extra: ['--remote-debugging-port=0'] });
  const port2 = await devtoolsPort(next.log);
  await waitFor(() => evaluate(port2, (u) => u.endsWith('/shell.html'), "cave.run('history.open').then(() => true)"));
  const page = (expr) => evaluate(port2, (u) => u.endsWith('/history.html'), expr);
  await waitFor(() => page('document.querySelector("main")'));
  assert.equal(await page('document.querySelectorAll(".visit").length'), 0);
  assert.deepEqual(await evaluate(port2, (u) => u.endsWith('/shell.html'), 'cave.listDownloads()'), []);
  assert.ok((await readFile(download.path)).length > 0);
});

test('history: excludes internal pages, failed loads and subframes', async (t) => {
  const w = await startWorld({ blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = (expr) => evaluate(port, (u) => u.endsWith('/shell.html'), expr);
  await waitFor(async () => (await gateState(port)) === 'open');
  await shell("cave.navigate('http://fp.cave.test/auth-subresources')");
  await waitFor(() => evaluate(port, (u) => u === 'http://fp.cave.test/auth-subresources', 'document.title'));
  await shell("cave.openSettings()");
  w.blockedHosts.add('missing.cave.test');
  await shell("cave.newTab('http://missing.cave.test/')");
  await waitFor(async () => (await shell('cave.getState()')).recovery);
  await shell("cave.run('history.open')");
  const page = (expr) => evaluate(port, (u) => u.endsWith('/history.html'), expr);
  await waitFor(async () => (await page('document.querySelectorAll(".visit").length')) >= 1);
  assert.deepEqual(await page('[...document.querySelectorAll(".visit small")].map(x => x.textContent)'), ['http://fp.cave.test/auth-subresources']);
});

test('history: site data clearing reloads web tabs', async (t) => {
  const w = await startWorld({ blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = (expr) => evaluate(port, (u) => u.endsWith('/shell.html'), expr);
  const page = (expr) => evaluate(port, (u) => u === 'http://fp.cave.test/find.html', expr);
  const settings = (expr) => evaluate(port, (u) => u.endsWith('/settings.html'), expr);
  await waitFor(async () => (await gateState(port)) === 'open');
  await shell("cave.navigate('http://fp.cave.test/find.html')");
  await waitFor(() => page('document.title'));
  await page("document.cookie = 'historytest=present; path=/'; localStorage.setItem('historytest', 'present')");
  await shell("cave.openSettings('privacy')");
  await waitFor(() => settings('document.querySelector("#clear-data")'));
  await settings("document.querySelectorAll('#clear-data input')[0].click()");
  await settings("document.querySelectorAll('#clear-data input')[1].click()");
  await waitFor(() => settings("!document.querySelector('#clear-data button').disabled"));
  await settings("document.querySelector('#clear-data button').click()");
  try { await waitFor(async () => (await page("document.cookie.includes('historytest=') || localStorage.getItem('historytest') !== null")) === false); } catch (error) { throw new Error(`${error.message}; notice: ${await settings("document.querySelector('#notice').textContent")}`); }
  await waitFor(async () => (await page("performance.getEntriesByType('navigation')[0].type")) === 'reload');
});

test('history: all-time clear revokes certificates and closed tabs', async (t) => {
  const w = await startWorld({ tls: true, blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = (expr) => evaluate(port, (u) => u.endsWith('/shell.html'), expr);
  const settings = (expr) => evaluate(port, (u) => u.endsWith('/settings.html'), expr);
  const recovery = (u) => u.endsWith('/internal-error.html');
  await waitFor(async () => (await gateState(port)) === 'open');
  await shell("cave.navigate('https://bad.cave.test/')");
  await waitFor(async () => (await shell('cave.getState()')).recovery?.canContinue);
  await click(port, recovery, '[aria-expanded]');
  await click(port, recovery, '.advanced button');
  await waitFor(() => evaluate(port, (u) => u === 'https://bad.cave.test/', 'document.title'));
  await shell("cave.newTab('http://fp.cave.test/')");
  await waitFor(() => evaluate(port, isFixture, 'document.title'));
  await shell("cave.run('tab.close')");
  await shell("cave.openSettings('privacy')");
  await waitFor(() => settings('document.querySelector("#clear-data button")'));
  await settings("document.querySelector('#clear-data button').click()");
  await waitFor(async () => (await settings('document.querySelector("#clear-data button").disabled')) === false);
  const count = (await shell('cave.getState()')).tabs.length;
  await shell("cave.run('tab.reopen')");
  assert.equal((await shell('cave.getState()')).tabs.length, count);
  await shell("cave.newTab('https://bad.cave.test/')");
  assert.equal((await waitFor(async () => (await shell('cave.getState()')).recovery)).kind, 'certificate');
});

test('bookmark: star synchronizes windows and persists', async (t) => {
  const w = await startWorld({ blank: true, keepDir: true, extra: ['--remote-debugging-port=0'] });
  t.after(async () => { await w.stop(); await rm(w.dir, { recursive: true, force: true }); });
  const port = await devtoolsPort(w.log);
  const first = () => evaluate(port, u => u.endsWith('/shell.html'), 'cave.getState()');
  await waitFor(async () => (await gateState(port)) === 'open', 60000);
  await evaluate(port, u => u.endsWith('/shell.html'), "cave.navigate('http://find.cave.test/find.html')");
  await waitFor(() => evaluate(port, u => u === 'http://find.cave.test/find.html', 'document.title'));
  await evaluate(port, u => u.endsWith('/shell.html'), "cave.run('window.new')");
  const shells = await waitFor(async () => { const targets = (await listTargets(port)).filter(x => x.url.endsWith('/shell.html')); return targets.length === 2 && targets; });
  const ids = shells.map(x => ({ targetId: x.id }));
  const original = (await evaluate(port, ids[0], 'cave.getState()')).tabs.some(x => x.url === 'http://find.cave.test/find.html') ? ids[0] : ids[1];
  const other = original === ids[0] ? ids[1] : ids[0];
  await evaluate(port, other, "cave.navigate('http://find.cave.test/find.html')");
  await waitFor(async () => (await evaluate(port, other, 'cave.getState()')).tabs.some(x => x.url === 'http://find.cave.test/find.html'));
  await click(port, original, '#bookmark');
  await waitFor(async () => (await evaluate(port, original, 'cave.getState()')).bookmarked && (await evaluate(port, other, 'cave.getState()')).bookmarked);
  await w.stop();
  const restarted = await startWorld({ dir: w.dir, blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => restarted.stop());
  const next = await devtoolsPort(restarted.log);
  await waitFor(async () => (await gateState(next)) === 'open', 60000);
  await evaluate(next, u => u.endsWith('/shell.html'), "cave.navigate('http://find.cave.test/find.html')");
  await waitFor(async () => (await evaluate(next, u => u.endsWith('/shell.html'), 'cave.getState()')).bookmarked);
  const shell = u => u.endsWith('/shell.html'), overlay = u => u.endsWith('/overlay.html');
  await click(next, shell, '#bookmark');
  await waitFor(() => evaluate(next, overlay, "!!document.querySelector('#bookmark-title')"));
  await evaluate(next, overlay, `(() => { const input = document.querySelector('#bookmark-title'); input.value = 'Renamed'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click(next, overlay, '#bookmarkEdit button[type=submit]');
  await waitFor(async () => (await evaluate(next, shell, 'cave.getState()')).bookmarkMatches[0]?.title === 'Renamed');
  const active = (await evaluate(next, shell, 'cave.getState()')).active;
  await evaluate(next, shell, 'cave.openSettings()');
  await waitFor(() => evaluate(next, u => u.endsWith('/settings.html'), 'document.readyState === "complete"'));
  await evaluate(next, u => u.endsWith('/settings.html'), 'cave.clearData({from: 0, to: Number.MAX_SAFE_INTEGER, history: true, siteData: false, cache: false, downloads: false})');
  await evaluate(next, shell, `cave.activate(${active})`);
  await waitFor(async () => (await evaluate(next, shell, 'cave.getState()')).bookmarked);
  await evaluate(next, shell, "cave.bookmarkAdd(null, 'link', 'Duplicate', 'http://find.cave.test/find.html')");
  await click(next, shell, '#bookmark');
  await waitFor(() => evaluate(next, overlay, "document.querySelector('#bookmarkEdit p')?.textContent.includes('2')"));
  await waitFor(() => evaluate(next, overlay, "!!document.querySelector('#bookmarkEdit button[type=button]')"));
  await click(next, overlay, '#bookmarkEdit button[type=button]');
  await waitFor(async () => !(await evaluate(next, shell, 'cave.getState()')).bookmarked);
});

test('bookmarks: manager edits folders and persists across restart', async (t) => {
  const w = await startWorld({ blank: true, keepDir: true, extra: ['--remote-debugging-port=0'] });
  let next;
  t.after(async () => { await w.stop(); if (next) await next.stop(); await rm(w.dir, { recursive: true, force: true }); });
  const port = await devtoolsPort(w.log);
  const shell = expr => evaluate(port, u => u.endsWith('/shell.html'), expr);
  const page = expr => evaluate(port, u => u.endsWith('/bookmarks.html'), expr);
  await waitFor(() => shell("cave.run('bookmarks.open').then(() => true)"));
  await waitFor(() => page('document.querySelector("main")'));
  await page('document.querySelector(".toolbar button").click()');
  await page(`(() => { const input = document.querySelector('form input'); input.value = 'Folder'; input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await page("document.querySelector('form').requestSubmit()");
  await waitFor(() => page('document.querySelector(".visit strong")?.textContent === "Folder"'));
  await page('document.querySelector(".visit").click()');
  await page('document.querySelectorAll(".toolbar button")[1].click()');
  await page(`(() => { const inputs = document.querySelectorAll('form input'); inputs[0].value = 'Link'; inputs[0].dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await page("(() => { const input = document.querySelectorAll('form input')[1]; input.value = 'https://example.com/'; input.dispatchEvent(new Event('input', {bubbles:true})); })()");
  await page("document.querySelector('form').requestSubmit()");
  await waitFor(() => page('document.querySelector(".visit strong")?.textContent === "Link"'));
  const folder = (await page('cave.bookmarkChildren(null)'))[0];
  const link = (await page(`cave.bookmarkChildren(${folder.id})`))[0];
  await page(`cave.bookmarkUpdate(${link.id}, 'Renamed', 'https://example.com/')`);
  await waitFor(() => page('document.querySelector(".visit strong")?.textContent === "Renamed"'));
  await page(`cave.bookmarkMove(${link.id}, null, 0)`);
  await page('document.querySelector("nav button").click()');
  await waitFor(() => page('document.querySelectorAll(".visit").length === 2'));
  await w.stop();
  next = await startWorld({ dir: w.dir, blank: true, keepDir: true, extra: ['--remote-debugging-port=0'] });
  const port2 = await devtoolsPort(next.log);
  await waitFor(() => evaluate(port2, u => u.endsWith('/shell.html'), "cave.run('bookmarks.open').then(() => true)"));
  const page2 = expr => evaluate(port2, u => u.endsWith('/bookmarks.html'), expr);
  await waitFor(() => page2('document.querySelectorAll(".visit").length === 2'));
  assert.deepEqual(await page2('[...document.querySelectorAll(".visit strong")].map(x => x.textContent)'), ['Renamed', 'Folder']);
  await page2(`cave.bookmarkRemove(${folder.id})`);
  await waitFor(() => page2('document.querySelectorAll(".visit").length === 1'));
});


test('bookmarks: import through picker seam', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'cave-bookmark-import-'));
  const file = join(dir, 'bookmarks.html');
  await writeFile(file, '<DL><DT><H3>Folder</H3><DL><DT><A HREF="https://example.com/">Example</A><DT><A HREF="javascript:bad">Bad</A></DL></DL>');
  const w = await startWorld({ blank: true, bookmarkFile: file, extra: ['--remote-debugging-port=0'] });
  t.after(async () => { await w.stop(); await rm(dir, { recursive: true, force: true }); });
  const port = await devtoolsPort(w.log);
  await waitFor(() => evaluate(port, u => u.endsWith('/shell.html'), "cave.run('bookmarks.open').then(() => true)"));
  const page = expr => evaluate(port, u => u.endsWith('/bookmarks.html'), expr);
  await waitFor(() => page('document.querySelectorAll(".toolbar button").length === 3'));
  await page('document.querySelectorAll(".toolbar button")[2].click()');
  await waitFor(() => page('document.querySelector("[role=status]")?.textContent.includes("2")'));
  assert.match(await page('document.querySelector("[role=status]").textContent'), /1/);
  const root = (await page('cave.bookmarkChildren(null)'))[0];
  assert.equal(root.title, '已导入');
  const folder = (await page(`cave.bookmarkChildren(${root.id})`))[0];
  assert.equal((await page(`cave.bookmarkChildren(${folder.id})`))[0].url, 'https://example.com/');
});

test('address: outside mouse press clears editing and selection', async (t) => {
  const { port, shell } = await launch(t, { open: true });
  await shell("cave.navigate('http://fp.cave.test/')");
  await waitFor(() => evaluate(port, isFixture, 'document.title'));
  await click(port, u => u.endsWith('/shell.html'), '#address');
  await waitFor(() => shell("cave.getState().then(s => !!s.address)"));
  assert.ok(await shell("address.selectionEnd > address.selectionStart"));
  await shell("(() => { const input = document.querySelector('#address'); input.value = 'unfinished draft'; input.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await withTarget(port, isFixture, async send => {
    const event = { x: 10, y: 10, button: 'left', clickCount: 1 };
    await send('Input.dispatchMouseEvent', { ...event, type: 'mousePressed' });
    await send('Input.dispatchMouseEvent', { ...event, type: 'mouseReleased' });
  });
  await waitFor(() => shell("cave.getState().then(s => !s.address)"));
  assert.deepEqual(await shell("[document.activeElement === address, address.selectionStart === address.selectionEnd, address.value, address.classList.contains('viewing')]"), [false, true, 'http://fp.cave.test/', true]);
});


test('tab closing: closing the last tab exits the app', async (t) => {
  const { w, port } = await launch(t, { blank: true });
  const shell = u => u.endsWith('/shell.html');
  const id = await waitFor(() => evaluate(port, shell, 'cave.getState().then(s => s.active)'));
  const exited = new Promise(resolve => w.child.once('exit', resolve));
  await evaluate(port, shell, `cave.closeTab(${id})`).catch(() => {});
  await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('app did not exit')), 10000))]);
});

test('favicon and site info route through proxy', async (t) => {
  const { w, port, shell, overlay } = await launch(t, { tls: true, blank: true, open: true });
  await shell("cave.navigate('http://fp.cave.test/favicon-page')");
  await waitFor(() => shell("!!document.querySelector('.tab.active .fav img') && !!document.querySelector('#site-icon img')"));
  assert.ok(w.socks.targets.some(x => x.host === 'icon.cave.test' && x.port === 80));
  assert.ok(w.fixture.requests.some(x => x.host === 'icon.cave.test' && x.url === '/icon.png'));
  await shell("document.querySelector('#site-icon').click()");
  await waitFor(() => overlay("document.querySelector('#siteInfo.in')?.textContent.includes('连接不安全')"));
  await shell("document.querySelector('#site-icon').click()");
  await waitFor(async () => !(await shell('cave.getState()')).surface);
  await shell(`cave.navigate(${JSON.stringify(w.httpsUrl)})`);
  await waitFor(async () => { const s = await shell('cave.getState()'); return s.tabs.find(t => t.id === s.active)?.url === w.httpsUrl && !s.tabs.find(t => t.id === s.active)?.loading; });
  await evaluate(port, u => u === w.httpsUrl, "document.cookie='info=1; path=/'; localStorage.setItem('info', '1')");
  await shell("document.querySelector('#site-icon').click()");
  await waitFor(() => overlay("document.querySelector('#siteInfo.in')?.textContent.includes('连接安全')"));
  await waitFor(() => overlay("!!document.querySelector('.site-info-certificate')"));
  await overlay("document.querySelector('.site-info-certificate').open = true");
  assert.match(await overlay("document.querySelector('.site-info-certificate').textContent"), /secure\.cave\.test/);
  await overlay("document.querySelector('#siteInfo .status-actions button').click()");
  await waitFor(() => overlay("!!document.querySelector('.site-info-confirm')"));
  await overlay("document.querySelector('.site-info-confirm .primary').click()");
  await waitFor(async () => (await evaluate(port, u => u === w.httpsUrl, "localStorage.getItem('info')")) === null);
  assert.equal(await evaluate(port, u => u === w.httpsUrl, 'document.cookie'), '');
});

test('appearance settings synchronize and survive restart', async (t) => {
  const { w, port, shell, settings } = await launch(t, { blank: true, keepDir: true });
  let second;
  t.after(async () => { if (second) await second.stop(); await rm(w.dir, { recursive: true, force: true }); });
  const check = async (p) => {
    for (const target of [u => u.endsWith('/shell.html'), u => u.endsWith('/settings.html')]) {
      await waitFor(() => evaluate(p, target, "document.documentElement.dataset.accent === 'violet' && matchMedia('(prefers-color-scheme: dark)').matches"));
    }
  };
  await waitFor(() => settings("!!document.querySelector('input[name=accent]')"));
  await shell("cave.openSettings('appearance')");
  await settings("document.querySelector('input[name=accent][value=violet]').click(); document.querySelector('input[name=theme][value=dark]').click()");
  await check(port);
  await w.stop();
  second = await startWorld({ dir: w.dir, blank: true, extra: ['--remote-debugging-port=0'] });
  const port2 = await devtoolsPort(second.log);
  await check(port2);
  assert.deepEqual(await evaluate(port2, u => u.endsWith('/shell.html'), "cave.getState().then(s => [s.accent, s.theme])"), ['violet', 'dark']);
});
