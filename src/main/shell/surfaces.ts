// What floats above the page. Every surface is an element of the window's overlay page: one
// Modal surfaces cover the window; non-modal suggestions occupy only their measured bounds.
import type { View, WebContents, WebContentsView } from 'electron';
import type { Rect, ShellState, SurfaceName } from '../../shared/ipc.ts';

export class Surfaces {
  private open_: SurfaceName | null = null;
  private generation = 0;
  /** Where each surface's anchor is, as the chrome page last reported it. */
  private anchors: Partial<Record<SurfaceName, Rect>> = {};
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  /** The page that had the keyboard before a surface took it. */
  private focusBefore: WebContents | null = null;

  constructor(
    private content: View,
    private overlay: WebContentsView,
    private focusedPage: () => WebContents | null,
    private changed: () => void,
    private closed: () => void = () => {},
    private fallbackFocus: () => void = () => {},
    private windowSize: () => { width: number; height: number } = () => this.content.getBounds(),
    /** Draws the open card's shadow around the given rectangle, outside the overlay view; null removes it. */
    private shadow: (card: Rect | null) => void = () => {},
  ) { this.park(); }

  get state(): ShellState['surface'] {
    return this.open_ && { name: this.open_, generation: this.generation, anchor: this.anchors[this.open_] ?? { x: 0, y: 0, width: 0, height: 0 }, viewport: this.windowSize() };
  }

  hasAnchor(name: SurfaceName): boolean { return !!this.anchors[name]; }

  anchor(name: SurfaceName): Rect | undefined { return this.anchors[name]; }

  toggle(name: SurfaceName): void {
    if (this.open_ === name) this.close();
    else this.open(name);
  }

  open(name: SurfaceName, anchor?: Rect): void {
    if (this.open_ === name) { if (anchor) this.anchors[name] = anchor; this.changed(); return; }
    if (this.open_) this.closed();
    if (anchor) this.anchors[name] = anchor;
    if (name !== 'permission' && name !== 'httpAuth' && name !== 'restoreSession') this.park();
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
    if (!this.open_) {
      this.focusBefore = this.focusedPage();
      if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
    }
    this.generation++;
    this.open_ = name;
    if (name === 'permission' || name === 'httpAuth' || name === 'restoreSession') this.fullBounds();
    if (['siteInfo', 'menu', 'contextMenu', 'bookmarkEdit', 'permission', 'httpAuth', 'restoreSession'].includes(name)) this.overlay.webContents.focus();
    this.changed();
  }

  close(restore = true): void {
    if (!this.open_) return;
    this.open_ = null;
    this.shadow(null);
    this.closed();
    this.changed();
    this.schedulePark(160);
    if (restore && this.overlay.webContents.isFocused()) {
      if (this.focusBefore && !this.focusBefore.isDestroyed()) this.focusBefore.focus();
      else this.fallbackFocus();
    }
    this.focusBefore = null;
  }

  outsidePress(x?: number, y?: number): void {
    const state = this.state;
    if (!state || ['permission', 'httpAuth', 'restoreSession'].includes(state.name)) return;
    const a = state.anchor;
    if (x !== undefined && y !== undefined && x >= a.x && x < a.x + a.width && y >= a.y && y < a.y + a.height) return;
    this.close(false);
  }

  escape(): void {
    if (this.open_ && !['permission', 'httpAuth', 'restoreSession', 'suggestions'].includes(this.open_)) this.close();
  }

  private park(): void {
    const { width, height } = this.windowSize();
    this.shadow(null);
    this.overlay.setBounds({ x: width, y: height, width: 1, height: 1 });
  }

  private schedulePark(delay: number): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (!this.open_) this.park();
    }, delay);
  }

  fullBounds(): void {
    if ((this.open_ && !['permission', 'httpAuth', 'restoreSession'].includes(this.open_)) || (!this.open_ && this.hideTimer)) return;
    if (!this.open_) { this.park(); return; }
    const { width, height } = this.windowSize();
    this.overlay.setBounds({ x: 0, y: 0, width, height });
  }

  setBounds(r: Rect, name: SurfaceName = 'suggestions', generation: number): boolean {
    if (this.open_ !== name || this.generation !== generation || !r || ![r.x, r.y, r.width, r.height].every(Number.isFinite)) return false;
    const { width, height } = this.windowSize();
    const anchor = name === 'suggestions' ? this.anchors.suggestions : undefined;
    const x = Math.max(0, Math.min(width, Math.floor(r.x)));
    let y = Math.max(0, Math.min(height, Math.floor(r.y)));
    if (anchor && y + r.height > height && anchor.y > height - y) y = Math.max(0, Math.floor(anchor.y - r.height - 4));
    const w = Math.min(width - x, Math.ceil(r.width)), h = Math.min(height - y, Math.ceil(r.height));
    if (w > 0 && h > 0) {
      // The view is the card and nothing more, so every press beside it reaches what lies beneath.
      this.overlay.setBounds({ x, y, width: w, height: h });
      if (name !== 'suggestions') this.shadow({ x, y, width: w, height: h });
      return true;
    }
    return false;
  }

  setAnchors(anchors: Partial<Record<SurfaceName, Rect>>): void {
    if (!anchors || typeof anchors !== 'object') return;
    const safe: Partial<Record<SurfaceName, Rect>> = { contextMenu: this.anchors.contextMenu };
    for (const name of ['siteInfo', 'status', 'menu', 'suggestions', 'downloads', 'bookmarkEdit'] as const) {
      const r = anchors[name];
      if (r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0) safe[name] = r;
    }
    this.anchors = safe;
    if (this.open_ === 'suggestions' && !safe.suggestions) this.close(false);
    else if (this.open_) this.changed();
  }
}
