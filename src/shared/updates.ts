export const GITHUB_REPO_URL = 'https://github.com/5nix/anyu-browser';
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`;
export const GITHUB_RELEASES_API = 'https://api.github.com/repos/5nix/anyu-browser/releases?per_page=10';
export const MIHOMO_VERSION = 'v1.19.34';

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  pre: string[];
}

export interface UpdateRelease {
  version: string;
  tag: string;
  url: string;
  prerelease: boolean;
  publishedAt: string | null;
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/i;
const DIGITS_RE = /^\d+$/;

export function parseVersion(raw: string): ParsedVersion | null {
  if (typeof raw !== 'string') return null;
  const match = SEMVER_RE.exec(raw.trim());
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) return null;
  const pre = match[4] ? match[4].split('.') : [];
  if (pre.some((part) => !part || (DIGITS_RE.test(part) && part.length > 1 && part.startsWith('0')))) return null;
  return { major, minor, patch, pre };
}

export function normalizeVersion(raw: string): string | null {
  const parsed = parseVersion(raw);
  if (!parsed) return null;
  const base = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  return parsed.pre.length ? `${base}-${parsed.pre.join('.')}` : base;
}

function comparePreIdentifier(a: string, b: string): number {
  const aNum = DIGITS_RE.test(a);
  const bNum = DIGITS_RE.test(b);
  if (aNum && bNum) {
    const diff = Number(a) - Number(b);
    return diff === 0 ? 0 : diff > 0 ? 1 : -1;
  }
  if (aNum !== bNum) return aNum ? -1 : 1;
  return a === b ? 0 : a > b ? 1 : -1;
}

export function compareParsedVersions(a: ParsedVersion, b: ParsedVersion): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (!a.pre.length && !b.pre.length) return 0;
  if (!a.pre.length) return 1;
  if (!b.pre.length) return -1;
  const len = Math.max(a.pre.length, b.pre.length);
  for (let i = 0; i < len; i++) {
    const left = a.pre[i];
    const right = b.pre[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const cmp = comparePreIdentifier(left, right);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

export function compareVersions(a: string, b: string): number {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);
  if (!parsedA || !parsedB) throw new Error(`Invalid version comparison: ${a} vs ${b}`);
  return compareParsedVersions(parsedA, parsedB);
}

export function isAllowedGithubReleaseUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || !raw || raw.length > 2048 || !URL.canParse(raw)) return false;
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') return false;
  return url.pathname === '/5nix/anyu-browser' || url.pathname.startsWith('/5nix/anyu-browser/');
}

export function pickLatestRelease(releases: unknown, currentVersion: string): UpdateRelease | null {
  const current = parseVersion(currentVersion);
  if (!current || !Array.isArray(releases)) return null;
  let best: { parsed: ParsedVersion; release: UpdateRelease } | null = null;
  for (const item of releases) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (record.draft === true) continue;
    if (typeof record.tag_name !== 'string') continue;
    const parsed = parseVersion(record.tag_name);
    const version = normalizeVersion(record.tag_name);
    if (!parsed || !version) continue;
    if (!isAllowedGithubReleaseUrl(record.html_url)) continue;
    if (compareParsedVersions(parsed, current) <= 0) continue;
    const candidate: UpdateRelease = {
      version,
      tag: record.tag_name.trim(),
      url: record.html_url,
      prerelease: Boolean(record.prerelease) || parsed.pre.length > 0,
      publishedAt: typeof record.published_at === 'string' ? record.published_at : null,
    };
    if (!best || compareParsedVersions(parsed, best.parsed) > 0) {
      best = { parsed, release: candidate };
    }
  }
  return best?.release ?? null;
}
