import { certificateFailure, failureKind } from './recovery.ts';
import { t } from '../../shared/i18n/index.ts';
import { NavigationFailures } from '../../shared/navigation-safety.ts';
// One tab: a page in its own view, and what the chrome shows about it. A tab does not know
// which window it is in; the window that holds it is its host and hears what happens to it.
import { WebContentsView, type BrowserWindowConstructorOptions, type WebContents } from 'electron';
import { browserSession } from '../network.ts';
import type { CertificateDetails, TabState } from '../../shared/ipc.ts';

/** The only schemes a web tab may show; never file:, so no tab can load the shell's own pages. */
export const WEB = /^(https?|about|blob|data):/i;

export const originOf = (url: string): string => (URL.canParse(url) ? new URL(url).origin : '');

export interface TabHost {
  gateState(): string;
  favicon(url: string): string | null;
  fetchFavicon(tab: Tab, url: string, icons: string[]): Promise<string | null>;
  hasCertificateException(url: string): boolean;
  historyVisit(url: string, title: string): void;
  historyTitle(url: string, title: string): void;
  changed(tab: Tab): void;
  closed(tab: Tab): void;
  focused(tab: Tab): void;
  outsidePress(): void;
  escapeSurface(): void;
  found(tab: Tab, result: Electron.Result): void;
  /** A page asked for a new window: it becomes a tab, and the page keeps its opener. */
  opened(wc: WebContents, foreground: boolean): WebContents;
  navigated(tab: Tab): void;
  findNavigation(tab: Tab): void;
  committed(tab: Tab, url: string): void;
  contextMenu(tab: Tab, params: Electron.ContextMenuParams): void;
}

export class Tab {
  readonly id: number;
  pinned = false;
  saved: { url: string; title: string; started: boolean } | null = null;
  host: TabHost | null = null;
  /** The main frame's last load failed, and nothing has been loaded since. */
  private error: TabState['error'] = null;
  private crashed = false;
  private favicon: string | null = null;
  private certificate: { url: string; details: CertificateDetails } | null = null;
  get certificateDetails(): CertificateDetails | null { return !this.error && this.certificate?.url === this.wc.getURL() ? this.certificate.details : null; }
  private insecure = false;
  private certificateAccepted = false;
  private generation = 0;
  private target = '';
  retryPending = false;
  private challenge: { generation: number; url: string; host: string; fingerprint: string } | null = null;

  recordCertificate(url: string, host: string, fingerprint: string): boolean {
    if (this.kind !== 'web' || this.wc.isDestroyed() || this.target !== url || this.error || this.crashed) return false;
    this.challenge = { generation: this.generation, url, host, fingerprint };
    return true;
  }

  takeCertificate(generation: number): { host: string; fingerprint: string } | null {
    const c = this.challenge;
    if (!c || c.generation !== generation || this.generation !== generation || this.error?.kind !== 'certificate' || this.error.url !== c.url) return null;
    this.challenge = null;
    return c;
  }

  invalidateCertificate(host?: string): void { if (!host || this.challenge?.host === host) this.challenge = null; }

  markCertificateAccepted(): void { this.certificateAccepted = true; }

  get canContinueCertificate(): boolean { return !!this.challenge && this.challenge.generation === this.generation && this.error?.url === this.challenge.url; }

  get recoveryTarget(): string { return this.error?.url || this.target; }
  get recoveryGeneration(): number { return this.generation; }

  invalidateRecovery(): void {
    if (!this.error && !this.crashed) return;
    this.generation++;
    this.challenge = null;
    if (this.error) this.error = { ...this.error, generation: this.generation };
  }

  private constructor(readonly kind: TabState['kind'], readonly view: WebContentsView) {
    this.id = view.webContents.id;
    view.webContents.on('before-input-event', (_event, input) => { if (input.type === 'keyDown' && input.key === 'Escape') this.host?.escapeSurface(); });
    view.webContents.on('focus', () => this.host?.focused(this));
    view.webContents.on('context-menu', (_e, p) => this.host?.contextMenu(this, p));
    view.webContents.on('before-mouse-event', (_event, mouse) => { if (mouse.type === 'mouseDown') { this.host?.outsidePress(); this.host?.focused(this); } });
  }

  /** A web tab in the isolated browsing session; `adopt` is the page a window.open() already made. */
  static web(prepare: (wc: WebContents) => void, adopt?: WebContents): Tab {
    const view = new WebContentsView({
      webPreferences: {
        session: browserSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webviewTag: false,
        plugins: true,
        spellcheck: false,
        // A page that loads something does not take the keyboard: the user may be typing in the address bar.
        focusOnNavigation: false,
      },
      ...(adopt && { webContents: adopt }),
    });
    view.webContents.setZoomMode('isolated');
    prepare(view.webContents);
    const tab = new Tab('web', view);
    tab.wire();
    // A webContents that never navigated has no history entry; give every new tab one.
    if (!adopt) void view.webContents.loadURL('about:blank').catch(() => undefined);
    return tab;
  }

  /** The settings page shown as a tab; its view belongs to the window and outlives the tab. */
  static settings(view: WebContentsView): Tab {
    return new Tab('settings', view);
  }

  static bookmarks(view: WebContentsView): Tab { return new Tab('bookmarks', view); }

  static history(view: WebContentsView): Tab { return new Tab('history', view); }

  get wc(): WebContents {
    return this.view.webContents;
  }

