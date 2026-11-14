/**
 * Basic ad/popunder/redirect blocking rules and popup/navigation gesture gates.
 * Pure logic shared between the main-process webRequest/tab guards and unit tests.
 */

export const GESTURE_WINDOW_MS = 5000;

/** Known ad, popunder, and redirect-script domains blocked when loaded third-party or navigated to unexpectedly. */
export const BLOCKED_AD_DOMAINS: ReadonlySet<string> = new Set([
  // Popunder / redirect ad networks (including Adsterra & peers)
  'effectivecpmnetwork.com',
  'effectivegatecpm.com',
  'highrevenueformat.com',
  'topcreativeformat.com',
  'profitablegatecpm.com',
  'profitabledisplaynetwork.com',
  'adsterra.com',
  'adsterratech.com',
  'popads.net',
  'popcash.net',
  'propellerads.com',
  'propellerclick.com',
  'monetag.com',
  'onclickalgo.com',
  'onclickperformance.com',
  'onclickmax.com',
  'acscdn.com',
  'al5sm.com',
  'hilltopads.net',
  'exoclick.com',
  'exosrv.com',
  'realsrv.com',
  'juicyads.com',
  'trafficjunky.net',
  'admaven.com',
  'ad-maven.com',
  'richpush.co',
  'richads.com',
  'galaksion.com',
  'evadav.com',
  'clickadu.com',
  'trafficstars.com',
  'tsyndicate.com',
  'adtng.com',
  'a-ads.com',
  'coinzilla.com',
  'bitmedia.io',
  // Common third-party ad networks
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.com',
  'adsafeprotected.com',
  'moatads.com',
  'adnxs.com',
  'rubiconproject.com',
  'pubmatic.com',
  'openx.net',
  'casalemedia.com',
  'criteo.com',
  'criteo.net',
  'taboola.com',
  'outbrain.com',
  'mgid.com',
  'revcontent.com',
  'bidswitch.net',
  'smartadserver.com',
  'indexww.com',
  '3lift.com',
  'sharethrough.com',
  'amazon-adsystem.com',
  'ads-twitter.com',
  'advertising.com',
  'adform.net',
  'mediavine.com',
  'adthrive.com',
  'raptive.com',
  'ezoic.net',
  'ezodn.com',
  'mediaplex.com',
  '2mdn.net',
  'serving-sys.com',
  'quantserve.com',
  'scorecardresearch.com',
  'adsrvr.org',
  'rlcdn.com',
  'demdex.net',
  'krxd.net',
  'bluekai.com',
  'bat.bing.com',
]);

export function matchedBlockedDomain(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  if (!host) return null;
  let candidate = host;
  while (candidate) {
    if (BLOCKED_AD_DOMAINS.has(candidate)) return candidate;
    const dot = candidate.indexOf('.');
    if (dot < 0) break;
    candidate = candidate.slice(dot + 1);
  }
  return null;
}

export function shouldBlockSubresource(url: string, resourceType: string, initiatorOrigin?: string): boolean {
  if (resourceType === 'mainFrame') return false;
  const matched = matchedBlockedDomain(url);
  if (!matched) return false;
  if (initiatorOrigin && matchedBlockedDomain(initiatorOrigin) === matched) return false;
  return true;
}

export function shouldBlockPopupTarget(url: string, currentUrl: string): boolean {
  const matched = matchedBlockedDomain(url);
  if (!matched) return false;
  return matchedBlockedDomain(currentUrl) !== matched;
}

const originOf = (url: string): string => (URL.canParse(url) ? new URL(url).origin : '');

export function shouldBlockMainFrameNavigation(opts: {
  url: string;
  currentUrl: string;
  isChildFrame: boolean;
  hasGesture: boolean;
}): boolean {
  const matched = matchedBlockedDomain(opts.url);
  if (matched && matchedBlockedDomain(opts.currentUrl) !== matched) return true;
  if (opts.isChildFrame && !opts.hasGesture) {
    const nextOrigin = originOf(opts.url);
    const curOrigin = originOf(opts.currentUrl);
    if (nextOrigin && curOrigin && nextOrigin !== curOrigin) return true;
  }
  return false;
}

/** Tracks transient user activation for popup/navigation gating; one popup consumes one gesture. */
export class GestureGate {
  private lastAt = 0;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(windowMs = GESTURE_WINDOW_MS, now: () => number = () => Date.now()) {
    this.windowMs = windowMs;
    this.now = now;
  }

  mark(at = this.now()): void {
    this.lastAt = at;
  }

  reset(): void {
    this.lastAt = 0;
  }

  hasRecent(at = this.now()): boolean {
    if (this.lastAt <= 0) return false;
    const elapsed = at - this.lastAt;
    return elapsed >= 0 && elapsed <= this.windowMs;
  }

  consumePopup(at = this.now()): boolean {
    if (!this.hasRecent(at)) return false;
    this.lastAt = 0;
    return true;
  }
}
