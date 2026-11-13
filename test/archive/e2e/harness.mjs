// Launches a real Cave against local stand-ins only: a fixture HTTP server, a SOCKS5 "node"
// that maps *.cave.test to it, and a throwaway profile. Nothing here reaches the internet.
// Windows run inactive at a requested off-screen position by default (macOS may clamp it
// onto a display). Pass foreground: true only for tests that require a foreground window.
// Input should use CDP or sendInputEvent.
import { spawn, execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { X509Certificate, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startFixtureServer } from '../../server.mjs';
import { startSocks } from '../../socks.mjs';
import { devtoolsPort, evaluate, gateState, waitFor } from './cdp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const execFile = promisify(execFileCallback);
export const electronBinary = process.env.CAVE_ELECTRON || createRequire(import.meta.url)('electron');

export const PROFILE = {
  version: 1,
  locale: 'de-DE',
  acceptLanguages: ['de-DE', 'de', 'en'],
  timezone: 'Etc/GMT+8',
  geolocation: { latitude: 1, longitude: 2, accuracy: 50 },
  egressCountry: 'QM',
  platform: 'host',
  allowPrivateNetwork: false,
  notifications: false,
  proxy: { subscriptionUrl: '', selectedNode: 'Test Node' },
};

export async function startWorld({ profile = PROFILE, fresh = false, wrap = [], extra = [], dir: existingDir, blank = false, keepDir = false, tls = false, downloadLog = false, bookmarkFile, foreground = false } = {}) {
  const dir = existingDir ?? await mkdtemp(join(tmpdir(), 'cave-e2e-'));
  await mkdir(dir, { recursive: true });
  const trusted = tls ? await certificate(dir, 'secure', 'secure.cave.test') : null;
  const untrusted = tls ? await certificate(dir, 'untrusted', 'bad.cave.test') : null;
  const httpsFixture = trusted && await startFixtureServer({ tls: trusted });
  let untrustedFixture = untrusted && await startFixtureServer({ tls: untrusted });
  const fixture = await startFixtureServer({ country: 'QM' });
  const blockedHosts = new Set();
  const socks = await startSocks({
    map: (host, port) => {
      if (blockedHosts.has(host) || !host.endsWith('.test')) return null;
      if (tls && port === 443 && host === 'secure.cave.test') return { host: '127.0.0.1', port: httpsFixture.port };
      if (tls && port === 443) return { host: '127.0.0.1', port: untrustedFixture.port };
      return { host: '127.0.0.1', port: fixture.port };
    },
  });
  if (!fresh) {
    await writeFile(join(dir, 'profile.json'), JSON.stringify(profile, null, 2));
    await writeFile(
      join(dir, 'subscription.yaml'),
      `proxies:\n  - { name: Test Node, type: socks5, server: 127.0.0.1, port: ${socks.port}, udp: false }\n`,
    );
  }
  const url = 'http://fp.cave.test/fp.html';
  const env = {
    CAVE_LANG: "zh-CN", // the tests read the Chinese interface, whatever language the machine is in
    ...process.env,
    CAVE_PROFILE: dir,
    CAVE_TEST_HARNESS: '1',
    CAVE_E2E_BACKGROUND: foreground ? '0' : '1',
    ...(bookmarkFile ? { CAVE_TEST_BOOKMARK_FILE: bookmarkFile } : {}),
    ...(downloadLog ? { CAVE_TEST_DOWNLOAD_LOG: join(dir, 'download-actions.log') } : {}),
    CAVE_TRACE_URL: 'http://trace.cave.test/cdn-cgi/trace',
    ELECTRON_ENABLE_LOGGING: '1',
  };
  // The host may itself run inside Electron; the child must start as an app.
  delete env.ELECTRON_RUN_AS_NODE;
  // CAVE_APP runs a packaged build instead of the source tree, with the sandbox it ships with;
  // the development Electron has no sandbox helper set up.
  const app = process.env.CAVE_APP;
  const args = [...(app ? [] : ['--no-sandbox', root]), '--unsafely-treat-insecure-origin-as-secure=http://fp.cave.test', ...(trusted ? [`--ignore-certificate-errors-spki-list=${trusted.spki}`] : []), ...extra, ...(blank ? [] : [url])];
  const binary = app ?? electronBinary;
  const cmd = wrap.length ? wrap[0] : binary;
  const argv = wrap.length ? [...wrap.slice(1), binary, ...args] : args;
  // Own process group, so stopping also takes down anything a wrapper (strace) started.
  const child = spawn(cmd, argv, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const exited = new Promise((r) => child.on('exit', r));
  let stopping;
  child.on('exit', (code) => { if (code === 1 && !stopping) console.error(log); });
  return {
    fixture,
    ...(tls ? { httpsUrl: 'https://secure.cave.test/', httpsFixture, untrustedFixture } : {}),
    socks,
    rotateUntrusted: async () => {
      const next = await certificate(dir, 'untrusted-next', 'bad.cave.test');
      await untrustedFixture.close();
      untrustedFixture = await startFixtureServer({ tls: next });
    },
    blockedHosts,
    dir,
    child,
    log: () => log,
    stop: () => (stopping ??= stopAll()),
  };
  async function stopAll() {
    if (process.platform === 'win32' && child.exitCode === null && child.signalCode === null) {
      // Windows has no POSIX process groups: a negative pid does not terminate the app.
      // Kill only this run's tree, including Electron utility processes and cave-core.
      await execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(async (error) => {
        // Some descendants can exit during taskkill's enumeration. Wait for Node's
        // exit event before deciding whether taskkill actually failed to stop our app.
        let timeout;
        try { await Promise.race([exited, new Promise((_, reject) => { timeout = setTimeout(() => reject(error), 5000); })]); }
        finally { clearTimeout(timeout); }
      });
      await exited;
    }
    const group = (sig) => { try { process.kill(-child.pid, sig); } catch {} };
    if (process.platform !== 'win32') {
      group('SIGTERM');
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
      group('SIGKILL');
    }
    await fixture.close();
    if (httpsFixture) await httpsFixture.close();
    if (untrustedFixture) await untrustedFixture.close();
    await socks.close();
    if (!keepDir) await rm(dir, { recursive: true, force: true });
  }
}

// Keys are generated in the throwaway profile and reused only when a test restarts it.
async function certificate(dir, name, host) {
  const keyPath = join(dir, `${name}-key.pem`);
  const certPath = join(dir, `${name}-cert.pem`);
  try { await readFile(certPath); await readFile(keyPath); } catch {
    await execFile('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256',
      '-days', '2', '-subj', `/CN=${host}`, '-addext', `subjectAltName=DNS:${host}`,
      '-keyout', keyPath, '-out', certPath]);
  }
  const [key, cert] = await Promise.all([readFile(keyPath), readFile(certPath)]);
  const publicKey = new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' });
  return { key, cert, spki: createHash('sha256').update(publicKey).digest('base64') };
}

export async function launch(t, { extra = [], open = false, ...opts } = {}) {
  const w = await startWorld({ ...opts, extra: ['--remote-debugging-port=0', ...extra] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = (expr) => evaluate(port, (u) => u.endsWith('/shell.html'), expr);
  const overlay = (expr) => evaluate(port, (u) => u.endsWith('/overlay.html'), expr);
  const settings = (expr) => evaluate(port, (u) => u.endsWith('/settings.html'), expr);
  if (open) await waitFor(async () => (await gateState(port)) === 'open', 60000);
  return { w, port, shell, overlay, settings };
}
