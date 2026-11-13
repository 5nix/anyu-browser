import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SEARCH_ENGINE, SEARCH_PRESETS, isSearchEngine, toUrl } from '../../src/shared/url.ts';

test('validates search settings and falls back for damaged values', () => {
  assert.deepEqual(DEFAULT_SEARCH_ENGINE, { kind: 'duckduckgo' });
  assert.deepEqual(SEARCH_PRESETS.map((p) => p.id), ['duckduckgo', 'google', 'bing']);
  assert.equal(isSearchEngine(DEFAULT_SEARCH_ENGINE), true);
  for (const preset of SEARCH_PRESETS) assert.equal(isSearchEngine({ kind: preset.id }), true);
  for (const template of ['', 'https://example.com/', 'http://example.com/?q={query}', 'https://u:p@example.com/?q={query}', 'https://example.com/{query}/{query}', 'not a URL {query}', `https://example.com/${'a'.repeat(2048)}{query}`]) {
    assert.equal(isSearchEngine({ kind: 'custom', template }), false);
  }
  assert.equal(isSearchEngine({ kind: 'custom', template: 'https://example.com/?q={query}' }), true);
  for (const value of [null, {}, { kind: 'default' }, { kind: 'retired-preset' }]) {
    assert.equal(isSearchEngine(value), false);
    assert.equal(toUrl('red fox', value as never), toUrl('red fox', DEFAULT_SEARCH_ENGINE));
  }
});
