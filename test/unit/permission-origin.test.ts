import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trustworthyPermissionOrigin } from '../../src/main/shell/permission-origin.ts';

test('permission origins allow HTTPS and HTTP loopback only', () => {
  for (const origin of ['https://example.com', 'http://localhost:1234', 'http://127.0.0.1:1234', 'http://[::1]:1234']) assert.equal(trustworthyPermissionOrigin(new URL(origin)), true, origin);
  for (const origin of ['http://example.com', 'http://localhost.example.com', 'http://192.168.1.1', 'https://user:pass@example.com']) assert.equal(trustworthyPermissionOrigin(new URL(origin)), false, origin);
});
