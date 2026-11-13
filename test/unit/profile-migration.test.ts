import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileStore } from '../../src/main/profile.ts';

test('store migrates the legacy profile and definitions together and persists the new shape', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cave-profile-'));
  try {
    await writeFile(join(dir, 'profile.json'), JSON.stringify({ proxy: { subscriptionUrl: 'https://example.test/sub', subscriptionVia: 'proxy', selectedNode: 'Node 01' } }));
    await writeFile(join(dir, 'subscription.yaml'), 'proxies:\n  - name: Node 01\n    type: ss\n    server: example.test\n');
    const store = await ProfileStore.open(dir);
    assert.deepEqual(store.current.proxy.selected, { source: 'legacy', node: 'Node 01' });
    assert.equal(store.current.proxy.sources[0].nodes[0].server, 'example.test');
    const reopened = await ProfileStore.open(dir);
    assert.deepEqual(reopened.current.proxy, store.current.proxy);
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'profile.json'), 'utf8')).proxy, store.current.proxy);
    await assert.rejects(readFile(join(dir, 'subscription.yaml')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('existing sources, external ports and exit countries complete setup only during migration', async () => {
  const { defaultProfile, normalizeProfile } = await import('../../src/shared/profile.ts');
  const base = defaultProfile('en', 'UTC');
  const complete = { started: true, identityHandled: true, personaliseHandled: true, dismissed: true, finished: true };
  const source = { proxy: { sources: [{ id: 's', name: 's', origin: { kind: 'text' }, nodes: [], updatedAt: null }], selected: null } };
  for (const old of [source, { externalProxy: { ...base.externalProxy, port: 7890 } }, { egressCountry: 'JP' }]) {
    assert.deepEqual(normalizeProfile(old, base).setup, complete);
    // Unreadable setup choices on a configured profile also mean an existing user.
    assert.deepEqual(normalizeProfile({ ...old, setup: { started: 'yes' } }, base).setup, complete);
  }
  assert.deepEqual(normalizeProfile({}, base).setup, base.setup);
  assert.deepEqual(normalizeProfile({ ...source, setup: base.setup }, base).setup, base.setup);
});

test('a configured profile from before setup is written back with setup finished and never shows it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cave-setup-'));
  try {
    await writeFile(join(dir, 'profile.json'), JSON.stringify({ version: 1, egressCountry: 'JP' }));
    const store = await ProfileStore.open(dir);
    assert.equal(store.current.setup.finished, true);
    assert.equal(JSON.parse(await readFile(join(dir, 'profile.json'), 'utf8')).setup.finished, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
