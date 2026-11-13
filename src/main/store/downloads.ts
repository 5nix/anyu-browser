// Download records.
import type { Store } from './db.ts';
export type Download = { id: number; url: string; path: string; name: string; total: number; state: string; started: number; ended: number | null };
export type NewDownload = Omit<Download, 'id' | 'total' | 'ended'> & { total?: number; ended?: number | null };
export class Downloads {
  store: Store;
  constructor(store: Store) { this.store = store; }
  insert(data: NewDownload): number { return Number(this.store.prepare('INSERT INTO downloads(url,path,name,total,state,started,ended) VALUES(?,?,?,?,?,?,?)').run(data.url,data.path,data.name,data.total ?? 0,data.state,data.started,data.ended ?? null).lastInsertRowid); }
  update(id: number, patch: Partial<Omit<Download, 'id'>>): void { const row = this.store.prepare('SELECT * FROM downloads WHERE id=?').get(id) as Download | undefined; if (!row) return; const value = { ...row, ...patch }; this.store.prepare('UPDATE downloads SET url=?,path=?,name=?,total=?,state=?,started=?,ended=? WHERE id=?').run(value.url,value.path,value.name,value.total,value.state,value.started,value.ended,id); }
  interruptUnfinished(): void { this.store.prepare("UPDATE downloads SET state='interrupted', ended=COALESCE(ended, CAST(unixepoch('subsec') * 1000 AS INTEGER)) WHERE state='progressing'").run(); }
  list(limit: number): Download[] { return this.store.prepare('SELECT * FROM downloads ORDER BY started DESC,id DESC LIMIT ?').all(limit) as Download[]; }
  remove(id: number): void { this.store.prepare('DELETE FROM downloads WHERE id=?').run(id); }
  clear(): void { this.store.prepare('DELETE FROM downloads').run(); }
}
