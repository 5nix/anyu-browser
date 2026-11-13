// End-to-end on a real Cave window (Linux, Xvfb). Everything stays on this machine: the "node"
// is a local SOCKS5 server and every page is served by the local fixture server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { X509Certificate, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { launch, startWorld, PROFILE } from './harness.mjs';
import { startFixtureServer } from '../../server.mjs';
import { startSocks } from '../../socks.mjs';
import { click, devtoolsPort, evaluate, gateState, waitFor, withTarget } from './cdp.mjs';

const isFixture = (u) => u.startsWith('http://fp.cave.test/');


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
    assert.doesNotMatch(s.userAgent, /Electron|Cave|Anyu|HeadlessChrome/, `${name} UA`);
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
  assert.equal(r.hasSpeechSynthesis, true);
  assert.equal(r.speechVoices, 0);
  await evaluate(port, shell, "cave.navigate('http://fp.cave.test/')");
  await waitFor(() => evaluate(port, (u) => u === 'http://fp.cave.test/', 'document.title'));
  const frameSpeech = await evaluate(port, (u) => u === 'http://fp.cave.test/', `new Promise((resolve) => {
    window.addEventListener('message', (e) => { if (e.data?.type === 'speech-frame') resolve(e.data); });
    const f = document.createElement('iframe');
    f.src = 'http://other.cave.test/speech-frame';
    document.body.appendChild(f);
  })`);
  assert.deepEqual(frameSpeech, { type: 'speech-frame', has: true, initial: 0, afterWait: 0 });
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
  assert.equal(checks.length, 14);
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


test('closed gate queues search', async (t) => {
  const w = await startWorld({ extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  await w.fixture.nextReport(45000);
  const port = await devtoolsPort(w.log);
  const shell = (expr) => evaluate(port, (u) => u.endsWith('/shell.html'), expr);
  await shell('cave.pause()');
  const count = w.fixture.requests.length;
  await shell("cave.navigate('red fox')");
  assert.equal((await shell('cave.getState()')).gate.state, 'closed');
  assert.equal(w.fixture.requests.length, count);
  assert.ok(!(await shell('cave.getState()')).tabs.some(t => t.url.includes('duckduckgo.com')));
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


test('pdf: online PDFs render in the built-in viewer through the proxy', async (t) => {
  const { w, port, shell } = await launch(t, { tls: true, blank: true, open: true });
  const evalUrl = async (wsUrl, expression) => {
    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
    try {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
      const msg = await new Promise((r) => (ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) r(d); }));
      if (msg.error) throw new Error(msg.error.message);
      return msg.result?.result?.value;
    } finally {
      ws.close();
    }
  };
  for (const url of ['http://pdf.cave.test/sample.pdf', 'https://secure.cave.test/sample.pdf']) {
    await shell(`cave.newTab(${JSON.stringify(url)})`);
    await waitFor(async () => {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const viewers = targets.filter((x) => x.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'));
      for (const viewer of viewers) {
        const info = await evalUrl(viewer.webSocketDebuggerUrl, `(() => {
          const toolbar = document.querySelector('pdf-viewer')?.shadowRoot?.querySelector('viewer-toolbar');
          return toolbar ? { loading: toolbar.hasAttribute('loading_'), docLength: toolbar.docLength } : null;
        })()`).catch(() => null);
        if (info && !info.loading && info.docLength === 1) return true;
      }
      return false;
    }, 20000);
    await shell("cave.run('tab.close')");
  }
  assert.ok(w.socks.targets.some((x) => x.host === 'pdf.cave.test' && x.port === 80));
  assert.ok(w.socks.targets.some((x) => x.host === 'secure.cave.test' && x.port === 443));
  assert.ok(w.fixture.requests.some((x) => x.host === 'pdf.cave.test' && x.url === '/sample.pdf'));
  assert.ok(w.httpsFixture.requests.some((x) => x.host === 'secure.cave.test' && x.url === '/sample.pdf'));
});

