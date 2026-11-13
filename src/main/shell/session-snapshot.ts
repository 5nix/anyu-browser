export type SavedTab = { url: string; title: string; pinned: boolean };
export type SavedWindow = { tabs: SavedTab[]; active: number };
export type SessionSnapshot = { version: 1; windows: SavedWindow[] };

export function validSession(value: unknown): value is SessionSnapshot {
  if (!value || typeof value !== 'object') return false;
  const s = value as SessionSnapshot;
  return s.version === 1 && Array.isArray(s.windows) && s.windows.length > 0 && s.windows.length <= 100 && s.windows.every(w =>
    w && Array.isArray(w.tabs) && w.tabs.length > 0 && w.tabs.length <= 500 && Number.isInteger(w.active) && w.active >= 0 && w.active < w.tabs.length && w.tabs.every(t => {
      if (!t || typeof t.url !== 'string' || t.url.length > 8192 || typeof t.title !== 'string' || t.title.length > 4096 || typeof t.pinned !== 'boolean') return false;
      try { const u = new URL(t.url); return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password; } catch { return false; }
    }));
}