  get state(): TabState {
    const { id, kind, wc } = this;
    const none = { favicon: null, muted: false, pinned: this.pinned, loading: false, canBack: false, canForward: false, audible: false, crashed: false, insecure: false, error: null };
    if (kind === 'bookmarks') return { id, kind, title: t('command_bookmarks_open'), url: '', ...none };
    if (kind === 'history') return { id, kind, title: t('command_history_open'), url: '', ...none };
    if (kind === 'settings') return { id, kind, title: t('settings'), url: '', ...none };
    const url = (this.error || this.crashed) ? this.recoveryTarget : this.saved?.url || wc.getURL();
    return {
      id,
      kind,
      title: !url || url === 'about:blank' ? t('newTab') : (this.saved?.title || (this.error || this.crashed ? url : wc.getTitle() || url)),
      url: url === 'about:blank' ? '' : url,
      favicon: this.error || this.crashed ? null : this.favicon,
      loading: wc.isLoading(),
      canBack: wc.navigationHistory.canGoBack(),
      canForward: wc.navigationHistory.canGoForward(),
      audible: wc.isCurrentlyAudible(),
      pinned: this.pinned,
      muted: wc.isAudioMuted(),
      crashed: this.crashed,
      insecure: this.insecure,
      error: this.error,
    };
  }

  clearFavicon(origin?: string): void { if (!origin || originOf(this.wc.getURL()) === origin) this.favicon = null; }

  close(): void {
    if (!this.wc.isDestroyed()) this.wc.close(); // 'destroyed' then tells the host
  }

  private wire(): void {
    const wc = this.wc;
    const changed = () => this.host?.changed(this);
    const failures = new NavigationFailures();
    // Chromium supplies the TLS metadata with the document response; this observes existing
    // traffic on the already attached debugger and never creates a request.
    let mainFrame = '';
    let pending: { frameId: string; url: string; details: CertificateDetails | null } | null = null;
    const accept = () => {
      if (pending && pending.frameId === mainFrame && pending.url === this.target) this.certificate = pending.details ? { url: pending.url, details: pending.details } : null;
    };
    wc.debugger.on('message', (_event, method, params: any, sessionId) => {
      if (sessionId) return;
      if (method === 'Page.frameNavigated' && !params.frame.parentId) { mainFrame = params.frame.id; accept(); }
      if (method !== 'Network.responseReceived' || params.type !== 'Document' || params.response.url !== this.target) return;
      const d = params.response.securityDetails;
      pending = { frameId: params.frameId, url: params.response.url, details: d ? { subject: d.subjectName, issuer: d.issuer, validFrom: new Date(d.validFrom * 1000).toISOString(), validTo: new Date(d.validTo * 1000).toISOString() } : null };
      accept();
    });
    void wc.debugger.sendCommand('Page.enable').catch(() => undefined);
    void wc.debugger.sendCommand('Network.enable').catch(() => undefined);
    for (const e of ['page-title-updated', 'did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'audio-state-changed'] as const) wc.on(e as any, changed);
    wc.on('page-favicon-updated', (_event, icons) => {
      const url = wc.getURL(), generation = this.generation;
      void this.host?.fetchFavicon(this, url, icons).then(icon => { if (icon && generation === this.generation && wc.getURL() === url) { this.favicon = icon; changed(); } });
    });
    wc.on('did-finish-load', () => this.host?.committed(this, wc.getURL()));
    wc.on('did-navigate', (_event, url) => { this.insecure = this.certificateAccepted || (this.host?.hasCertificateException(url) ?? false); this.host?.committed(this, url); if (/^https?:/i.test(url)) this.host?.historyVisit(url, wc.getTitle()); });
    wc.on('page-title-updated', (_event, title) => { const url = wc.getURL(); if (/^https?:/i.test(url)) this.host?.historyTitle(url, title); });
    wc.on('did-start-navigation', (e) => {
      if (e.isMainFrame) this.host?.navigated(this);
      // Chromium's own error document is the failure being shown, not a new attempt.
      if (!e.isMainFrame || e.isSameDocument || e.url.startsWith('chrome-error:')) return;
      this.host?.findNavigation(this);
      this.retryPending = false;
      failures.start(e.url);
      if (/^https?:/i.test(e.url)) this.saved = null;
      this.favicon = this.host?.favicon(e.url) ?? null;
      this.target = e.url;
      this.certificate = null;
      pending = null;
      this.certificateAccepted = false;
      this.insecure = false;
      this.challenge = null;
      this.generation++;
      this.error = null;
      this.crashed = false;
      changed();
    });
    wc.on('did-redirect-navigation', (e) => { if (e.isMainFrame) this.host?.navigated(this); if (e.isMainFrame && !e.isSameDocument) { failures.redirect(e.url); this.target = e.url; this.certificateAccepted = false; this.challenge = null; } });
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3 || !failures.accepts(url)) return; // -3: aborted, by the user or by another navigation
      this.retryPending = false;
      this.error = { code, description, url, kind: certificateFailure(code) ? 'certificate' : failureKind(this.host?.gateState() ?? 'closed'), generation: this.generation };
      changed();
    });
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return;
      this.crashed = true;
      this.generation++;
      changed();
    });
    wc.on('found-in-page', (_e, r) => this.host?.found(this, r));
    wc.setWindowOpenHandler(({ disposition, url }) => ({
      action: this.host && WEB.test(url) ? 'allow' : 'deny',
      overrideBrowserWindowOptions: { webPreferences: { focusOnNavigation: false } },
      createWindow: (options: BrowserWindowConstructorOptions & { webContents?: WebContents }) =>
        this.host!.opened(options.webContents!, disposition !== 'background-tab'),
    }));
    wc.on('will-frame-navigate', (e) => {
      if (!WEB.test(e.url)) e.preventDefault();
    });
    wc.on('destroyed', () => this.host?.closed(this));
  }
}
