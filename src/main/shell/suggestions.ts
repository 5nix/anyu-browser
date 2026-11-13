// Local address suggestions. This module does not perform network operations.
import { randomUUID } from 'node:crypto';
import type { Bookmark, HistoryEntry } from '../store/index.ts';

export type LocalTab = { windowId: number; tabId: number; title: string; url: string; generation?: number };
export type LocalSuggestion = {
  id: string;
  kind: 'tab' | 'bookmark' | 'history' | 'search';
  title: string;
  url: string;
  target: LocalTab | string;
};

/** Canonical display URL; never return credentials or a non-web URL. */
export function suggestionUrl(value: string): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.username = ''; url.password = '';
    const result = url.href;
    return result.length <= 2048 ? result : null;
  } catch { return null; }
}

/** Sources are already in window/tab and repository order. */
export function rankSuggestions(input: string, tabs: LocalTab[], bookmarks: Bookmark[], history: HistoryEntry[]): LocalSuggestion[] {
  const text = input.trim();
  if (!text) return [];
  const needle = text.toLocaleLowerCase();
  const result: LocalSuggestion[] = [];
  const seen = new Set<string>();
  const add = (kind: LocalSuggestion['kind'], title: string, rawUrl: string, target: LocalTab | string) => {
    const url = suggestionUrl(rawUrl);
    if (!url || seen.has(url) || result.length >= 9) return;
    seen.add(url);
    result.push({ id: randomUUID(), kind, title: title.slice(0, 256), url, target });
  };
  for (const tab of tabs) {
    const url = suggestionUrl(tab.url);
    if (url && (tab.title.toLocaleLowerCase().includes(needle) || url.toLocaleLowerCase().includes(needle))) add('tab', tab.title, url, tab);
  }
  for (const bookmark of bookmarks) if (bookmark.kind === 'link' && bookmark.url) add('bookmark', bookmark.title, bookmark.url, bookmark.url);
  for (const entry of history) add('history', entry.title, entry.url, entry.url);
  result.push({ id: randomUUID(), kind: 'search', title: text, url: '', target: text });
  return result;
}

export function localSuggestions(input: string, tabs: LocalTab[], bookmarks: Pick<{ search(text: string, limit: number): Bookmark[] }, 'search'>, history: Pick<{ search(text: string, limit: number): HistoryEntry[] }, 'search'>): { items: LocalSuggestion[]; unavailable: boolean } {
  if (!input.trim()) return { items: [], unavailable: false };
  let unavailable = false, saved: Bookmark[] = [], visited: HistoryEntry[] = [];
  try { saved = bookmarks.search(input.trim(), 10); } catch { unavailable = true; }
  try { visited = history.search(input.trim(), 10); } catch { unavailable = true; }
  return { items: rankSuggestions(input, tabs, saved, visited), unavailable };
}
