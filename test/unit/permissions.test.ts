import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowPermission, applyPermissions } from '../../src/main/permissions.ts';
import { PermissionQueue } from '../../src/main/permission-queue.ts';
import { trustworthyPermissionOrigin } from '../../src/main/shell/permission-origin.ts';
import { defaultProfile } from '../../src/shared/profile.ts';

test('legacy permission ceilings and device denial remain in force', () => {
  let profile = defaultProfile('en-US', 'UTC');
  for (const permission of ['clipboard-sanitized-write', 'fullscreen', 'pointerLock', 'keyboardLock']) assert.equal(allowPermission(permission, profile), true);
  for (const permission of ['geolocation', 'notifications', 'media', 'clipboard-read', 'display-capture']) assert.equal(allowPermission(permission, profile), false);
  let request: Function = () => {}, device: Function = () => {};
  const session = { setPermissionRequestHandler: (fn: Function) => request = fn, setPermissionCheckHandler: () => {}, setDevicePermissionHandler: (fn: Function) => device = fn } as unknown as Electron.Session;
  let prompts = 0;
  applyPermissions(session, () => profile, (_wc, _permission, _details, callback) => { prompts++; callback(true); }, () => false);
  const decide = (permission: string) => { let result: boolean | undefined; request({}, permission, (value: boolean) => result = value, {}); return result; };
  assert.equal(decide('notifications'), false);
  assert.equal(decide('geolocation'), false);
  assert.equal(decide('display-capture'), false);
  assert.equal(prompts, 0);
  profile = { ...profile, notifications: true };
  assert.equal(decide('notifications'), true);
  assert.equal(prompts, 1);
  assert.equal(device(), false);
});

test('permission origins allow HTTPS and HTTP loopback only', () => {
  for (const origin of ['https://example.com', 'http://localhost:1234', 'http://127.0.0.1:1234', 'http://[::1]:1234']) assert.equal(trustworthyPermissionOrigin(new URL(origin)), true, origin);
  for (const origin of ['http://example.com', 'http://localhost.example.com', 'http://192.168.1.1', 'https://user:pass@example.com']) assert.equal(trustworthyPermissionOrigin(new URL(origin)), false, origin);
});

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
