import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { ProfileManager, type ProfileManagerOptions } from '../../src/main/profiles.ts';
import { defaultProfile } from '../../src/shared/profile.ts';
import { MAX_PROFILES } from '../../src/shared/profiles.ts';

async function fixture(t: TestContext, options: Partial<ProfileManagerOptions> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'cave-profiles-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const baseDir = join(dir, 'Cave');
  const registryFile = join(baseDir, 'profiles.json');
  const open = (overrides: Partial<ProfileManagerOptions> = {}) =>
    ProfileManager.open({ baseDir, argv: [], ...options, ...overrides });
  return { dir, baseDir, registryFile, open };
}

async function json(file: string) {
  return JSON.parse(await readFile(file, 'utf8'));
}

test('open creates the registry and preserves the legacy default directory', async t => {
  const { baseDir, registryFile, open } = await fixture(t);
  const manager = await open();
  assert.equal(manager.currentId, 'default');
  assert.equal(manager.currentDir, join(baseDir, 'profile'));
  assert.deepEqual(await json(registryFile), {
    version: 1, lastActiveId: 'default', entries: [manager.currentEntry],
  });
  assert.equal(manager.currentEntry.name, '默认环境');
  await writeFile(join(manager.currentDir, 'profile.json'), JSON.stringify({ egressCountry: 'jp' }));
  assert.equal((await open()).currentDir, manager.currentDir);
  assert.equal((await manager.list())[0].egressCountry, 'JP');
  assert.throws(() => manager.dirFor('../profile'), /Invalid profile ID/);
});

test('create seeds distinct accents and optionally clones only proxy settings', async t => {
  const { open } = await fixture(t);
  const manager = await open();
  const current = defaultProfile('ja-JP', 'Asia/Tokyo');
  Object.assign(current, {
    connectionMode: 'external',
    externalProxy: { ...current.externalProxy, port: 7890 },
    monitorUrls: ['https://check.example/trace'],
    egressCountry: 'JP',
    geolocation: { latitude: 35, longitude: 139, accuracy: 100 },
    setup: { ...current.setup, finished: true },
  });
  current.proxy = {
    sources: [
      { id: 'first', name: 'First', origin: { kind: 'text' }, nodes: [{ name: 'A', type: 'ss' }], updatedAt: null },
      { id: 'second', name: 'Second', origin: { kind: 'text' }, nodes: [{ name: 'B', type: 'socks5' }], updatedAt: null },
    ],
    selected: { source: 'first', node: 'A' },
  };
  await writeFile(join(manager.currentDir, 'cave.sqlite'), 'browsing data');
  await mkdir(join(manager.currentDir, 'browser'));
  const blank = await manager.create({ name: '  Clean   profile ', cloneProxyFromCurrent: false }, current);
  const cloned = await manager.create({ name: 'Clone', cloneProxyFromCurrent: true }, current);

  assert.equal(blank.name, 'Clean profile');
  assert.equal(blank.nodeCount, 0);
  assert.equal(blank.connectionMode, 'system');
  assert.equal(cloned.nodeCount, 2);
  assert.equal(cloned.connectionMode, 'external');
  assert.equal(new Set([manager.currentEntry.accent, blank.accent, cloned.accent]).size, 3);
  assert.deepEqual(await json(join(blank.dir, 'ui.json')), { accent: blank.accent });
  assert.deepEqual(await json(join(cloned.dir, 'ui.json')), { accent: cloned.accent });
  const profile = await json(join(cloned.dir, 'profile.json'));
  assert.deepEqual(profile.proxy, current.proxy);
  assert.deepEqual(profile.externalProxy, current.externalProxy);
  assert.deepEqual(profile.monitorUrls, current.monitorUrls);
  assert.equal(profile.egressCountry, '');
  assert.equal(profile.geolocation, null);
  assert.deepEqual(profile.setup, { ...defaultProfile('en', 'UTC').setup, started: true });
  await assert.rejects(readFile(join(cloned.dir, 'cave.sqlite')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(cloned.dir, 'browser', 'SingletonLock')), { code: 'ENOENT' });
  const [live] = await manager.list(current);
  assert.equal(live.nodeCount, 2);
  assert.equal(live.egressCountry, 'JP');
  assert.equal(live.setupFinished, true);
});

test('CLI and registered explicit paths update the active ID, while an external path preserves the registry', async t => {
  const { dir, baseDir, registryFile, open } = await fixture(t, { defaultName: 'Primary' });
  const manager = await open();
  assert.equal(manager.currentEntry.name, 'Primary');
  const profile = await manager.create({ name: 'Second' });
  const byCli = await open({ argv: [`--profile-id=${profile.id}`] });
  assert.equal(byCli.currentId, profile.id);
  assert.equal(byCli.currentDir, profile.dir);
  assert.equal((await json(registryFile)).lastActiveId, profile.id);
  assert.equal((await open({ argv: ['--profile-id=prof_absent00'] })).currentId, profile.id);

  const before = await readFile(registryFile, 'utf8');
  const explicitProfileDir = join(dir, 'external');
  const standalone = await open({ explicitProfileDir });
  assert.equal(standalone.currentId, 'default');
  assert.equal(standalone.currentDir, explicitProfileDir);
  assert.equal(standalone.dirFor('default'), explicitProfileDir);
  assert.equal(await readFile(registryFile, 'utf8'), before);

  const explicitDefault = await open({ explicitProfileDir: join(baseDir, 'profiles', '..', 'profile'), argv: [`--profile-id=${profile.id}`] });
  assert.equal(explicitDefault.currentId, 'default');
  assert.equal((await json(registryFile)).lastActiveId, 'default');
  assert.equal((await open({ explicitProfileDir: profile.dir })).currentId, profile.id);
});

