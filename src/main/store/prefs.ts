// JSON preferences.
import type { Store } from './db.ts';
export class Prefs {
  store: Store;
  constructor(store: Store) { this.store = store; }
  get<T>(key: string, fallback: T): T {
    const row = this.store.prepare('SELECT value FROM prefs WHERE key = ?').get(key);
    try { return row ? JSON.parse(String(row.value)) as T : fallback; } catch { return fallback; }
  }
  set(key: string, value: unknown): void { this.store.prepare('INSERT INTO prefs VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  delete(key: string): void { this.store.prepare('DELETE FROM prefs WHERE key=?').run(key); }
}
