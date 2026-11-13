import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore, Shortcuts, clearBrowsingData } from '../../src/main/store/index.ts';
import { shortcutUrl } from '../../src/shared/shortcut.ts';

test('shortcut URL accepts HTTP and HTTPS URLs', () => {
  assert.equal(shortcutUrl(' https://example.com/path '), 'https://example.com/path');
  for (const url of ['file:///tmp/home.html', 'javascript:alert(1)', 'data:text/html,x', 'https://']) assert.equal(shortcutUrl(url), null);
});
test('shortcuts persist in order, edit, enforce the limit and reset', () => {
  const store = openStore(':memory:');
  try {
    const repo = new Shortcuts(store);
    repo.save({ name: '', url: 'https://example.com' });
    repo.save({ name: 'Other', url: 'http://other.test' });
    assert.deepEqual(repo.list().map(s => s.name), ['example.com', 'Other']);
    const id = repo.list()[0].id;
    repo.save({ id, name: 'Edited', url: 'https://edited.test' });
    assert.deepEqual(repo.list().map(s => s.name), ['Edited', 'Other']);
    for (let i = 0; i < 8; i++) repo.save({ name: String(i), url: 'https://example.com' });
    assert.throws(() => repo.save({ name: 'extra', url: 'https://example.com' }));
    assert.throws(() => repo.save({ id, name: 'bad', url: 'file:///etc/passwd' }));
    repo.remove(id);
    assert.equal(repo.list().length, 9);
    clearBrowsingData(store);
    assert.deepEqual(repo.list(), []);
  } finally { store.close(); }
});
