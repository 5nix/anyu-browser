import type { AddressSuggestion } from '../shared/ipc.ts';

export function completion(prefix: string, items: AddressSuggestion[]): string | null {
  if (prefix.length < 2) return null;
  const lower = (s: string) => s.replace(/[A-Z]/g, c => c.toLowerCase());
  for (const item of items) {
    if (item.kind !== 'history' && item.kind !== 'bookmark') continue;
    try {
      const url = new URL(item.url);
      if (url.username || url.password || !/^https?:$/.test(url.protocol)) continue;
      for (const candidate of [item.url, ...(url.protocol === 'https:' ? [item.url.slice(8)] : [])]) {
        if (candidate.length > prefix.length && lower(candidate).startsWith(lower(prefix))) return prefix + candidate.slice(prefix.length);
      }
    } catch { /* Ignore malformed suggestions. */ }
  }
  return null;
}
