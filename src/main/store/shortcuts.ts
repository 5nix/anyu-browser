import type { Store } from './db.ts';
import type { Shortcut } from '../../shared/ipc.ts';
import { shortcutUrl } from '../../shared/shortcut.ts';
export class Shortcuts {
  private store: Store;
  constructor(store: Store) { this.store = store; }
  list(): Shortcut[] { return this.store.prepare('SELECT id, name, url FROM shortcuts ORDER BY position, id').all() as unknown as Shortcut[]; }
  save(input: { id?: number; name: string; url: string }): void {
    const url = shortcutUrl(input.url);
    if (!url || typeof input.name !== 'string') throw new Error('Invalid shortcut');
    const name = input.name.trim() || new URL(url).hostname;
    if (input.id !== undefined) { this.store.prepare('UPDATE shortcuts SET name=?, url=? WHERE id=?').run(name, url, input.id); return; }
    if (this.list().length >= 10) throw new Error('Shortcut limit reached');
    this.store.prepare('INSERT INTO shortcuts (name,url,position) VALUES (?,?,COALESCE((SELECT MAX(position)+1 FROM shortcuts),0))').run(name,url);
  }
  remove(id: number): void { this.store.prepare('DELETE FROM shortcuts WHERE id=?').run(id); }
}
