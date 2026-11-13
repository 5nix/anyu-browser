import { t, type TranslationKey } from './i18n/index.ts';
// The portable profile (profile.json): every value a page can observe that the user chooses,
// plus where traffic must exit. No field ever holds the machine's real location.

export type PresentedPlatform = 'host' | 'macos' | 'windows';

export interface Geolocation { latitude: number; longitude: number; accuracy: number }

export interface Profile {
  version: 1;
  /** BCP 47, e.g. en */
  locale: string;
  acceptLanguages: string[];
  /** IANA, e.g. UTC */
  timezone: string;
  geolocation: Geolocation | null;
  /** ISO 3166-1 alpha-2; empty keeps the gate closed */
  egressCountry: string;
  /** Which desktop OS pages are told this is. "host" follows the machine. */
  platform: PresentedPlatform;
  allowPrivateNetwork: boolean;
  /** Windows opt-in: core upstream sockets use an uplink instead of the host TUN. */
  bypassHostTun: boolean;
  notifications: boolean;
  /** subscriptionVia: "direct" fetches the subscription URL once over the system network; "proxy" through the selected node */
  proxy: ProxySources;
}

export type SubscriptionVia = 'direct' | 'proxy';

/** A source owns its node definitions, so equal node names in different sources remain distinct. */
export type ProxySourceOrigin =
  | { kind: 'subscription'; url: string; via: SubscriptionVia }
  | { kind: 'file'; filename: string }
  | { kind: 'text' };
export interface ProxySource {
  id: string;
  name: string;
  origin: ProxySourceOrigin;
  nodes: Record<string, unknown>[];
  updatedAt: number | null;
}
export interface NodeSelection { source: string; node: string }
export interface ProxySources { sources: ProxySource[]; selected: NodeSelection | null }

/**
 * Normalize the persisted source model. Legacy definitions live in subscription.yaml, so the
 * caller must supply them when migrating; a legacy name alone is never proof of a valid node.
 * The source definitions still need subscription validation before being passed to the core.
 */
export function normalizeProxySources(input: unknown, legacyNodes: unknown = []): ProxySources {
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const nodes = (v: unknown): Record<string, unknown>[] => {
    if (!Array.isArray(v)) return [];
    const seen = new Set<string>();
    return v.filter((n): n is Record<string, unknown> => {
      if (!record(n) || typeof n.name !== 'string' || !n.name || typeof n.type !== 'string' || !n.type || seen.has(n.name)) return false;
      seen.add(n.name);
      return true;
    });
  };
  const raw = record(input) ? input : {};
  const sources: ProxySource[] = [];
  const ids = new Set<string>();
  if (Array.isArray(raw.sources)) {
    for (const value of raw.sources) {
      if (!record(value) || typeof value.id !== 'string' || !value.id || ids.has(value.id) || typeof value.name !== 'string' || !value.name.trim() || !record(value.origin)) continue;
      const o = value.origin;
      let origin: ProxySourceOrigin;
      if (o.kind === 'subscription' && typeof o.url === 'string' && o.url.trim() && (o.via === 'direct' || o.via === 'proxy')) origin = { kind: 'subscription', url: o.url.trim(), via: o.via };
      else if (o.kind === 'file' && typeof o.filename === 'string' && o.filename) origin = { kind: 'file', filename: o.filename };
      else if (o.kind === 'text') origin = { kind: 'text' };
      else continue;
      ids.add(value.id);
      sources.push({ id: value.id, name: value.name.trim(), origin, nodes: nodes(value.nodes), updatedAt: typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) && value.updatedAt >= 0 ? value.updatedAt : null });
    }
  } else {
    const oldNodes = nodes(legacyNodes);
    const url = typeof raw.subscriptionUrl === 'string' ? raw.subscriptionUrl.trim() : '';
    if (url || oldNodes.length) {
      let name = t('set.nodes.pasted');
      if (url) { try { name = new URL(url).host || url; } catch { name = url; } }
      const origin: ProxySourceOrigin = url ? { kind: 'subscription', url, via: raw.subscriptionVia === 'proxy' ? 'proxy' : 'direct' } : { kind: 'text' };
      sources.push({ id: 'legacy', name, origin, nodes: oldNodes, updatedAt: null });
    }
  }
  const candidate = record(raw.selected) ? raw.selected : typeof raw.selectedNode === 'string' ? { source: 'legacy', node: raw.selectedNode } : null;
  const selected = candidate && typeof candidate.source === 'string' && typeof candidate.node === 'string' && sources.some(s => s.id === candidate.source && s.nodes.some(n => n.name === candidate.node))
    ? { source: candidate.source, node: candidate.node } : null;
  return { sources, selected };
}

