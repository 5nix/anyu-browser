import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builtinUa, defaultUa, effectiveUa, isUaMode, isUaPreference, normalizeSiteOrigin } from '../../src/shared/ua.ts';
import { buildIdentity, type PlatformHints } from '../../src/main/fingerprint.ts';
import { applyUaHeaders, resolveRequestUaMode } from '../../src/main/site-ua.ts';
import { defaultProfile } from '../../src/shared/profile.ts';

const mac: PlatformHints = { platform: 'macOS', platformVersion: '15.7.1', architecture: 'arm', bitness: '64', wow64: false };
const profile = { ...defaultProfile('en-US', 'Etc/GMT+8'), acceptLanguages: ['en-US', 'en'] };

test('built-in defaults cover Google and YouTube sign-in origins while defaulting others to Chromium', () => {
  assert.equal(builtinUa('https://accounts.google.com'), 'electron');
  assert.equal(builtinUa('https://accounts.youtube.com'), 'electron');
  assert.equal(builtinUa('https://www.youtube.com'), null);
  assert.equal(defaultUa('https://accounts.google.com'), 'electron');
  assert.equal(defaultUa('https://accounts.youtube.com'), 'electron');
  assert.equal(defaultUa('https://example.com'), 'chromium');
  assert.equal(effectiveUa('https://accounts.google.com', null), 'electron');
  assert.equal(effectiveUa('https://accounts.google.com', 'chromium'), 'chromium');
  assert.equal(effectiveUa('https://example.com', 'chrome'), 'chrome');
  assert.equal(isUaMode('chrome'), true);
  assert.equal(isUaMode('custom'), false);
  assert.equal(isUaPreference('default'), true);
});

test('normalizeSiteOrigin only accepts http and https origins', () => {
  assert.equal(normalizeSiteOrigin('https://accounts.google.com/v3/signin?foo=1'), 'https://accounts.google.com');
  assert.equal(normalizeSiteOrigin('http://localhost:8080/test'), 'http://localhost:8080');
  assert.equal(normalizeSiteOrigin('chrome://settings'), null);
  assert.equal(normalizeSiteOrigin('about:blank'), null);
  assert.equal(normalizeSiteOrigin('not-a-url'), null);
});

test('applyUaHeaders switches User-Agent and present Sec-CH-UA headers coherently', () => {
  const chromeId = buildIdentity(profile, '146.0.7680.178', mac, 'chrome');
  const electronId = buildIdentity(profile, '146.0.7680.178', mac, 'electron', '45.3.0');
  const chromiumId = buildIdentity(profile, '146.0.7680.178', mac, 'chromium');

  const chromeHeaders = applyUaHeaders(
    { 'user-agent': 'old', 'sec-ch-ua': '"Old";v="1"', Accept: '*/*' },
    chromeId,
  );
  assert.equal(chromeHeaders['user-agent'], chromeId.userAgent);
  assert.match(chromeHeaders['sec-ch-ua'], /"Google Chrome";v="146"/);
  assert.equal(chromeHeaders['Sec-CH-UA-Full-Version-List'], undefined);
  assert.equal(chromeHeaders.Accept, '*/*');

  const electronHeaders = applyUaHeaders(
    { 'User-Agent': chromeId.userAgent, 'Sec-CH-UA': chromeHeaders['sec-ch-ua'], 'Sec-CH-UA-Full-Version-List': '"Old";v="1.0"' },
    electronId,
  );
  assert.match(electronHeaders['User-Agent'], /Electron\/45\.3\.0/);
  assert.doesNotMatch(electronHeaders['Sec-CH-UA'], /Google Chrome|Electron/);
  assert.doesNotMatch(electronHeaders['Sec-CH-UA-Full-Version-List'], /Google Chrome|Electron/);

  const backToChromium = applyUaHeaders({ 'User-Agent': electronHeaders['User-Agent'] }, chromiumId);
  assert.doesNotMatch(backToChromium['User-Agent'], /Electron/);
});

test('resolveRequestUaMode respects main-frame origin, explicit subresource overrides, and tab inheritance', () => {
  const overrides = new Map<string, 'chromium' | 'chrome' | 'electron'>([
    ['https://app.example', 'chrome'],
  ]);
  const tabModes = new Map<number, 'chromium' | 'chrome' | 'electron'>([[1, 'chrome'], [2, 'chromium']]);
  const overrideOf = (origin: string) => overrides.get(origin) ?? null;
  const tabModeOf = (id: number) => tabModes.get(id);

  assert.equal(resolveRequestUaMode({ url: 'https://accounts.google.com/signin', resourceType: 'mainFrame', webContentsId: 2 }, overrideOf, tabModeOf), 'electron');
  assert.equal(resolveRequestUaMode({ url: 'https://accounts.youtube.com/accounts/SetSID', resourceType: 'mainFrame', webContentsId: 2 }, overrideOf, tabModeOf), 'electron');
  assert.equal(resolveRequestUaMode({ url: 'https://cdn.example/app.js', resourceType: 'script', webContentsId: 1 }, overrideOf, tabModeOf), 'chrome');
  assert.equal(resolveRequestUaMode({ url: 'https://accounts.google.com/gsi/client', resourceType: 'subFrame', webContentsId: 2 }, overrideOf, tabModeOf), 'electron');
  assert.equal(resolveRequestUaMode({ url: 'https://cdn.example/app.js', resourceType: 'script', webContentsId: 2 }, overrideOf, tabModeOf), 'chromium');
});
