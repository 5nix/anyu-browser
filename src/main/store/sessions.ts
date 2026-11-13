// Saved sessions and recently closed tabs.
import type { Store } from './db.ts';
export class Sessions {
  store: Store;
  constructor(store: Store) { this.store = store; }
  save(data: unknown): void { this.store.db.exec('BEGIN'); try { this.store.prepare('INSERT INTO sessions(saved,data) VALUES(?,?)').run(Date.now(),JSON.stringify(data)); this.store.prepare('DELETE FROM sessions WHERE id NOT IN (SELECT id FROM sessions ORDER BY id DESC LIMIT 5)').run(); this.store.db.exec('COMMIT'); } catch (e) { this.store.db.exec('ROLLBACK'); throw e; } }
  latest<T = unknown>(valid: (data: unknown) => boolean = () => true): T | null {
    for (const row of this.store.prepare('SELECT data FROM sessions ORDER BY id DESC').all()) {
      try { const data: unknown = JSON.parse(String(row.data)); if (valid(data)) return data as T; } catch { /* Try the previous snapshot. */ }
    }
    return null;
  }
  cleanQuit(restoreSession: boolean): void { if (!restoreSession) this.discardSnapshots(); }
  discardSnapshots(): void { this.store.db.exec('DELETE FROM sessions'); }
  clear(): void { this.store.db.exec('DELETE FROM sessions; DELETE FROM closed_tabs'); }
  pushClosed(data: unknown): void { this.store.db.exec('BEGIN'); try { this.store.prepare('INSERT INTO closed_tabs(closed,data) VALUES(?,?)').run(Date.now(),JSON.stringify(data)); this.store.prepare('DELETE FROM closed_tabs WHERE id NOT IN (SELECT id FROM closed_tabs ORDER BY id DESC LIMIT 25)').run(); this.store.db.exec('COMMIT'); } catch (e) { this.store.db.exec('ROLLBACK'); throw e; } }
  popClosed<T = unknown>(): T | null { this.store.db.exec('BEGIN'); try { const row = this.store.prepare('SELECT id,data FROM closed_tabs ORDER BY id DESC LIMIT 1').get(); if (!row) { this.store.db.exec('COMMIT'); return null; } const data = JSON.parse(String(row.data)) as T; this.store.prepare('DELETE FROM closed_tabs WHERE id=?').run(row.id as number); this.store.db.exec('COMMIT'); return data; } catch (e) { this.store.db.exec('ROLLBACK'); throw e; } }
}
