import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { openStore, Favicons, faviconOrigin, faviconType, FAVICON_MAX_BYTES, FAVICON_MAX_AGE, clearBrowsingData } from '../../src/main/store/index.ts';

test('favicon URLs and types exclude active and privileged content', () => {
  assert.equal(faviconOrigin('https://example.com/a'), 'https://example.com');
  for (const url of ['file:///tmp/x', 'data:image/png,a', 'not a url']) assert.equal(faviconOrigin(url), null);
  for (const type of ['image/png', 'image/x-icon; charset=binary', 'image/webp']) assert.equal(faviconType(type), true);
  for (const type of ['image/svg+xml', 'text/html', 'image/png-malicious']) assert.equal(faviconType(type), false);
});
test('favicon cache is per origin, expires, enforces size and clears with browsing data', () => {
  const store = openStore(':memory:');
  try {
    const cache = new Favicons(store), now = Date.now();
    cache.put('https://example.com/a', Buffer.from('abc'), now);
    assert.equal(cache.get('https://example.com/b', now), 'data:image/png;base64,YWJj');
    assert.equal(cache.get('http://example.com/', now), null);
    assert.equal(cache.get('https://example.com/', now + FAVICON_MAX_AGE), null);
    cache.put('https://big.example/', Buffer.alloc(FAVICON_MAX_BYTES + 1), now);
    assert.equal(cache.get('https://big.example/', now), null);
    cache.clear('https://example.com/'); assert.equal(cache.get('https://example.com/', now), null);
    cache.put('https://example.com/', Buffer.from('abc'), now); clearBrowsingData(store);
    assert.equal(cache.get('https://example.com/', now), null);
  } finally { store.close(); }
});
