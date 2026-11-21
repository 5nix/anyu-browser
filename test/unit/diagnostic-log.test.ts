import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiagnosticLog } from '../../src/main/diagnostic-log.ts';

test('diagnostic log bounds memory, appends and rotates on disk, and clears disk on opt-out', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'anyu-diagnostics-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const current = join(root, 'logs', 'diagnostic.log');
  const rotated = join(root, 'logs', 'diagnostic.1.log');
  const saved = join(root, 'export.txt');
  const logger = new DiagnosticLog();
  await logger.initialize(root, false);
  for (let n = 0; n < 2005; n++) logger.record('entry', { n });
  await assert.rejects(stat(current), { code: 'ENOENT' });

  let persisted = false;
  await logger.setDisk(true, () => { persisted = true; });
  assert.equal(persisted, true);
  const lines = (await readFile(current, 'utf8')).trimEnd().split('\n');
  assert.equal(lines.length, 2000);
  assert.equal(JSON.parse(lines[0]).payload.n, 5);
  assert.equal(JSON.parse(lines.at(-1)!).payload.n, 2004);
  logger.record('live', {});
  await logger.flush();
  assert.match(await readFile(current, 'utf8'), /"event":"live"/);

  const cap = 5 * 1024 * 1024;
  await appendFile(current, Buffer.alloc(cap - (await stat(current)).size, 32));
  const restarted = new DiagnosticLog();
  await restarted.initialize(root, persisted);
  restarted.record('after-restart', {});
  await restarted.flush();
  assert.equal((await stat(rotated)).size, cap);
  assert.match(await readFile(current, 'utf8'), /"event":"after-restart"/);

  await writeFile(join(root, 'logs', 'core.log'), 'omit-me\n' + 'x'.repeat(200 * 1024 - 3) + 'end');
  await restarted.export(async filename => {
    assert.match(filename, /^anyu-log-\d{4}-\d{2}-\d{2}\.txt$/);
    return saved;
  });
  const diskExport = await readFile(saved, 'utf8');
  assert.ok(diskExport.indexOf('"event":"live"') < diskExport.indexOf('"event":"after-restart"'));
  assert.match(diskExport, /----- core\.log -----\n(x{204797})end$/);
  assert.doesNotMatch(diskExport, /omit-me/);

  await restarted.setDisk(false, () => { persisted = false; });
  assert.equal(persisted, false);
  restarted.record('memory-only', {});
  await restarted.flush();
  await Promise.all([current, rotated].map(file => assert.rejects(stat(file), { code: 'ENOENT' })));
  await restarted.export(async () => saved);
  const memoryExport = await readFile(saved, 'utf8');
  assert.match(memoryExport, /"event":"after-restart".*\n.*"event":"memory-only"/);
  assert.doesNotMatch(memoryExport, /"event":"live"/);
});
