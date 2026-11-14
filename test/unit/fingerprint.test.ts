import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { applyFingerprint, buildIdentity, chromeBrands, chromiumBrands, emulationCommands, PRESENTED, type PlatformHints } from '../../src/main/fingerprint.ts';
import { evaluateChecks, type CheckFacts } from '../../src/main/checks.ts';
import { initialGate, viewGate } from '../../src/main/gate.ts';
import { setLocale } from '../../src/shared/i18n/index.ts';
import { defaultProfile } from '../../src/shared/profile.ts';

const linux: PlatformHints = { platform: 'Linux', platformVersion: '', architecture: 'x86', bitness: '64', wow64: false };
const mac: PlatformHints = { platform: 'macOS', platformVersion: '14.6.1', architecture: 'arm', bitness: '64', wow64: false };
const profile = { ...defaultProfile('en-US', 'Etc/GMT+8'), acceptLanguages: ['en-US', 'en'] };

test('brands and GREASE follow unbranded Chromium major versions without Google Chrome', () => {
  assert.deepEqual(chromiumBrands(156, '156', false), [
    { brand: 'Not:A-Brand', version: '8' },
    { brand: 'Chromium', version: '156' },
  ]);
  assert.equal(chromiumBrands(156, '156.0.8078.96', true)[0].version, '8.0.0.0');
  assert.deepEqual(chromiumBrands(131, '131', false).map((b) => b.brand), ['Chromium', 'Not_A Brand']);
  assert.equal(chromiumBrands(131, '131', false)[1].version, '24');
});

test('chromeBrands orders GREASE, Chromium and Google Chrome by major % 6', () => {
  assert.deepEqual(chromeBrands(144, '144', false).map((b) => b.brand), ['Not(A:Brand', 'Chromium', 'Google Chrome']);
  assert.deepEqual(chromeBrands(146, '146', false).map((b) => b.brand), ['Chromium', 'Not-A.Brand', 'Google Chrome']);
  const chromeId = buildIdentity(profile, '146.0.7680.178', mac, 'chrome');
  assert.doesNotMatch(chromeId.userAgent, /Electron/);
  assert.ok(chromeId.metadata.brands.some((b) => b.brand === 'Google Chrome'));
  const electronId = buildIdentity(profile, '146.0.7680.178', mac, 'electron', '45.3.0');
  assert.match(electronId.userAgent, /Electron\/45\.3\.0/);
  assert.ok(!electronId.metadata.brands.some((b) => b.brand === 'Google Chrome' || b.brand === 'Electron'));
});

