import type { Store } from './db.ts';

export const FAVICON_MAX_BYTES = 256 * 1024;
export const FAVICON_MAX_AGE = 30 * 86400_000;
export const FAVICON_CACHE_BYTES = 20 * 1024 * 1024;
export function faviconOrigin(url: string): string | null {
  try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null; } catch { return null; }
}
export function faviconType(type: string): boolean { return /^image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon|avif)(?:\s*;|\s*$)/i.test(type); }
export class Favicons {
  private store: Store;
  constructor(store: Store) { this.store = store; }
  get(url: string, now = Date.now()): string | null {
    const origin = faviconOrigin(url); if (!origin) return null;
    const row = this.store.prepare('SELECT data FROM favicons WHERE origin=? AND updated>?').get(origin, now - FAVICON_MAX_AGE);
    return row ? `data:image/png;base64,${Buffer.from(row.data as Uint8Array).toString('base64')}` : null;
  }
  put(url: string, data: Uint8Array, now = Date.now()): void {
    const origin = faviconOrigin(url); if (!origin || !data.length || data.length > FAVICON_MAX_BYTES) return;
    this.store.prepare('INSERT INTO favicons VALUES(?,?,?) ON CONFLICT(origin) DO UPDATE SET data=excluded.data,updated=excluded.updated').run(origin, data, now);
    this.store.prepare('DELETE FROM favicons WHERE updated<=?').run(now - FAVICON_MAX_AGE);
    const rows = this.store.prepare('SELECT origin,length(data) AS size FROM favicons ORDER BY updated DESC, origin').all();
    let total = 0; for (const row of rows) { total += Number(row.size); if (total > FAVICON_CACHE_BYTES) this.store.prepare('DELETE FROM favicons WHERE origin=?').run(String(row.origin)); }
  }
  clear(url?: string): void { const origin = url && faviconOrigin(url); if (url && !origin) return; if (origin) this.store.prepare('DELETE FROM favicons WHERE origin=?').run(origin); else this.store.db.exec('DELETE FROM favicons'); }
}
