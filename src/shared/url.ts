import type { SearchEngine } from './ipc.ts';

// Reserved example domain only; real searches use a user-supplied HTTPS template.
export const DEFAULT_SEARCH_ENGINE: SearchEngine = { kind: 'default' };

export function isSearchEngine(value: unknown): value is SearchEngine {
  if (!value || typeof value !== 'object') return false;
  const engine = value as Record<string, unknown>;
  if (engine.kind === 'default') return true;
  if (engine.kind !== 'custom' || typeof engine.template !== 'string' || engine.template.length > 2048) return false;
  if (engine.template.split('{query}').length !== 2) return false;
  try {
    const url = new URL(engine.template.replace('{query}', 'test'));
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}

/** URL-like input without the address bar's search fallback. */
export function inputUrl(input: string): string | null {
  const s = input.trim();
  if (/^(https?|about|data|blob):/i.test(s)) return s;
  if (!/^(localhost|[\w-]+(\.[\w-]+)+|\[[0-9a-f:]+\])(:\d+)?([/?#]\S*)?$/i.test(s) || /\s/.test(s)) return null;
  const host = s.match(/^(localhost|\[[0-9a-f:]+\]|[^:/?#]+)/i)![0];
  const local = /^localhost$/i.test(host) || /^\[/.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host);
  return `${local ? 'http' : 'https'}://${s}`;
}

/** Address bar input to URL: URLs and bare hostnames load, anything else is a search. */
export function toUrl(input: string, search: SearchEngine = DEFAULT_SEARCH_ENGINE): string {
  const s = input.trim();
  if (!s) return 'about:blank';
  const url = inputUrl(s);
  if (url) return url;
  const engine = isSearchEngine(search) ? search : DEFAULT_SEARCH_ENGINE;
  const template = engine.kind === 'custom' ? engine.template : 'https://example.com/?q={query}';
  return template.replace('{query}', encodeURIComponent(s));
}
