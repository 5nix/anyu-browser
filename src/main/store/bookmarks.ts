// Ordered bookmark folders and links.
import type { Store } from './db.ts';
export type Bookmark = { id: number; parent: number | null; position: number; kind: 'folder' | 'link'; title: string; url: string | null; created: number };
export type NewBookmark = { parent: number | null; kind: 'folder' | 'link'; title: string; url?: string | null };
export class Bookmarks {
  store: Store;
  constructor(store: Store) { this.store = store; }
  private transaction<T>(fn: () => T): T { this.store.db.exec('BEGIN'); try { const result = fn(); this.store.db.exec('COMMIT'); return result; } catch (e) { this.store.db.exec('ROLLBACK'); throw e; } }
  private validateParent(parent: number | null): void { if (parent !== null && !this.store.prepare("SELECT id FROM bookmarks WHERE id=? AND kind='folder'").get(parent)) throw new Error('Parent must be a folder'); }
  add(input: NewBookmark): number { return this.transaction(() => { this.validateParent(input.parent); const position = this.children(input.parent).length; return Number(this.store.prepare('INSERT INTO bookmarks(parent,position,kind,title,url,created) VALUES(?,?,?,?,?,?)').run(input.parent,position,input.kind,input.title,input.url ?? null,Date.now()).lastInsertRowid); }); }
  update(id: number, patch: { title?: string; url?: string | null }): void { const row = this.store.prepare('SELECT * FROM bookmarks WHERE id=?').get(id) as Bookmark | undefined; if (!row) return; this.store.prepare('UPDATE bookmarks SET title=?,url=? WHERE id=?').run(patch.title ?? row.title,patch.url === undefined ? row.url : patch.url,id); }
  move(id: number, parent: number | null, position: number): void { this.transaction(() => {
    const row = this.store.prepare('SELECT * FROM bookmarks WHERE id=?').get(id) as Bookmark | undefined;
    if (!row) throw new Error('Bookmark not found');
    this.validateParent(parent);
    let current = parent;
    while (current !== null) { if (current === id) throw new Error('Cannot move a folder into itself or its descendant'); const ancestor = this.store.prepare('SELECT parent FROM bookmarks WHERE id=?').get(current); current = ancestor?.parent as number | null; }
    this.store.prepare('UPDATE bookmarks SET position=position-1 WHERE parent IS ? AND position>?').run(row.parent,row.position);
    const count = this.children(parent).filter(item => item.id !== id).length;
    const target = Math.max(0,Math.min(Math.trunc(position),count));
    this.store.prepare('UPDATE bookmarks SET position=position+1 WHERE parent IS ? AND position>=? AND id<>?').run(parent,target,id);
    this.store.prepare('UPDATE bookmarks SET parent=?,position=? WHERE id=?').run(parent,target,id);
  }); }
  remove(id: number): void { this.transaction(() => { const row = this.store.prepare('SELECT parent,position FROM bookmarks WHERE id=?').get(id); if (!row) return; this.store.prepare('DELETE FROM bookmarks WHERE id=?').run(id); this.store.prepare('UPDATE bookmarks SET position=position-1 WHERE parent IS ? AND position>?').run(row.parent as number | null,row.position as number); }); }
  children(parent: number | null): Bookmark[] { return this.store.prepare('SELECT * FROM bookmarks WHERE parent IS ? ORDER BY position,id').all(parent) as Bookmark[]; }
  find(url: string): Bookmark[] { return this.store.prepare('SELECT * FROM bookmarks WHERE url=? ORDER BY id').all(url) as Bookmark[]; }
  search(text: string, limit: number): Bookmark[] { const term = `%${text.replace(/[\\%_]/g, '\\$&')}%`; return this.store.prepare("SELECT * FROM bookmarks WHERE title LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' ORDER BY title LIMIT ?").all(term,term,limit) as Bookmark[]; }
}
