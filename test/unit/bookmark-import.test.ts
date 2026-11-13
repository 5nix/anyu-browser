import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBookmarks, insertBookmarks, MAX_BOOKMARK_FILE } from '../../src/main/shell/bookmark-import.ts';
import { Bookmarks, openStore } from '../../src/main/store/index.ts';

const html = `<DL><p><DT><H3>Folder &amp; more</H3><DL><p><DT><H3>Nested</H3><DL><DT><A HREF="https://example.com/">Safe</A></DL><DT><A HREF="javascript:alert(1)">bad</A><DT><A HREF="file:///etc/passwd">bad</A><DT><A HREF="data:text/plain,x">bad</A></DL></DL>`;
test('bookmark import parses hierarchy and skips unsafe links', () => {
  const parsed = parseBookmarks(html);
  assert.equal(parsed.skipped, 3);
  assert.equal(parsed.nodes[0].title, 'Folder & more');
  assert.equal(parsed.nodes[0].children[0].children[0].url, 'https://example.com/');
  assert.doesNotThrow(() => parseBookmarks('<DL><H3>broken <A href="x">'));
  assert.throws(() => parseBookmarks('x'.repeat(MAX_BOOKMARK_FILE + 1)), /large/);
  assert.throws(() => parseBookmarks('<H3>x</H3><DL>'.repeat(17)), /deep/);
  assert.throws(() => parseBookmarks('<A>x</A>'.repeat(20001)), /many/);
});
test('bookmark import inserts atomically', () => {
  const store = openStore(':memory:');
  try {
    const bookmarks = new Bookmarks(store), parsed = parseBookmarks(html);
    store.db.exec("CREATE TRIGGER fail_import BEFORE INSERT ON bookmarks WHEN NEW.title='Safe' BEGIN SELECT RAISE(ABORT, 'fail'); END");
    assert.throws(() => insertBookmarks(bookmarks, parsed.nodes, 'Imported'));
    assert.deepEqual(bookmarks.children(null), []);
    store.db.exec('DROP TRIGGER fail_import');
    assert.equal(insertBookmarks(bookmarks, parsed.nodes, 'Imported'), 3);
    const root = bookmarks.children(null)[0];
    assert.equal(bookmarks.children(root.id)[0].title, 'Folder & more');
  } finally { store.close(); }
});
