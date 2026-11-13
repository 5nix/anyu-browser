import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionQueue } from '../../src/main/permission-queue.ts';

test('permission queue is FIFO, merges duplicates and drops a tab', () => {
  const queue = new PermissionQueue<{ wc: object; key: string }>();
  const a = {}, b = {}, results: string[] = [];
  const first = { wc: a, key: 'camera' }, duplicate = { wc: a, key: 'camera' }, second = { wc: a, key: 'location' }, third = { wc: b, key: 'camera' };
  assert.equal(queue.enqueue(first, v => results.push(`first:${v}`)), true);
  assert.equal(queue.enqueue(duplicate, v => results.push(`duplicate:${v}`)), false);
  queue.enqueue(second, v => results.push(`second:${v}`));
  queue.enqueue(third, v => results.push(`third:${v}`));
  assert.equal(queue.head, first);
  queue.finish(first, true);
  queue.finish(first, false);
  assert.equal(queue.head, second);
  queue.removeTab(a);
  assert.equal(queue.head, third);
  queue.clear();
  assert.equal(queue.head, null);
  assert.deepEqual(results, ['first:true', 'duplicate:true', 'second:false', 'third:false']);
});
