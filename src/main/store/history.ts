// Browsing history and full-text search.
import type { Store } from './db.ts';
export type HistoryEntry = { id: number; url: string; title: string; visits: number; typed: number; last_visit: number };
export class History {
  store: Store;
  constructor(store: Store) { this.store = store; }
  private transaction(fn: () => void): void { this.store.db.exec('BEGIN'); try { fn(); this.store.db.exec('COMMIT'); } catch (error) { this.store.db.exec('ROLLBACK'); throw error; } }
  visit(url: string, title: string, typed: boolean, at = Date.now()): void {
    this.transaction(() => {
      this.store.prepare('INSERT INTO history_visits(url,visited,typed) VALUES(?,?,?)').run(url,at,Number(typed));
      this.store.prepare('INSERT INTO history(url,title,visits,typed,last_visit) VALUES(?,?,1,?,?) ON CONFLICT(url) DO UPDATE SET title=excluded.title, visits=(SELECT count(*) FROM history_visits WHERE url=excluded.url), typed=(SELECT coalesce(sum(typed),0) FROM history_visits WHERE url=excluded.url), last_visit=(SELECT max(visited) FROM history_visits WHERE url=excluded.url)').run(url,title,Number(typed),at);
    });
  }
  setTitle(url: string, title: string): void { this.store.prepare('UPDATE history SET title=? WHERE url=?').run(title,url); }
  recent(limit: number, before?: number): HistoryEntry[] { return this.store.prepare('SELECT * FROM history WHERE last_visit < ? ORDER BY last_visit DESC, id DESC LIMIT ?').all(before ?? Number.MAX_SAFE_INTEGER,limit) as HistoryEntry[]; }
  search(text: string, limit: number): HistoryEntry[] {
    const tokens = text.match(/[\p{L}\p{N}]+/gu) ?? [];
    if (!tokens.length) return [];
    const query = tokens.map(token => `"${token}"*`).join(' AND ');
    return this.store.prepare('SELECT h.* FROM history h JOIN history_fts f ON f.rowid=h.id WHERE history_fts MATCH ? ORDER BY (h.typed * 10 + h.visits + 5.0 / (1.0 + max(0, ? - h.last_visit) / 86400000.0)) DESC, h.last_visit DESC LIMIT ?').all(query,Date.now(),limit) as HistoryEntry[];
  }
  list(text: string, before: number | null, limit: number): HistoryEntry[] {
    const tokens = text.match(/[\p{L}\p{N}]+/gu) ?? [];
    if (text.trim() && !tokens.length) return [];
    const query = tokens.map(token => `"${token}"*`).join(' AND ');
    const select = 'SELECT h.id, h.url, h.title, h.visits, h.typed, v.visited AS last_visit FROM history_visits v JOIN history h ON h.url=v.url';
    if (!query) return this.store.prepare(`${select} WHERE v.visited < ? ORDER BY v.visited DESC, v.id DESC LIMIT ?`).all(before ?? Number.MAX_SAFE_INTEGER,limit) as HistoryEntry[];
    return this.store.prepare(`${select} JOIN history_fts f ON f.rowid=h.id WHERE history_fts MATCH ? AND v.visited < ? ORDER BY v.visited DESC, v.id DESC LIMIT ?`).all(query,before ?? Number.MAX_SAFE_INTEGER,limit) as HistoryEntry[];
  }
  removeMany(urls: string[]): void { this.transaction(() => { for (const url of urls) { this.store.prepare('DELETE FROM history_visits WHERE url=?').run(url); this.store.prepare('DELETE FROM history WHERE url=?').run(url); } }); }
  remove(url: string): void { this.removeMany([url]); }
  removeRange(from: number, to: number): void {
    this.transaction(() => {
      const urls = this.store.prepare('SELECT DISTINCT url FROM history_visits WHERE visited >= ? AND visited <= ?').all(from,to);
      this.store.prepare('DELETE FROM history_visits WHERE visited >= ? AND visited <= ?').run(from,to);
      for (const { url } of urls) {
        this.store.prepare('DELETE FROM history WHERE url=? AND NOT EXISTS (SELECT 1 FROM history_visits WHERE url=?)').run(url as string,url as string);
        this.store.prepare('UPDATE history SET visits=(SELECT count(*) FROM history_visits WHERE url=?), typed=(SELECT coalesce(sum(typed),0) FROM history_visits WHERE url=?), last_visit=(SELECT max(visited) FROM history_visits WHERE url=?) WHERE url=?').run(url as string,url as string,url as string,url as string);
      }
    });
  }
  clear(): void { this.transaction(() => { this.store.prepare('DELETE FROM history_visits').run(); this.store.prepare('DELETE FROM history').run(); }); }
}
