// What pages see: Google Chrome of exactly the engine's version, on the presented platform.
// Identity overrides go through engine interfaces (CDP Emulation, session UA, command line);
// Chromium has no switch that keeps speechSynthesis present with an empty voice list, so frame
// targets also receive a minimal document-start shim for speechSynthesis. Only this module uses the debugger.
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

const SPEECH_SHIM = `(() => {
  if (typeof SpeechSynthesis !== 'function') return;
  const proto = SpeechSynthesis.prototype;
  const getDesc = Object.getOwnPropertyDescriptor(proto, 'getVoices');
  const pausedDesc = Object.getOwnPropertyDescriptor(proto, 'paused');
  if (!getDesc || typeof getDesc.value !== 'function' || !pausedDesc || typeof pausedDesc.get !== 'function') return;
  const apply = Reflect.apply;
  const wmGet = WeakMap.prototype.get;
  const wmSet = WeakMap.prototype.set;
  const names = new WeakMap();
  const toStrDesc = Object.getOwnPropertyDescriptor(Function.prototype, 'toString');
  if (toStrDesc && typeof toStrDesc.value === 'function') {
    const origToStr = toStrDesc.value;
    const wrappedToStr = new Proxy(origToStr, {
      apply(target, thisArg, args) {
        const name = wmGet.call(names, thisArg);
        if (name !== undefined) return 'function ' + name + '() { [native code] }';
        return apply(target, thisArg, args);
      },
    });
    wmSet.call(names, wrappedToStr, 'toString');
    Object.defineProperty(Function.prototype, 'toString', { ...toStrDesc, value: wrappedToStr });
  }
  const wrap = (orig, name, fn) => {
    const p = new Proxy(orig, { apply: fn });
    wmSet.call(names, p, name);
    return p;
  };
  const pausedGet = pausedDesc.get;
  const origGetVoices = getDesc.value;
  Object.defineProperty(proto, 'getVoices', {
    ...getDesc,
    value: wrap(origGetVoices, origGetVoices.name, (_target, thisArg) => {
      apply(pausedGet, thisArg, []);
      return [];
    }),
  });
  const onDesc = Object.getOwnPropertyDescriptor(proto, 'onvoiceschanged');
  if (onDesc && typeof onDesc.get === 'function' && typeof onDesc.set === 'function') {
    const handlers = new WeakMap();
    const origGet = onDesc.get;
    const origSet = onDesc.set;
    Object.defineProperty(proto, 'onvoiceschanged', {
      ...onDesc,
      get: wrap(origGet, origGet.name, (_target, thisArg) => {
        apply(pausedGet, thisArg, []);
        return wmGet.call(handlers, thisArg) ?? null;
      }),
      set: wrap(origSet, origSet.name, (_target, thisArg, args) => {
        apply(pausedGet, thisArg, []);
        wmSet.call(handlers, thisArg, typeof args[0] === 'function' ? args[0] : null);
      }),
    });
  }
  const etProto = typeof EventTarget === 'function' ? EventTarget.prototype : null;
  const addDesc = etProto && Object.getOwnPropertyDescriptor(etProto, 'addEventListener');
  if (addDesc && typeof addDesc.value === 'function') {
    const origAdd = addDesc.value;
    Object.defineProperty(etProto, 'addEventListener', {
      ...addDesc,
      value: wrap(origAdd, origAdd.name, (target, thisArg, args) => {
        if (args.length > 0 && (args[0] === 'voiceschanged' || (thisArg instanceof SpeechSynthesis && typeof args[0] !== 'symbol' && String(args[0]) === 'voiceschanged'))) {
          try {
            apply(pausedGet, thisArg, []);
            return;
          } catch {}
        }
        return apply(target, thisArg, args);
      }),
    });
  }
})();`;

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
  const configure = (sessionId?: string, targetType?: string) => {
    const isFrame = !targetType || targetType === 'page' || targetType === 'iframe';
    return Promise.all([
      ...commands.map(([m, p]) => send(m, p, sessionId)),
      ...(isFrame
        ? [
            send('Page.enable', {}, sessionId),
            send('Page.addScriptToEvaluateOnNewDocument', { source: SPEECH_SHIM }, sessionId),
          ]
        : []),
      send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId),
    ]);
  };
  dbg.on('message', (_e, method, params: any) => {
    if (method === 'Target.attachedToTarget') {
      const id = params.sessionId as string;
      void configure(id, params.targetInfo?.type).finally(() =>
        dbg.sendCommand('Runtime.runIfWaitingForDebugger', {}, id).catch(() => undefined),
      );
    } else if (method === 'Target.targetCreated' && params.targetInfo.type === 'shared_worker' && !params.targetInfo.attached) {
      void dbg.sendCommand('Target.attachToTarget', { targetId: params.targetInfo.targetId, flatten: true }).catch(() => undefined);
    }
  });
  // Page-level commands are queued by Chromium until the renderer exists; nothing is awaited here
  // because the first navigation is issued after this call, on the same ordered channel.
  void configure();
  void dbg.sendCommand('Target.setDiscoverTargets', { discover: true, filter: [{ type: 'shared_worker' }] }).catch(() => undefined);
}
