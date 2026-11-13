// Every load the browser itself starts goes through here: web schemes only, and remote URLs
// only while the gate is open (the core enforces that anyway). What is asked for while the
// gate is closed waits, and loads as soon as it opens.
import type { WebContents } from 'electron';
import { WEB } from './tab.ts';

export class Navigator {
  private pending = new Map<WebContents, { url: string; back: boolean }>();

  constructor(private canBrowse: () => boolean, private blocked: (wc: WebContents, url: string) => void) {}

  load(wc: WebContents, url: string): void {
    if (!WEB.test(url)) return;
    if (/^https?:/i.test(url) && !this.canBrowse()) {
      this.pending.set(wc, { url, back: false });
      this.blocked(wc, url);
      return;
    }
    this.pending.delete(wc);
    void wc.loadURL(url).catch(() => undefined);
  }

  back(wc: WebContents): void {
    const history = wc.navigationHistory;
    if (!history.canGoBack()) { this.load(wc, 'about:blank'); return; }
    const url = history.getEntryAtIndex(history.getActiveIndex() - 1)?.url ?? '';
    if (/^https?:/i.test(url) && !this.canBrowse()) {
      this.pending.set(wc, { url, back: true });
      this.blocked(wc, url);
      return;
    }
    this.pending.delete(wc);
    history.goBack();
  }

  forget(wc: WebContents): void {
    this.pending.delete(wc);
  }

  /** The gate opened: loads everything that waited. Returns whether anything did. */
  release(): boolean {
    if (!this.pending.size) return false;
    const queued = [...this.pending];
    this.pending.clear();
    for (const [wc, pending] of queued) if (!wc.isDestroyed()) {
      if (pending.back) {
        const history = wc.navigationHistory;
        if (history.canGoBack() && history.getEntryAtIndex(history.getActiveIndex() - 1)?.url === pending.url) history.goBack();
      } else void wc.loadURL(pending.url).catch(() => undefined);
    }
    return true;
  }
}
