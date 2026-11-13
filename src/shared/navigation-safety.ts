/** Record same-document path/query changes, but not fragment-only changes. */
export function recordInPageVisit(previous: string, next: string): boolean {
  if (!URL.canParse(previous) || !URL.canParse(next)) return false;
  const a = new URL(previous), b = new URL(next);
  if (!/^https?:$/.test(b.protocol)) return false;
  a.hash = ''; b.hash = '';
  return a.href !== b.href;
}

export function allowedSiteOrigin(value: unknown, sites: string[]): string | null {
  const origin = (url: unknown): string | null => {
    if (typeof url !== 'string' || !URL.canParse(url)) return null;
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed.origin : null;
  };
  const target = origin(value);
  return target && sites.some(site => origin(site) === target) ? target : null;
}

/** Electron's failure event has no navigation ID, so a failure counts only for the URL being loaded now. */
export class NavigationFailures {
  private current = '';
  start(url: string): void { this.current = url; }
  redirect(url: string): void { this.current = url; }
  accepts(url: string): boolean { return url === this.current; }
}

/** Chromium's built-in PDF viewer extension origin; only its own child stream frame may navigate inside it. */
export const PDF_VIEWER_ORIGIN = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai';
const PDF_VIEWER_PREFIX = `${PDF_VIEWER_ORIGIN}/`;

export function isAllowedPdfViewerFrame(
  url: string,
  isMainFrame: boolean,
  initiatorOrigin?: string,
  parentOrigin?: string,
): boolean {
  return !isMainFrame
    && url.startsWith(PDF_VIEWER_PREFIX)
    && initiatorOrigin === PDF_VIEWER_ORIGIN
    && parentOrigin === PDF_VIEWER_ORIGIN;
}

