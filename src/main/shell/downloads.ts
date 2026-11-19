// Downloads of the browsing session, for every window: saved straight into Cave's downloads
// folder, never over an existing file.
import { shell as electronShell } from 'electron';
import { existsSync, lstatSync } from 'node:fs';
import { join, normalize, parse as parsePath } from 'node:path';
import { browserSession } from '../network.ts';
import type { Downloads as DownloadRepository } from '../store/downloads.ts';
import type { DownloadAction, DownloadState } from '../../shared/ipc.ts';
import { ensureDownloadsDirectory } from './downloads-dir.ts';

export type DownloadFileActions = Pick<typeof electronShell, 'openPath' | 'showItemInFolder' | 'trashItem'>;

function pathKey(path: string): string {
  const key = normalize(path);
  return process.platform === 'win32' ? key.toLowerCase() : key;
}

function isFile(path: string): boolean {
  try { return lstatSync(path, { throwIfNoEntry: false })?.isFile() ?? false; }
  catch { return false; }
}

export class Downloads {
  list: DownloadState[] = [];
  private items = new Map<number, Electron.DownloadItem>();
  private trashing = new Set<string>();

  constructor(private dir: string, private changed: () => void, private repo: DownloadRepository, private files: DownloadFileActions = electronShell, private fallbackDir?: string) {
    repo.interruptUnfinished();
    this.list = repo.list(-1).map(d => ({ id: d.id, name: d.name, path: d.path, paused: false, started: d.started, ended: d.ended, exists: existsSync(d.path), received: d.state === 'completed' ? d.total : 0, total: d.total, state: d.state === 'progressing' ? 'interrupted' : d.state as DownloadState['state'] }));
    browserSession().on('will-download', (_e, item) => this.track(item));
  }

  get directory(): string {
    return this.dir;
  }

  setDir(dir: string): void {
    this.dir = dir;
  }

  private resolveTargetDir(): string {
    return ensureDownloadsDirectory(this.dir, this.fallbackDir);
  }

  private track(item: Electron.DownloadItem): void {
    const dir = this.resolveTargetDir();
    const { name, ext } = parsePath(item.getFilename() || 'download');
    let path = join(dir, name + ext);
    for (let n = 1; existsSync(path) || this.trashing.has(pathKey(path)); n++) path = join(dir, `${name} (${n})${ext}`);
    item.setSavePath(path);
    const started = Date.now();
    const id = this.repo.insert({ url: item.getURL(), path, name: parsePath(path).base, total: item.getTotalBytes(), state: 'progressing', started });
    const d: DownloadState = { id, name: parsePath(path).base, path, paused: false, started, ended: null, exists: false, received: 0, total: item.getTotalBytes(), state: 'progressing' };
    this.list = [d, ...this.list];
    this.items.set(id, item);
    let lastWrite = 0;
    item.on('updated', () => {
      if (this.items.get(id) !== item) return;
      d.paused = item.isPaused();
      d.received = item.getReceivedBytes();
      d.total = item.getTotalBytes();
      if (Date.now() - lastWrite >= 1000) { this.repo.update(id, { total: d.total }); lastWrite = Date.now(); }
      this.changed();
    });
    item.once('done', (_e, state) => {
      if (this.items.get(id) !== item) return;
      this.items.delete(id);
      d.paused = false;
      d.state = state;
      d.exists = existsSync(d.path);
      d.received = item.getReceivedBytes();
      d.total = item.getTotalBytes();
      d.ended = Date.now();
      this.repo.update(id, { state, total: d.total, ended: d.ended });
      this.changed();
    });
    this.changed();
  }

  all(): DownloadState[] {
    const seen = new Set<string>();
    return this.list.map(d => {
      const key = pathKey(d.path);
      const exists = !seen.has(key) && isFile(d.path);
      seen.add(key);
      return { ...d, exists };
    });
  }

  action(id: number, action: DownloadAction): void | Promise<void> {
    if (!Number.isSafeInteger(id)) return;
    const d = this.list.find(row => row.id === id), item = this.items.get(id);
    if (!d) return;
    if (action === 'remove') {
      if (item || d.trashing) return;
      this.repo.remove(id); this.list = this.list.filter(row => row.id !== id); this.changed(); return;
    }
    if (action === 'open' || action === 'reveal' || action === 'trash') {
      const key = pathKey(d.path);
      if (item || d.state !== 'completed' || this.trashing.has(key)) return;
      // A new download can reuse a path after a previous file has been moved.
      if (this.list.find(row => pathKey(row.path) === key) !== d || !isFile(d.path)) {
        this.changed();
        return;
      }
      if (action === 'trash') return this.trashFile(d, key);
      if (action === 'open') void this.files.openPath(d.path);
      else this.files.showItemInFolder(d.path);
      return;
    }
    if (!item || d.state !== 'progressing') return;
    try {
      if (action === 'pause' && !d.paused) { item.pause(); d.paused = true; }
      else if (action === 'resume' && d.paused) { item.resume(); d.paused = false; }
      else if (action === 'cancel') item.cancel();
      else return;
      this.changed();
    } catch { /* An item may finish between the check and the action. */ }
  }

  private async trashFile(download: DownloadState, key: string): Promise<void> {
    this.trashing.add(key);
    download.trashing = true;
    download.trashFailed = false;
    this.changed();
    try {
      await this.files.trashItem(download.path);
    } catch {
      download.trashFailed = isFile(download.path);
    } finally {
      this.trashing.delete(key);
      download.trashing = false;
      this.changed();
    }
  }

  clearRange(from: number, to: number): void {
    const removed = this.list.filter(d => d.started >= from && d.started <= to);
    for (const d of removed) { this.items.delete(d.id); this.repo.remove(d.id); }
    this.list = this.list.filter(d => d.started < from || d.started > to);
    this.changed();
  }

  clear(): void {
    this.list = [];
    this.items.clear();
    this.changed();
  }
}
