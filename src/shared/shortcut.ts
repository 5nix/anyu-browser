import { inputUrl } from './url.ts';

export function shortcutUrl(input: string): string | null {
  try { const url = new URL(inputUrl(input) ?? ''); return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? url.href : null; } catch { return null; }
}
