import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('a tied child dies with its parent, even when the parent is killed outright', async () => {
  // The parent stands in for Cave: it spawns a long-lived "core", reports its pid, then waits.
  const parent = spawn(process.execPath, [
    '--input-type=module',
    '-e',
    `const { spawnTied } = await import(${JSON.stringify(new URL('../../src/main/proxy/tied.ts', import.meta.url).href)});
     const core = spawnTied(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
     console.log(core.pid);`,
  ], { stdio: ['ignore', 'pipe', 'inherit'] });
  const [line] = await once(parent.stdout!, 'data');
  const core = Number(String(line).trim());
  assert.ok(alive(core), 'core started');

  parent.kill('SIGKILL'); // TerminateProcess on Windows, like Task Manager.
  await once(parent, 'exit');
  for (let i = 0; i < 50 && alive(core); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(alive(core), false, 'core went with its parent');
});

test('when the child exits first, its watcher leaves too and kills nothing', { skip: process.platform === 'win32' }, async () => {
  const { spawnTied } = await import('../../src/main/proxy/tied.ts');
  const marker = `tied-${process.pid}-${Date.now()}`;
  const child = spawnTied(process.execPath, ['-e', 'setTimeout(() => {}, 200)', marker]);
  const [code, signal] = await once(child, 'exit');
  assert.deepEqual([code, signal], [0, null], 'the child exited on its own terms');
  const { execFileSync } = await import('node:child_process');
  await new Promise((r) => setTimeout(r, 300));
  assert.throws(() => execFileSync('pgrep', ['-f', marker]), 'no watcher left behind');
});