/** The fields the settings panel may change. */
export type ProfilePatch = Partial<Omit<Profile, 'version' | 'proxy'>>;

export class ProfileError extends Error {
  readonly key: TranslationKey;
  readonly path: string;
  constructor(key: TranslationKey, path = '') { super(path ? `${path}: ${t(key)}` : t(key)); this.key = key; this.path = path; }
  localized(): string { return this.path ? `${this.path}: ${t(this.key)}` : t(this.key); }
}

export function defaultProfile(hostLocale: string, hostTimezone: string): Profile {
  const locale = safeLocale(hostLocale) ?? 'en';
  return {
    version: 1,
    locale,
    acceptLanguages: languagesFor(locale),
    timezone: safeTimezone(hostTimezone) ?? 'UTC',
    geolocation: null,
    egressCountry: '',
    platform: 'host',
    allowPrivateNetwork: false,
    bypassHostTun: false,
    notifications: false,
    proxy: { sources: [], selected: null },
  };
}

/** Validates and normalises a profile. Unknown keys are dropped; missing ones take defaults. */
export function validateProfile(input: unknown, fallback: Profile): Profile {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProfileError('profileObject');
  const raw = input as Record<string, any>;
  const pick = <K extends keyof Profile>(k: K): any => (raw[k] === undefined ? fallback[k] : raw[k]);

  const locale = safeLocale(pick('locale')) ?? fail('locale', 'profileLocale');
  const langs = pick('acceptLanguages');
  if (!Array.isArray(langs) || langs.length === 0) fail('acceptLanguages', 'profileLanguages');
  const listed = langs.map((l: unknown, i: number) => safeLocale(l) ?? fail(`acceptLanguages[${i}]`, 'profileInvalid'));
  // The UI locale always leads, so page language signals remain consistent.
  const acceptLanguages = [...new Set([locale, ...listed])];

  const country = String(pick('egressCountry') ?? '').trim().toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) fail('egressCountry', 'profileCountry');

  const platform = pick('platform');
  if (!['host', 'macos', 'windows'].includes(platform)) fail('platform', 'profilePlatform');

  const proxy = normalizeProxySources(raw.proxy ?? fallback.proxy);

  return {
    version: 1,
    locale,
    acceptLanguages,
    timezone: safeTimezone(pick('timezone')) ?? fail('timezone', 'profileTimezone'),
    geolocation: geolocation(pick('geolocation')),
    egressCountry: country,
    platform,
    allowPrivateNetwork: pick('allowPrivateNetwork') === true,
    bypassHostTun: pick('bypassHostTun') === true,
    notifications: pick('notifications') === true,
    proxy,
  };
}

/** Load stored data defensively; invalid fields use safe defaults, never a previously enabled capability. */
export function normalizeProfile(input: unknown, fallback: Profile, legacyNodes: unknown = []): Profile {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const defaults = defaultProfile(fallback.locale, fallback.timezone);
  const valid = (key: keyof Profile, value: unknown): boolean => {
    try { validateProfile({ ...defaults, [key]: value }, defaults); return true; } catch { return false; }
  };
  const sanitized: Record<string, unknown> = {};
  for (const key of ['locale', 'acceptLanguages', 'timezone', 'geolocation', 'egressCountry', 'platform', 'allowPrivateNetwork', 'bypassHostTun', 'notifications'] as const) {
    if (raw[key] !== undefined && valid(key, raw[key])) sanitized[key] = raw[key];
  }
  const result = validateProfile(sanitized, defaults);
  result.proxy = normalizeProxySources(raw.proxy, legacyNodes);
  return result;
}

export function languagesFor(locale: string): string[] {
  const base = locale.split('-')[0];
  return base === locale ? [locale] : [locale, base];
}

/** Coordinates count only when all three numbers are present and in range; otherwise "not set". */
function geolocation(v: any): Geolocation | null {
  if (!v || typeof v !== 'object') return null;
  const { latitude, longitude, accuracy } = v;
  const ok = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  if (!ok(latitude, -90, 90) || !ok(longitude, -180, 180) || !ok(accuracy, 1, 100_000)) return null;
  return { latitude, longitude, accuracy };
}

function safeLocale(v: unknown): string | null {
  try {
    return typeof v === 'string' && v.trim() ? Intl.getCanonicalLocales(v.trim())[0] : null;
  } catch {
    return null;
  }
}

function safeTimezone(v: unknown): string | null {
  try {
    return typeof v === 'string' && v ? new Intl.DateTimeFormat('en-US', { timeZone: v }).resolvedOptions().timeZone : null;
  } catch {
    return null;
  }
}

function fail(path: string, key: TranslationKey): never {
  throw new ProfileError(key, path);
}
