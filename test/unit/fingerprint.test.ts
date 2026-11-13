import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIdentity, chromeBrands, emulationCommands, PRESENTED, type PlatformHints } from '../../src/main/fingerprint.ts';
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
