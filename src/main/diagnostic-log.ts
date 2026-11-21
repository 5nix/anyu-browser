import { appendFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ENTRY_LIMIT = 2000;
const FILE_LIMIT = 5 * 1024 * 1024;
const CORE_TAIL = 200 * 1024;
const FIELD_LIMIT = 512;

type Fields = Record<string, string | number | boolean | null>;
type LogFiles = { dir: string; current: string; rotated: string; core: string };

function absent<T>(error: NodeJS.ErrnoException, fallback: T): T {
  if (error.code === 'ENOENT') return fallback;
  throw error;
}

export function diagnosticUrl(value?: string): string | null {
  if (!value) return value ?? null;
  const url = URL.parse(value);
  if (!url) return null;
  if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin + url.pathname;
  if (url.protocol === 'chrome-extension:') return `${url.protocol}//${url.host}${url.pathname}`;
  if (url.protocol === 'about:' || url.protocol === 'chrome-error:') return `${url.protocol}${url.pathname}`;
  if (url.protocol === 'blob:' && url.origin !== 'null') return `blob:${url.origin}`;
  return url.protocol;
}

export class DiagnosticLog {
  private ring: string[] = [];
  private next = 0;
  private files?: LogFiles;
  private diskEnabled = false;
  private diskChanges = 0;
  private size?: number;
  private queue = Promise.resolve();

  initialize(profileDir: string, enabled: boolean): Promise<void> {
    const dir = join(profileDir, 'logs');
    const files = { dir, current: join(dir, 'diagnostic.log'), rotated: join(dir, 'diagnostic.1.log'), core: join(dir, 'core.log') };
    this.files = files;
    this.diskEnabled = enabled;
    const lines = this.snapshot();
    return this.serial(() => enabled ? this.append(files, lines) : this.remove(files));
  }

  record(event: string, fields: Fields): void {
    const payload = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, FIELD_LIMIT) : value]));
    const line = JSON.stringify({ time: new Date().toISOString(), event, payload }) + '\n';
    this.ring[this.next] = line;
    this.next = (this.next + 1) % ENTRY_LIMIT;
    const files = this.files;
    if (files && (this.diskEnabled || this.diskChanges)) {
      void this.serial(async () => { if (this.diskEnabled) await this.append(files, [line]); }).catch(() => undefined);
    }
  }

  setDisk(enabled: boolean, persist: () => void): Promise<void> {
    const files = this.files!;
    const lines = enabled ? this.snapshot() : [];
    this.diskChanges++;
    return this.serial(async () => {
      if (!enabled) {
        persist();
        this.diskEnabled = false;
        await this.remove(files);
      } else if (!this.diskEnabled) {
        try {
          await this.remove(files);
          await this.append(files, lines);
          persist();
          this.diskEnabled = true;
        } catch (error) {
          await this.remove(files);
          throw error;
        }
      }
    }).finally(() => { this.diskChanges--; });
  }

  async export(choosePath: (filename: string) => Promise<string | undefined>): Promise<void> {
    const files = this.files!;
    const date = new Date().toISOString().slice(0, 10);
    const path = await choosePath(`anyu-log-${date}.txt`);
    if (!path) return;
    if ([files.current, files.rotated, files.core].some(file => resolve(file) === resolve(path))) {
      throw new Error('Choose a separate file for the export');
    }
    await this.serial(async () => {
      const read = (file: string) => readFile(file).catch(error => absent(error, Buffer.alloc(0)));
      const diagnostic = this.diskEnabled ? await Promise.all([read(files.rotated), read(files.current)]) : [Buffer.from(this.snapshot().join(''))];
      const core = await coreTail(files.core);
      await writeFile(path, Buffer.concat([...diagnostic, Buffer.from('\n----- core.log -----\n'), core]), { mode: 0o600 });
    });
  }

  flush(): Promise<void> { return this.queue; }

  private snapshot(): string[] {
    return [...this.ring.slice(this.next), ...this.ring.slice(0, this.next)];
  }

  private serial(action: () => Promise<void>): Promise<void> {
    const pending = this.queue.then(action);
    this.queue = pending.catch(() => undefined);
    return pending;
  }

  private async append(files: LogFiles, lines: string[]): Promise<void> {
    try {
      if (this.size === undefined) {
        await mkdir(files.dir, { recursive: true, mode: 0o700 });
        this.size = await stat(files.current).then(info => info.size).catch(error => absent(error, 0));
      }
      let chunk = '';
      for (const line of lines) {
        const bytes = Buffer.byteLength(line);
        if (this.size + bytes > FILE_LIMIT) {
          if (chunk) await appendFile(files.current, chunk, { mode: 0o600 });
          await rename(files.current, files.rotated);
          this.size = 0;
          chunk = '';
        }
        chunk += line;
        this.size += bytes;
      }
      await appendFile(files.current, chunk, { mode: 0o600 });
    } catch (error) {
      this.size = undefined;
      throw error;
    }
  }

  private async remove(files: LogFiles): Promise<void> {
    this.size = undefined;
    try { await rm(files.current, { force: true }); }
    finally { await rm(files.rotated, { force: true }); }
  }
}

async function coreTail(path: string): Promise<Buffer> {
  const file = await open(path, 'r').catch(error => absent(error, null));
  if (!file) return Buffer.alloc(0);
  try {
    const { size } = await file.stat();
    const tail = Buffer.alloc(Math.min(size, CORE_TAIL));
    const { bytesRead } = await file.read(tail, 0, tail.length, size - tail.length);
    return tail.subarray(0, bytesRead);
  } finally { await file.close(); }
}

export const diagnosticLog = new DiagnosticLog();
