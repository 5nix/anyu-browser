import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { applyFingerprint, buildIdentity, chromeBrands, emulationCommands, PRESENTED, type PlatformHints } from '../../src/main/fingerprint.ts';
import { evaluateChecks, type CheckFacts } from '../../src/main/checks.ts';
import { initialGate, viewGate } from '../../src/main/gate.ts';
import { setLocale } from '../../src/shared/i18n/index.ts';
import { defaultProfile } from '../../src/shared/profile.ts';

const linux: PlatformHints = { platform: 'Linux', platformVersion: '', architecture: 'x86', bitness: '64', wow64: false };
const mac: PlatformHints = { platform: 'macOS', platformVersion: '14.6.1', architecture: 'arm', bitness: '64', wow64: false };
const profile = { ...defaultProfile('en-US', 'Etc/GMT+8'), acceptLanguages: ['en-US', 'en'] };

test('brands and GREASE follow Chrome major versions', () => {
  assert.deepEqual(chromeBrands(156, '156', false), [
    { brand: 'Not:A-Brand', version: '8' },
    { brand: 'Chromium', version: '156' },
    { brand: 'Google Chrome', version: '156' },
  ]);
  assert.equal(chromeBrands(156, '156.0.8078.96', true)[0].version, '8.0.0.0');
  assert.deepEqual(chromeBrands(131, '131', false).map((b) => b.brand), ['Google Chrome', 'Chromium', 'Not_A Brand']);
  assert.equal(chromeBrands(131, '131', false)[2].version, '24');
});

test('identity follows the host by default and never mentions Electron or Cave', () => {
  const id = buildIdentity(profile, '156.0.8078.96', mac);
  assert.equal(id.userAgent, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36');
  assert.equal(id.navigatorPlatform, 'MacIntel');
  assert.equal(id.metadata.platformVersion, '14.6.1');
  assert.doesNotMatch(JSON.stringify(id), /Electron|Cave|Anyu/i);
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

test('applyFingerprint injects document-start speech shim on top and iframe targets only', async () => {
  const dbg = new EventEmitter() as EventEmitter & { attach: () => void; sendCommand: (m: string, p?: object, sessionId?: string) => Promise<void> };
  const calls: { method: string; sessionId?: string }[] = [];
  dbg.attach = () => undefined;
  dbg.sendCommand = async (method, _params, sessionId) => {
    calls.push({ method, sessionId });
  };
  const id = buildIdentity(profile, '156.0.8078.96', linux);
  applyFingerprint({ debugger: dbg } as unknown as Electron.WebContents, emulationCommands(profile, id));
  await new Promise((r) => setTimeout(r, 10));
  dbg.emit('message', {}, 'Target.attachedToTarget', { sessionId: 's-iframe', targetInfo: { type: 'iframe' } });
  dbg.emit('message', {}, 'Target.attachedToTarget', { sessionId: 's-worker', targetInfo: { type: 'worker' } });
  await new Promise((r) => setTimeout(r, 10));

  const forSession = (sid?: string) => calls.filter((c) => c.sessionId === sid).map((c) => c.method);
  assert.ok(forSession(undefined).includes('Page.addScriptToEvaluateOnNewDocument'));
  assert.ok(forSession('s-iframe').includes('Page.addScriptToEvaluateOnNewDocument'));
  assert.ok(!forSession('s-worker').includes('Page.addScriptToEvaluateOnNewDocument'));
  assert.ok(forSession('s-worker').includes('Runtime.runIfWaitingForDebugger'));
});

test('evaluateChecks fails the speech voice check when non-zero or unavailable', () => {
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
    probe: { main: scope, worker: scope, webrtc: [], webrtcPolicy: 'disable_non_proxied_udp', speechVoices: 0 },
    hostPlatform: 'macOS',
  };
  try {
    setLocale('en');
    const passItems = evaluateChecks(base);
    assert.equal(passItems.length, 14);
    assert.equal(passItems[13].pass, true);
    assert.equal(evaluateChecks({ ...base, probe: { ...base.probe!, speechVoices: 3 } })[13].pass, false);
    assert.equal(evaluateChecks({ ...base, probe: { ...base.probe!, speechVoices: null } })[13].pass, false);
    assert.equal(evaluateChecks({ ...base, probe: null })[13].pass, false);
  } finally {
    setLocale('zh');
  }
});
