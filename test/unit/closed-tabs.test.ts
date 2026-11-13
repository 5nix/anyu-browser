import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClosedTabs } from '../../src/main/shell/closed-tabs.ts';

test('closed tabs are bounded, ordered and clearable', () => {
  const stack = new ClosedTabs();
  assert.equal(stack.pop(), undefined);
  for (let i = 0; i < 26; i++) stack.push({ url: `https://example.com/${i}`, title: `${i}`, pinned: i === 25, position: i });
  assert.deepEqual(stack.pop(), { url: 'https://example.com/25', title: '25', pinned: true, position: 25 });
  for (let i = 24; i >= 1; i--) assert.equal(stack.pop()?.position, i);
  assert.equal(stack.available, false);
  stack.push({ url: 'https://example.com/', title: '', pinned: false, position: 0 });
  stack.clear();
  assert.equal(stack.available, false);
});
