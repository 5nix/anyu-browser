export type UaMode = 'chromium' | 'chrome' | 'electron';
export type UaPreference = 'default' | UaMode;

export interface UaOverrideEntry {
  origin: string;
  mode: UaMode;
}

/** Built-in exceptions whose default identity uses Electron so Google/YouTube sign-in is not blocked. */
export const BUILTIN_SITE_UA: Readonly<Record<string, UaMode>> = {
  'https://accounts.google.com': 'electron',
  'https://accounts.youtube.com': 'electron',
};

export const UA_MODES: readonly UaMode[] = ['chromium', 'chrome', 'electron'];

export function isUaMode(value: unknown): value is UaMode {
  return value === 'chromium' || value === 'chrome' || value === 'electron';
}

export function isUaPreference(value: unknown): value is UaPreference {
  return value === 'default' || isUaMode(value);
}

export function normalizeSiteOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || !URL.canParse(value)) return null;
  const parsed = new URL(value);
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
}

export function builtinUa(origin: string): UaMode | null {
  return Object.hasOwn(BUILTIN_SITE_UA, origin) ? BUILTIN_SITE_UA[origin] : null;
}

export function defaultUa(origin: string): UaMode {
  return builtinUa(origin) ?? 'chromium';
}

export function effectiveUa(origin: string, override: UaMode | null): UaMode {
  return override ?? defaultUa(origin);
}

export function uaModeLabel(mode: UaMode): string {
  return mode === 'chrome' ? 'Chrome' : mode === 'electron' ? 'Electron' : 'Chromium';
}
