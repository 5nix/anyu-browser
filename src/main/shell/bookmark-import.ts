import type { Bookmarks } from '../store/bookmarks.ts';

export type ImportNode = { kind: 'folder' | 'link'; title: string; url: string | null; children: ImportNode[] };
export const MAX_BOOKMARK_FILE = 5 * 1024 * 1024;
const decode = (text: string) => text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
  const names: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  if (entity[0] !== '#') return names[entity.toLowerCase()] ?? match;
  const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
  return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd';
});

/** Parse the structural subset of Netscape bookmark HTML without executing it. */
export function parseBookmarks(html: string): { nodes: ImportNode[]; skipped: number } {
  if (Buffer.byteLength(html, 'utf8') > MAX_BOOKMARK_FILE) throw new Error('Bookmark file too large');
  const nodes: ImportNode[] = [], stack: ImportNode[][] = [nodes];
  let pending: ImportNode | null = null, skipped = 0, count = 0;
  const tokens = html.match(/<\s*\/?\s*(?:DL|H3|A)\b[^>]*>|[^<]+/gi) ?? [];
  let capture: { kind: 'folder' | 'link'; url: string | null; text: string } | null = null;
  for (const token of tokens) {
    if (!token.startsWith('<')) { if (capture) capture.text += token; continue; }
    const tag = token.match(/^<\s*(\/?)\s*(DL|H3|A)\b/i); if (!tag) continue;
    const closing = !!tag[1], name = tag[2].toUpperCase();
    if (name === 'DL') {
      if (closing) { if (stack.length > 1) stack.pop(); pending = null; }
      else if (pending) { if (stack.length >= 17) throw new Error('Bookmark nesting too deep'); stack.push(pending.children); pending = null; }
    } else if (!closing) {
      if (++count > 20000) throw new Error('Too many bookmarks');
      const href = name === 'A' ? token.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) : null;
      capture = { kind: name === 'H3' ? 'folder' : 'link', url: href ? decode(href[1] ?? href[2] ?? href[3]) : null, text: '' };
    } else if (capture && ((name === 'H3') === (capture.kind === 'folder'))) {
      const title = decode(capture.text).trim().slice(0, 1024), url = capture.url;
      if (capture.kind === 'link' && (!url || url.length > 2048 || !URL.canParse(url) || !['http:', 'https:'].includes(new URL(url).protocol))) { skipped++; pending = null; }
      else { const node: ImportNode = { kind: capture.kind, title, url: capture.kind === 'link' ? url : null, children: [] }; stack.at(-1)!.push(node); pending = node.kind === 'folder' ? node : null; }
      capture = null;
    }
  }
  return { nodes, skipped };
}

export function insertBookmarks(bookmarks: Bookmarks, nodes: ImportNode[], title: string): number {
  const db = bookmarks.store.db;
  db.exec('BEGIN');
  try {
    const insert = bookmarks.store.prepare('INSERT INTO bookmarks(parent,position,kind,title,url,created) VALUES(?,?,?,?,?,?)');
    const root = Number(insert.run(null, bookmarks.children(null).length, 'folder', title, null, Date.now()).lastInsertRowid);
    let added = 0;
    const append = (items: ImportNode[], parent: number) => items.forEach((node, position) => {
      const id = Number(insert.run(parent, position, node.kind, node.title, node.url, Date.now()).lastInsertRowid);
      added++;
      if (node.kind === 'folder') append(node.children, id);
    });
    append(nodes, root);
    db.exec('COMMIT'); return added;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
