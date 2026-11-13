import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SEARCH_ENGINE, isSearchEngine, toUrl } from '../../src/shared/url.ts';

test('validates search settings and falls back for damaged values', () => {
  assert.equal(isSearchEngine(DEFAULT_SEARCH_ENGINE), true);
  for (const template of ['', 'https://example.com/', 'http://example.com/?q={query}', 'https://u:p@example.com/?q={query}', 'https://example.com/{query}/{query}', 'not a URL {query}', `https://example.com/${'a'.repeat(2048)}{query}`]) {
    assert.equal(isSearchEngine({ kind: 'custom', template }), false);
  }
  assert.equal(isSearchEngine({ kind: 'custom', template: 'https://example.com/?q={query}' }), true);
  for (const value of [null, {}, { kind: 'retired-preset' }]) {
    assert.equal(isSearchEngine(value), false);
    assert.equal(toUrl('red fox', value as never), toUrl('red fox', DEFAULT_SEARCH_ENGINE));
  }
});
