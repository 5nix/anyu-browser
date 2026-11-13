import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validSession } from '../../src/main/shell/session-snapshot.ts';

test('session snapshot validation rejects versions, invalid URLs and bad active indices', () => {
  const s = { version: 1, windows: [{ tabs: [{ url: 'https://example.com/', title: 'Example', pinned: false }], active: 0 }] };
  assert.equal(validSession(s), true);
  assert.equal(validSession({ ...s, version: 2 }), false);
  assert.equal(validSession({ ...s, windows: [{ ...s.windows[0], active: 1 }] }), false);
  for (const url of ['file:///secret', 'https://user:pass@example.com/', 'garbage']) assert.equal(validSession({ ...s, windows: [{ tabs: [{ ...s.windows[0].tabs[0], url }], active: 0 }] }), false);
});

import { sessionStartup } from '../../src/main/shell/session-startup.ts';
test('startup decision requires a valid snapshot and distinguishes clean exit from crash', () => {
  const snapshot = { version: 1, windows: [{ tabs: [{ url: 'https://example.com/', title: 'Example', pinned: false }], active: 0 }] };
  assert.equal(sessionStartup(null, true, false).action, 'open');
  assert.equal(sessionStartup(snapshot, false, true).action, 'open');
  assert.equal(sessionStartup(snapshot, true, true).action, 'restore');
  assert.equal(sessionStartup(snapshot, false, false).action, 'offer');
  assert.equal(sessionStartup(snapshot, true, false).action, 'offer');
});