test('identity follows the host by default and never mentions Electron, Google Chrome, or Cave', () => {
  const id = buildIdentity(profile, '156.0.8078.96', mac);
  assert.equal(id.userAgent, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36');
  assert.equal(id.navigatorPlatform, 'MacIntel');
  assert.equal(id.metadata.platformVersion, '14.6.1');
  assert.doesNotMatch(JSON.stringify(id), /Electron|Google Chrome|Cave|Anyu/i);
});

test('a pinned platform makes UA, UA-CH and navigator.platform agree', () => {
  const win = buildIdentity({ ...profile, platform: 'windows' }, '156.0.8078.96', mac);
  assert.match(win.userAgent, /Windows NT 10\.0; Win64; x64/);
  assert.equal(win.navigatorPlatform, 'Win32');
  assert.deepEqual(
    { platform: win.metadata.platform, platformVersion: win.metadata.platformVersion, architecture: win.metadata.architecture },
    { platform: 'Windows', platformVersion: PRESENTED.windows.platformVersion, architecture: 'x86' },
  );
  assert.doesNotMatch(win.userAgent, /Mac|Linux/);
  const m = buildIdentity({ ...profile, platform: 'macos' }, '156.0.8078.96', linux);
  assert.match(m.userAgent, /Macintosh/);
  assert.equal(m.navigatorPlatform, 'MacIntel');
  assert.equal(m.metadata.platform, 'macOS');
});

test('emulation sets timezone, locale and UA; geolocation only when configured', () => {
  const id = buildIdentity(profile, '156.0.8078.96', linux);
  const names = emulationCommands(profile, id).map(([n]) => n);
  assert.deepEqual(names, ['Emulation.setTimezoneOverride', 'Emulation.setLocaleOverride', 'Emulation.setUserAgentOverride']);
  const geo = { latitude: 1, longitude: 2, accuracy: 10 };
  const withGeo = emulationCommands({ ...profile, geolocation: geo }, id);
  assert.deepEqual(withGeo.at(-1), ['Emulation.setGeolocationOverride', geo]);
  const ua = emulationCommands(profile, id)[2][1] as Record<string, unknown>;
  assert.equal(ua.acceptLanguage, 'en-US,en');
  assert.deepEqual(emulationCommands(profile, id)[1][1], { locale: 'en_US' });
});

test('applyFingerprint applies emulation without injecting document-start scripts and supports live updates', async () => {
  const dbg = new EventEmitter() as EventEmitter & { attach: () => void; sendCommand: (m: string, p?: object, sessionId?: string) => Promise<void> };
  const calls: { method: string; params?: Record<string, unknown>; sessionId?: string }[] = [];
  dbg.attach = () => undefined;
  dbg.sendCommand = async (method, params, sessionId) => {
    calls.push({ method, params: params as Record<string, unknown> | undefined, sessionId });
  };
  const id = buildIdentity(profile, '156.0.8078.96', linux);
  const handle = applyFingerprint({ debugger: dbg } as unknown as Electron.WebContents, emulationCommands(profile, id));
  await new Promise((r) => setTimeout(r, 10));
  dbg.emit('message', {}, 'Target.attachedToTarget', { sessionId: 's-iframe', targetInfo: { type: 'iframe' } });
  dbg.emit('message', {}, 'Target.attachedToTarget', { sessionId: 's-worker', targetInfo: { type: 'worker' } });
  await new Promise((r) => setTimeout(r, 10));

  const chromeId = buildIdentity(profile, '156.0.8078.96', linux, 'chrome');
  handle.update(emulationCommands(profile, chromeId));
  await new Promise((r) => setTimeout(r, 10));

  const forSession = (sid?: string) => calls.filter((c) => c.sessionId === sid).map((c) => c.method);
  assert.ok(!calls.some((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument' || c.method === 'Page.enable'));
  assert.ok(forSession(undefined).includes('Emulation.setUserAgentOverride'));
  assert.ok(forSession('s-iframe').includes('Emulation.setUserAgentOverride'));
  assert.ok(forSession('s-worker').includes('Emulation.setUserAgentOverride'));
  assert.ok(forSession('s-worker').includes('Runtime.runIfWaitingForDebugger'));
  assert.equal(calls.filter((c) => c.sessionId === 's-worker' && c.method === 'Emulation.setUserAgentOverride').length, 2);
});

test('evaluateChecks accepts Chromium brands and rejects Google Chrome or Electron brands', () => {
  const id = buildIdentity(profile, '156.0.8078.96', mac);
  const scope = {
    userAgent: id.userAgent,
    platform: id.navigatorPlatform,
    languages: profile.acceptLanguages,
    timezone: profile.timezone,
    locale: profile.locale,
    ua: { brands: id.metadata.brands, platform: id.metadata.platform, high: {} },
  };
  const base: CheckFacts = {
    profile,
    identity: id,
    gate: viewGate(initialGate('QM')),
    coreUp: true,
    expectedProxy: 'SOCKS5 127.0.0.1:1080',
    proxyFor: { remote: 'SOCKS5 127.0.0.1:1080', loopback: 'SOCKS5 127.0.0.1:1080' },
    switches: { hostResolverRules: 'MAP * ~NOTFOUND', quic: true, ipv6: true },
    localDnsRefused: true,
    runtimeYaml: 'ipv6: false\nMATCH,REJECT',
    probe: { main: scope, worker: scope, webrtc: [], webrtcPolicy: 'disable_non_proxied_udp' },
    hostPlatform: 'macOS',
  };
  try {
    setLocale('en');
    const passItems = evaluateChecks(base);
    assert.equal(passItems.length, 13);
    assert.equal(passItems[11].pass, true);
    const withGoogle = evaluateChecks({
      ...base,
      probe: {
        ...base.probe!,
        main: { ...scope, ua: { ...scope.ua, brands: [...scope.ua.brands, { brand: 'Google Chrome', version: '156' }] } },
      },
    });
    assert.equal(withGoogle[11].pass, false);
    const withElectron = evaluateChecks({
      ...base,
      probe: {
        ...base.probe!,
        main: { ...scope, ua: { ...scope.ua, brands: [...scope.ua.brands, { brand: 'Electron', version: '45' }] } },
      },
    });
    assert.equal(withElectron[11].pass, false);
  } finally {
    setLocale('zh');
  }
});
