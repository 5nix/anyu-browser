import type { Session, WebContents } from 'electron';
import { builtinUa, effectiveUa, normalizeSiteOrigin, type UaMode } from '../shared/ua.ts';
import { applyFingerprint, formatBrandsHeader, type FingerprintHandle, type Identity } from './fingerprint.ts';

function replaceHeader(headers: Record<string, string>, target: string, value: string, onlyIfPresent: boolean): void {
  const lower = target.toLowerCase();
  let foundKey: string | null = null;
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      if (foundKey === null) foundKey = key;
      delete headers[key];
    }
  }
  if (!onlyIfPresent || foundKey !== null) {
    headers[foundKey ?? target] = value;
  }
}

export function applyUaHeaders(headers: Record<string, string>, id: Identity): Record<string, string> {
  const next = { ...headers };
  replaceHeader(next, 'User-Agent', id.userAgent, false);
  replaceHeader(next, 'Sec-CH-UA', formatBrandsHeader(id.metadata.brands), true);
  replaceHeader(next, 'Sec-CH-UA-Full-Version-List', formatBrandsHeader(id.metadata.fullVersionList), true);
  return next;
}

export function resolveRequestUaMode(
  details: { url: string; resourceType: string; webContentsId?: number },
  overrideOf: (origin: string) => UaMode | null,
  tabModeOf: (wcId: number) => UaMode | undefined,
): UaMode {
  const origin = normalizeSiteOrigin(details.url);
  if (details.resourceType === 'mainFrame') {
    return origin ? effectiveUa(origin, overrideOf(origin)) : 'chromium';
  }
  if (origin && (overrideOf(origin) !== null || builtinUa(origin) !== null)) {
    return effectiveUa(origin, overrideOf(origin));
  }
  if (details.webContentsId !== undefined) {
    return tabModeOf(details.webContentsId) ?? 'chromium';
  }
  return 'chromium';
}

export interface SiteUaController {
  prepareTab(wc: WebContents): void;
  applySession(ses: Session): void;
}

export function createSiteUaController(options: {
  identities: Record<UaMode, Identity>;
  commandsFor: (mode: UaMode) => [string, object][];
  overrideOf: (origin: string) => UaMode | null;
}): SiteUaController {
  const { identities, commandsFor, overrideOf } = options;
  const tabModes = new Map<number, UaMode>();
  const tabs = new Map<number, { mode: UaMode; handle: FingerprintHandle }>();

  const syncMode = (wcId: number, mode: UaMode) => {
    tabModes.set(wcId, mode);
    const entry = tabs.get(wcId);
    if (entry && entry.mode !== mode) {
      entry.mode = mode;
      entry.handle.update(commandsFor(mode));
    }
  };

  const syncUrl = (wcId: number, url: string) => {
    const origin = normalizeSiteOrigin(url);
    syncMode(wcId, origin ? effectiveUa(origin, overrideOf(origin)) : 'chromium');
  };

  return {
    prepareTab(wc) {
      const wcId = wc.id;
      const initialOrigin = normalizeSiteOrigin(wc.getURL());
      const initialMode = initialOrigin ? effectiveUa(initialOrigin, overrideOf(initialOrigin)) : 'chromium';
      const handle = applyFingerprint(wc, commandsFor(initialMode));
      tabModes.set(wcId, initialMode);
      tabs.set(wcId, { mode: initialMode, handle });
      wc.on('did-start-navigation', (e) => {
        if (!e.isMainFrame || e.isSameDocument || e.url.startsWith('chrome-error:')) return;
        syncUrl(wcId, e.url);
      });
      wc.on('did-redirect-navigation', (e) => {
        if (!e.isMainFrame || e.isSameDocument) return;
        syncUrl(wcId, e.url);
      });
      wc.once('destroyed', () => {
        tabModes.delete(wcId);
        tabs.delete(wcId);
      });
    },
    applySession(ses) {
      ses.webRequest.onBeforeSendHeaders((details, callback) => {
        const mode = resolveRequestUaMode(details, overrideOf, (id) => tabModes.get(id));
        if (details.resourceType === 'mainFrame' && details.webContentsId !== undefined) {
          syncMode(details.webContentsId, mode);
        }
        callback({ requestHeaders: applyUaHeaders(details.requestHeaders, identities[mode]) });
      });
    },
  };
}
