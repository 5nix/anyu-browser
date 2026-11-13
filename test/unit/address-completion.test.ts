import { test } from 'node:test';
import { strictEqual } from 'node:assert';
import { completion } from '../../src/renderer/address-completion.ts';
test('completion uses only URL prefixes of bookmarks and history', () => {
  const items = [{ id: '1', kind: 'tab' as const, title: '', url: 'https://example.com/tab' }, { id: '2', kind: 'history' as const, title: '', url: 'https://example.com/path' }];
  strictEqual(completion('Ex', items), 'Example.com/path');
  strictEqual(completion('https://ex', items), 'https://example.com/path');
  strictEqual(completion('path', items), null);
  strictEqual(completion('e', items), null);
  strictEqual(completion('ex', [{ ...items[1], url: 'https://u:p@example.com/' }]), null);
});
