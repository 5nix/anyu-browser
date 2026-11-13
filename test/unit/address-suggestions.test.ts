import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bookmarks, History, openStore } from '../../src/main/store/index.ts';
import { localSuggestions, rankSuggestions, suggestionUrl } from '../../src/main/shell/suggestions.ts';

test('local suggestions rank and deduplicate', () => {
  const store = openStore(':memory:');
  try {
    const bookmarks = new Bookmarks(store), history = new History(store);
    bookmarks.add({ parent: null, kind: 'link', title: 'example bookmark', url: 'https://example.com/' });
    for (let i = 0; i < 12; i++) history.visit(`https://site${i}.example.com/`, `example ${i}`, false, i);
    const result = localSuggestions('example', [{ windowId: 1, tabId: 1, title: 'Example', url: 'https://example.com' }], bookmarks, history);
    assert.equal(result.items.length, 10);
    assert.equal(result.items[0].kind, 'tab');
    assert.equal(result.items.at(-1)?.kind, 'search');
    assert.equal(result.items.filter(item => item.url === 'https://example.com/').length, 1);
  } finally { store.close(); }
});

test('invalid and credential URLs', () => {
  assert.equal(suggestionUrl('https://user:secret@example.com:443/a#x'), 'https://example.com/a#x');
  for (const url of ['javascript:alert(1)', 'file:///tmp/x', 'invalid', `https://example.com/${'x'.repeat(2048)}`]) assert.equal(suggestionUrl(url), null);
  const items = rankSuggestions('example', [{ windowId: 1, tabId: 1, title: '<img src=x>', url: 'https://user:secret@example.com' }], [], []);
  assert.equal(items[0].title, '<img src=x>');
  assert.equal(items[0].url, 'https://example.com/');
});

test('store failure leaves navigation available', () => {
  const store = openStore(':memory:');
  try {
    const bookmarks = new Bookmarks(store), history = new History(store);
    bookmarks.add({ parent: null, kind: 'link', title: 'example', url: 'https://bookmark.example/' });
    history.visit('https://history.example/', 'example', false);
    const failure = { search(): never { throw new Error('unavailable'); } };
    for (const [b, h, kind] of [[failure, history, 'history'], [bookmarks, failure, 'bookmark']] as const) {
      const result = localSuggestions('example', [], b, h);
      assert.equal(result.unavailable, true);
      assert.deepEqual(result.items.map(item => item.kind), [kind, 'search']);
    }
    assert.deepEqual(localSuggestions(' ', [], failure, failure), { items: [], unavailable: false });
  } finally { store.close(); }
});

test('history FTS handles Unicode, punctuation and updates', () => {
  const store = openStore(':memory:');
  try {
    const history = new History(store);
    history.visit('https://example.com/', '中文 测试', false);
    assert.equal(history.search('中文，测试', 10).length, 1);
    history.setTitle('https://example.com/', '新标题');
    assert.equal(history.search('中文', 10).length, 0);
    assert.equal(history.search('新标题', 10).length, 1);
    history.remove('https://example.com/');
    assert.equal(history.search('新标题', 10).length, 0);
  } finally { store.close(); }
});