test('lock ownership and PID liveness protect current, running and default profiles', async t => {
  const { open } = await fixture(t, { isPidAlive: pid => pid === 42, pid: 42 });
  const manager = await open();
  const active = await manager.create({ name: 'Active elsewhere' });
  const other = await open({ explicitProfileDir: active.dir });
  const file = join(active.dir, '.cave-lock.json');
  assert.equal(other.isRunning(other.currentId), true);
  assert.equal(manager.isRunning(active.id), false);
  other.markCurrentRunning();
  const lock = await json(file);
  assert.equal(lock.pid, 42);
  assert.ok(Number.isInteger(lock.startedAt) && lock.startedAt > 0);
  assert.equal(manager.isRunning(active.id), true);
  await assert.rejects(manager.remove(active.id), /Cannot delete a running profile/);
  await assert.rejects(other.remove(active.id), /Cannot delete the current profile/);
  await assert.rejects(other.remove('default'), /Cannot delete the default profile/);

  await writeFile(file, JSON.stringify({ pid: 43 }));
  other.releaseCurrentLock();
  assert.equal((await json(file)).pid, 43);
  assert.equal(manager.isRunning(active.id), false);
  await writeFile(file, JSON.stringify({ pid: '42' }));
  assert.equal(manager.isRunning(active.id), false);
  other.markCurrentRunning(42);
  other.releaseCurrentLock();
  await assert.rejects(readFile(file), { code: 'ENOENT' });
  assert.deepEqual((await manager.remove(active.id)).map(entry => entry.id), ['default']);
  await assert.rejects(readFile(join(active.dir, 'profile.json')), { code: 'ENOENT' });
});

test('registry operations see updates from other managers and launch through the injected spawner', async t => {
  const launches: [string, string][] = [];
  const { open, registryFile } = await fixture(t, { spawnProcess: (id, dir) => launches.push([id, dir]) });
  const first = await open();
  const second = await open();
  const [profile] = await Promise.all([
    first.create({ name: 'Original' }),
    second.create({ name: 'Concurrent' }),
  ]);
  assert.equal((await first.list()).length, 3);
  await second.rename(profile.id, '  Renamed  ');
  await first.syncCurrentAccent(profile.accent);
  const entries = await second.list();
  assert.equal(entries.find(entry => entry.id === 'default')?.accent, profile.accent);
  assert.equal(entries.find(entry => entry.id === profile.id)?.name, 'Renamed');
  await first.launch(profile.id);
  assert.deepEqual(launches, [[profile.id, profile.dir]]);
  assert.equal((await json(registryFile)).lastActiveId, profile.id);
  await first.launch(first.currentId);
  assert.equal(launches.length, 1);
  assert.equal((await json(registryFile)).lastActiveId, first.currentId);
  await assert.rejects(first.launch('prof_absent00'), /Profile not found/);
  await assert.rejects(first.rename(profile.id, ' '), /Invalid profile name/);
  await assert.rejects(first.create({ name: ' ' }), /Invalid profile name/);
});

test('directory import normalizes profile settings and copies selected data files', async t => {
  const { dir, open } = await fixture(t);
  const manager = await open();
  const source = join(dir, 'Existing');
  await mkdir(join(source, 'browser'), { recursive: true });
  await writeFile(join(source, 'profile.json'), '[]');
  await assert.rejects(manager.importDirectory(source), /Invalid profile.json/);
  await writeFile(join(source, 'profile.json'), JSON.stringify({ egressCountry: 'jp', locale: 'ja', unknown: true }));
  await writeFile(join(source, 'cave.sqlite'), 'database');
  await writeFile(join(source, 'ui.json'), '{"zoom":1.25}');
  await writeFile(join(source, 'runtime.yaml'), 'runtime');
  await writeFile(join(source, '.cave-lock.json'), JSON.stringify({ pid: process.pid }));
  await writeFile(join(source, 'browser', 'SingletonLock'), 'browser lock');
  const imported = await manager.importDirectory(source, '  ');
  assert.equal(imported.name, 'Existing');
  assert.equal(imported.egressCountry, 'JP');
  assert.equal(imported.locale, 'ja');
  assert.equal(imported.running, false);
  assert.equal((await json(join(imported.dir, 'profile.json'))).unknown, undefined);
  assert.equal(await readFile(join(imported.dir, 'cave.sqlite'), 'utf8'), 'database');
  assert.deepEqual(await json(join(imported.dir, 'ui.json')), { zoom: 1.25 });
  for (const file of ['runtime.yaml', '.cave-lock.json', 'browser/SingletonLock']) {
    await assert.rejects(readFile(join(imported.dir, file)), { code: 'ENOENT' });
  }
  assert.equal((await manager.importDirectory(source, '  Custom   name  ')).name, 'Custom name');
});

test('the profile limit applies to both creation and import', async t => {
  const { open, registryFile } = await fixture(t);
  const manager = await open();
  const registry = await json(registryFile);
  for (let index = 1; index < MAX_PROFILES; index++) {
    registry.entries.push({ id: 'prof_' + String(index).padStart(8, '0'), name: String(index), accent: 'teal', createdAt: 0 });
  }
  await writeFile(registryFile, JSON.stringify(registry));
  await writeFile(join(manager.currentDir, 'profile.json'), '{}');
  await assert.rejects(manager.create({ name: 'Extra' }), /Maximum number of profiles reached/);
  await assert.rejects(manager.importDirectory(manager.currentDir), /Maximum number of profiles reached/);
});
