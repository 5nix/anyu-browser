// Runs the bundled, unmodified core as a child process. Only this file and controller.ts talk to it.
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { appendFile } from 'node:fs/promises';
import type { Controller } from './controller.ts';
import { spawnTied } from './tied.ts';

export class CoreProcess extends EventEmitter {
  private child: ChildProcess | null = null;

  constructor(
    private binary: string,
    private home: string,
    private configFile: string,
    private logFile: string,
  ) {
    super();
  }

  get running(): boolean {
    return this.child !== null;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  /**
   * Starts the core and resolves once its config is applied (the controller can answer before
   * that, so readiness is the proxy group existing); rejects if it never gets there.
   */
  async start(controller: Controller): Promise<void> {
    const child = spawnTied(this.binary, ['-d', this.home, '-f', this.configFile]);
    this.child = child;
    const log = (b: Buffer) => void appendFile(this.logFile, b).catch(() => undefined);
    child.stdout!.on('data', log);
    child.stderr!.on('data', log);
    child.on('error', (err) => void appendFile(this.logFile, `spawn error: ${err.message}\n`).catch(() => undefined));
    child.on('exit', () => {
      if (this.child !== child) return;
      this.child = null;
      this.emit('exit');
    });
    for (let i = 0; i < 100 && this.child === child; i++) {
      if (await controller.selected().then(() => true, () => false)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    this.stop();
    throw new Error('代理核心没有启动，详见 logs/core.log');
  }

  /** SIGTERM, then SIGKILL if it lingers. Resolves when the process is gone. */
  stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const kill = setTimeout(() => child.kill('SIGKILL'), 3000);
      child.once('exit', () => (clearTimeout(kill), resolve()));
      child.kill('SIGTERM');
    });
  }
}
