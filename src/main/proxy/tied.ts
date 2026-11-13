// How the core is started so that it can never outlive Cave.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { Writable } from 'node:stream';

/**
 * Spawns a child that cannot outlive Cave, however Cave dies (crash, SIGKILL, Task Manager).
 * Windows: libuv already puts every non-detached child in a kill-on-close job object.
 * macOS/Linux: the shell forks a watcher blocked reading a pipe only Cave holds open, then execs
 * into the binary (same pid, so signals and exit codes are the core's own). If Cave goes, the
 * kernel closes the pipe, the read hits EOF and the watcher terminates the core. If the core goes
 * first, Cave sends the watcher a line and it leaves without killing anything.
 */
export function spawnTied(binary: string, args: string[]): ChildProcess {
  const options: SpawnOptions = { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] };
  if (process.platform === 'win32') return spawn(binary, args, options);
  const child = spawn('/bin/sh', ['-c', '(read x <&3 || kill $$) & exec "$0" "$@" 3<&-', binary, ...args], options);
  const pipe = child.stdio[3] as Writable;
  // The watcher may already be gone; a failed goodbye must not become an uncaught exception.
  pipe.on('error', () => undefined);
  child.on('exit', () => { if (!pipe.writableEnded && !pipe.destroyed) pipe.end('\n'); });
  return child;
}
