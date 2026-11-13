import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowPermission, applyPermissions } from '../../src/main/permissions.ts';
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
