// What pages see: Google Chrome of exactly the engine's version, on the presented platform.
// Everything goes through engine interfaces (CDP Emulation, session UA, command line); no page
// script is injected, so there is no JavaScript shim to detect. Only this module uses the debugger.
import type { WebContents } from 'electron';
import type { Profile } from '../shared/profile.ts';

export interface Brand { brand: string; version: string }

/** CDP Emulation.UserAgentMetadata */
export interface UAMetadata {
  brands: Brand[];
  fullVersionList: Brand[];
  platform: string;
  platformVersion: string;
  architecture: string;
  model: string;
  mobile: boolean;
  bitness: string;
  wow64: boolean;
  formFactors: string[];
}

export interface Identity {
  userAgent: string;
  /** navigator.platform */
  navigatorPlatform: string;
  /** CDP acceptLanguage: a plain list; Chromium adds the q-values itself */
  acceptLanguages: string;
  /** Emulation.setLocaleOverride wants ICU form (en_US) */
  icuLocale: string;
  metadata: UAMetadata;
}

/** The engine's own platform hints, read once from a page without overrides. */
export interface PlatformHints {
  platform: string;
  platformVersion: string;
  architecture: string;
  bitness: string;
  wow64: boolean;
}

const UA_OS: Record<string, string> = {
  macOS: 'Macintosh; Intel Mac OS X 10_15_7',
  Windows: 'Windows NT 10.0; Win64; x64',
  Linux: 'X11; Linux x86_64',
};
const NAV_PLATFORM: Record<string, string> = { macOS: 'MacIntel', Windows: 'Win32', Linux: 'Linux x86_64' };

/** Common, current values used when the profile presents a platform other than the host's. */
export const PRESENTED: Record<'macos' | 'windows', PlatformHints> = {
  macos: { platform: 'macOS', platformVersion: '15.7.1', architecture: 'arm', bitness: '64', wow64: false },
  windows: { platform: 'Windows', platformVersion: '19.0.0', architecture: 'x86', bitness: '64', wow64: false },
};

/**
 * Chromium's brand list (components/embedder_support/user_agent_utils.cc, GenerateBrandVersionList)
 * with the "Google Chrome" brand a Chrome build adds. GREASE and order are seeded by the major
 * version exactly as in Chrome, so the list equals that of the same Chrome release.
 */
export function chromeBrands(major: number, version: string, full: boolean): Brand[] {
  const chars = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'];
  const greaseVersion = ['8', '99', '24'][major % 3];
  const grease = {
    brand: `Not${chars[major % chars.length]}A${chars[(major + 1) % chars.length]}Brand`,
    version: full ? `${greaseVersion}.0.0.0` : greaseVersion,
  };
  const list = [grease, { brand: 'Chromium', version }, { brand: 'Google Chrome', version }];
  const order = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]][major % 6];
  const out: Brand[] = [];
  order.forEach((slot, i) => (out[slot] = list[i]));
  return out;
}

export function buildIdentity(profile: Profile, chromeVersion: string, host: PlatformHints): Identity {
  const hints = profile.platform === 'host' ? host : PRESENTED[profile.platform];
  const major = Number(chromeVersion.split('.')[0]);
  return {
    userAgent: `Mozilla/5.0 (${UA_OS[hints.platform] ?? UA_OS.Linux}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
    navigatorPlatform: NAV_PLATFORM[hints.platform] ?? NAV_PLATFORM.Linux,
    acceptLanguages: profile.acceptLanguages.join(','),
    icuLocale: profile.locale.replace(/-/g, '_'),
    metadata: {
      brands: chromeBrands(major, String(major), false),
      fullVersionList: chromeBrands(major, chromeVersion, true),
      platform: hints.platform,
      platformVersion: hints.platformVersion,
      architecture: hints.architecture,
      model: '',
      mobile: false,
      bitness: hints.bitness,
      wow64: hints.wow64,
      formFactors: ['Desktop'],
    },
  };
}

/** The Emulation commands every target receives, in order. */
export function emulationCommands(profile: Profile, id: Identity): [string, object][] {
  return [
    ['Emulation.setTimezoneOverride', { timezoneId: profile.timezone }],
    ['Emulation.setLocaleOverride', { locale: id.icuLocale }],
    [
      'Emulation.setUserAgentOverride',
      { userAgent: id.userAgent, acceptLanguage: id.acceptLanguages, platform: id.navigatorPlatform, userAgentMetadata: id.metadata },
    ],
    ...(profile.geolocation ? [['Emulation.setGeolocationOverride', profile.geolocation] as [string, object]] : []),
  ];
}

/**
 * Attaches to a tab and keeps every target it spawns (frames, dedicated and service workers)
 * paused at start until it has received the same overrides. Shared workers are not auto-attached
 * by Chromium; they are configured as soon as they appear and otherwise inherit the session UA.
 */
export function applyFingerprint(wc: WebContents, commands: [string, object][]): void {
  const dbg = wc.debugger;
  dbg.attach('1.3');
  // A command a target type does not implement may never answer; never let that keep a worker paused.
  const send = (m: string, p: object, sessionId?: string) =>
    Promise.race([dbg.sendCommand(m, p, sessionId).catch(() => undefined), new Promise((r) => setTimeout(r, 1000))]);
  const configure = (sessionId?: string) =>
    Promise.all([
      ...commands.map(([m, p]) => send(m, p, sessionId)),
      send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId),
    ]);
  dbg.on('message', (_e, method, params: any) => {
    if (method === 'Target.attachedToTarget') {
      const id = params.sessionId as string;
      void configure(id).finally(() => dbg.sendCommand('Runtime.runIfWaitingForDebugger', {}, id).catch(() => undefined));
    } else if (method === 'Target.targetCreated' && params.targetInfo.type === 'shared_worker' && !params.targetInfo.attached) {
      void dbg.sendCommand('Target.attachToTarget', { targetId: params.targetInfo.targetId, flatten: true }).catch(() => undefined);
    }
  });
  // Page-level commands are queued by Chromium until the renderer exists; nothing is awaited here
  // because the first navigation is issued after this call, on the same ordered channel.
  void configure();
  void dbg.sendCommand('Target.setDiscoverTargets', { discover: true, filter: [{ type: 'shared_worker' }] }).catch(() => undefined);
}
