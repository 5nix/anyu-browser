import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortcutUrl } from '../../src/shared/shortcut.ts';
import { toUrl } from '../../src/shared/url.ts';

test('address bar input', () => {
  assert.equal(toUrl('example.com'), 'https://example.com');
  assert.equal(toUrl('  https://example.com/a?b  '), 'https://example.com/a?b');
  assert.equal(toUrl('localhost:8080/x'), 'http://localhost:8080/x');
  assert.equal(toUrl('what is a fox'), 'https://example.com/?q=what%20is%20a%20fox');
  assert.equal(toUrl(''), 'about:blank');
  assert.equal(toUrl('javascript:alert(1)'), 'https://example.com/?q=javascript%3Aalert(1)');
});

 test('search templates encode input', () => {
  assert.equal(toUrl('red fox', { kind: 'custom', template: 'https://example.net/search?q={query}' }), 'https://example.net/search?q=red%20fox');
  assert.equal(toUrl('red fox', { kind: 'custom', template: 'https://example.org/search?q={query}' }), 'https://example.org/search?q=red%20fox');
  assert.equal(toUrl('狐 & #% ', { kind: 'custom', template: 'https://example.com/?q={query}' }), 'https://example.com/?q=%E7%8B%90%20%26%20%23%25');
  for (const input of ['about:blank', 'data:text/plain,x', 'blob:https://example.com/id', 'http://example.com']) assert.equal(toUrl(input), input);
});


test('shortcut URLs normalize URL input without searching', () => {
  for (const [input, expected] of [
    ['example.net', 'https://example.net/'], ['example.net/path', 'https://example.net/path'],
    ['localhost:3000', 'http://localhost:3000/'], ['192.168.1.1', 'http://192.168.1.1/'],
    ['[::1]:3000', 'http://[::1]:3000/'], ['https://example.com', 'https://example.com/'],
  ]) assert.equal(shortcutUrl(input), expected);
  for (const input of ['', 'not a url', 'javascript:alert(1)', '999.999.999.999', 'https://']) assert.equal(shortcutUrl(input), null);
});
