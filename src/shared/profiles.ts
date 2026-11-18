import { ACCENTS, accentValue, type Accent } from './appearance.ts';

export const DEFAULT_PROFILE_ID = 'default';
export const MAX_PROFILES = 32;
export const MAX_PROFILE_NAME_LENGTH = 64;

export interface ProfileRegistryEntry {
  id: string;
  name: string;
  accent: Accent;
  createdAt: number;
}

export interface ProfilesRegistry {
  version: 1;
  lastActiveId: string;
  entries: ProfileRegistryEntry[];
}

export interface ProfileSummary {
  id: string;
  name: string;
  accent: Accent;
  createdAt: number;
  dir: string;
  current: boolean;
  running: boolean;
  egressCountry: string;
  timezone: string;
  locale: string;
  connectionMode: 'system' | 'independent' | 'external';
  nodeCount: number;
  setupFinished: boolean;
}

export interface CreateProfileInput {
  name: string;
  accent?: Accent;
  cloneProxyFromCurrent?: boolean;
}

export function isValidProfileId(id: unknown): id is string {
  return typeof id === 'string' && (id === DEFAULT_PROFILE_ID || /^prof_[a-z0-9]{8,24}$/.test(id));
}

export function sanitizeProfileName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const name = input.replace(/[\x00-\x1f\x7f-\x9f]/g, '').replace(/\s+/g, ' ').trim();
  return name.length > 0 && name.length <= MAX_PROFILE_NAME_LENGTH ? name : null;
}

export function pickNextAccent(existing: readonly { accent: Accent }[]): Accent {
  const counts = new Map<Accent, number>();
  for (const { accent } of existing) {
    counts.set(accent, (counts.get(accent) ?? 0) + 1);
  }

  let next: Accent = ACCENTS[0];
  let leastUsed = Infinity;
  for (const accent of ACCENTS) {
    const count = counts.get(accent) ?? 0;
    if (count < leastUsed) {
      next = accent;
      leastUsed = count;
    }
  }
  return next;
}

export function defaultProfilesRegistry(defaultName = 'Default', now = Date.now()): ProfilesRegistry {
  return {
    version: 1,
    lastActiveId: DEFAULT_PROFILE_ID,
    entries: [{
      id: DEFAULT_PROFILE_ID,
      name: sanitizeProfileName(defaultName) ?? 'Default',
      accent: 'teal',
      createdAt: now,
    }],
  };
}

export function normalizeProfilesRegistry(input: unknown, defaultName = 'Default', now = Date.now()): ProfilesRegistry {
  const registry = defaultProfilesRegistry(defaultName, now);
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return registry;
  const { entries: rawEntries, lastActiveId } = input as Record<string, unknown>;
  if (!Array.isArray(rawEntries)) return registry;

  const entries: ProfileRegistryEntry[] = [];
  const seen = new Set<string>();
  for (const rawEntry of rawEntries) {
    if (rawEntry === null || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue;
    const { id, name, accent, createdAt } = rawEntry as Record<string, unknown>;
    if (!isValidProfileId(id) || seen.has(id)) continue;
    // Reserve a slot for a default entry that may appear later or need to be inserted.
    if (entries.length === MAX_PROFILES - 1 && !seen.has(DEFAULT_PROFILE_ID) && id !== DEFAULT_PROFILE_ID) continue;
    const sanitizedName = sanitizeProfileName(name);
    if (sanitizedName === null) continue;

    entries.push({
      id,
      name: sanitizedName,
      accent: accentValue(accent),
      createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) && createdAt >= 0 ? createdAt : now,
    });
    seen.add(id);
    if (entries.length === MAX_PROFILES) break;
  }

  if (!seen.has(DEFAULT_PROFILE_ID)) entries.unshift(registry.entries[0]);
  return {
    version: 1,
    lastActiveId: isValidProfileId(lastActiveId) && seen.has(lastActiveId) ? lastActiveId : DEFAULT_PROFILE_ID,
    entries,
  };
}

export function parseProfileCliArg(argv: readonly string[]): string | null {
  const prefix = '--profile-id=';
  const id = argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
  return isValidProfileId(id) ? id : null;
}
