import { sidebarWidth } from '../../shared/layout.ts';
import { accentValue, themeValue, type Accent, type Theme } from '../../shared/appearance.ts';
// The browser: every window, and what they share (the gate's state, downloads, the notice, the
// tab layout, the application menu). Cave quits when its last window closes.
import { CertificateExceptions, certificateKey } from './certificates.ts';
import { EventEmitter } from 'node:events';
import { app, Menu, nativeTheme, type WebContents } from 'electron';
import { setLocale, systemLocale, t, type LocalePreference } from '../../shared/i18n/index.ts';
import { isCommand, type CommandId } from '../../shared/commands.ts';
import { isSearchEngine } from '../../shared/url.ts';
import type { SearchEngine, ShellState, TabLayout, Shortcut } from '../../shared/ipc.ts';
import { appMenu, bindCommands, type Commands } from './commands.ts';
import type { History, Bookmarks, SiteSettings, Sessions, Downloads as DownloadRepository } from '../store/index.ts';
import { Downloads } from './downloads.ts';
import { Navigator } from './navigation.ts';
import { localSuggestions } from './suggestions.ts';
import type { SessionSnapshot } from './session-snapshot.ts';
import type { FaviconFetcher } from './favicons.ts';
import { ShellWindow, type WindowHost } from './window.ts';

export interface BrowserOptions {
  sessions: Sessions;
  favicons: FaviconFetcher;
  restoreSession: boolean;
  saveRestoreSession: (enabled: boolean) => void;
  searchEngine: SearchEngine;
  saveSearchEngine: (engine: SearchEngine) => void;
  rendererDir: string;
  preload: string;
  downloadsDir: string;
  downloadStore: DownloadRepository;
  downloadFiles?: Pick<typeof import('electron').shell, 'openPath' | 'showItemInFolder'>;
  history: History;
  bookmarks: Bookmarks;
  siteSettings: SiteSettings;
  persistentSettings: boolean;
  shortcuts: () => Shortcut[];
  accent: Accent;
  theme: Theme;
  saveAccent: (accent: Accent) => void;
  saveTheme: (theme: Theme) => void;
  tabLayout: TabLayout;
  saveTabLayout: (layout: TabLayout) => void;
  sidebarWidth: number;
  saveSidebarWidth: (width: number) => void;
  locale: LocalePreference;
  saveLocale: (locale: LocalePreference) => void;
  prepareTab: (wc: WebContents) => void;
  canBrowse: () => boolean;
  gate: () => ShellState['gate'];
  /** First-run setup as derived from the profile and the gate. */
  setup: () => ShellState['setup'];
}

export class Browser extends EventEmitter {
  readonly windows: ShellWindow[] = [];
  readonly certificates = new CertificateExceptions();
  certificateRevoking = false;
  readonly downloads: Downloads;
  /** The window that last had the user's attention: where a menu command or a second launch goes. */
  private front: ShellWindow | null = null;
  private notice: string | (() => string) | null = null;
  private restoreSession: boolean;
  private searchEngine: SearchEngine;
  private accent: Accent;
  private theme: Theme;
  private tabLayout: TabLayout;
  private sidebarWidth: number;
  private localePreference: LocalePreference;
  private navigator: Navigator;
  private commands: Commands;
  private host: WindowHost;
  private quitting = false;
  private offeredSession: SessionSnapshot | null = null;
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionInterval: ReturnType<typeof setInterval>;

  constructor(private o: BrowserOptions) {
    super();
    this.restoreSession = o.restoreSession;
    this.searchEngine = o.searchEngine;
    this.accent = accentValue(o.accent);
    this.theme = themeValue(o.theme);
    nativeTheme.themeSource = this.theme;
    this.tabLayout = o.tabLayout;
    this.sidebarWidth = sidebarWidth(o.sidebarWidth);
    this.localePreference = o.locale;
    setLocale(this.locale);
    this.downloads = new Downloads(o.downloadsDir, () => this.broadcast(), o.downloadStore, o.downloadFiles);
    this.navigator = new Navigator(o.canBrowse, (wc, url) => {
      this.setNotice(() => t('navigationNotice', { host: new URL(url).host }));
      this.windows.find((w) => w.hasTab(wc))?.surfaces.open('status');
    });
    this.commands = bindCommands(() => this.newWindow().focusAddress());
    this.host = {
      bookmarkMatches: (url) => /^https?:\/\//i.test(url) ? o.bookmarks.find(url) : [],
      toggleBookmark: (win) => { const wc = win.current; const url = wc?.getURL(); if (!wc || !url || !/^https?:\/\//i.test(url)) return; if (!o.bookmarks.find(url).length) { o.bookmarks.add({ parent: null, kind: 'link', title: wc.getTitle().slice(0, 1024), url }); this.broadcast(); } else win.editBookmark(); },
      rendererDir: o.rendererDir,
      preload: o.preload,
      tabLayout: () => this.tabLayout,
      sidebarWidth: () => this.sidebarWidth,
      shared: () => ({ shortcuts: o.shortcuts().map(item => ({ ...item, favicon: o.favicons.get(item.url) })), gate: o.gate(), downloads: this.downloads.all(), notice: typeof this.notice === 'function' ? this.notice() : this.notice, locale: this.locale, localePreference: this.localePreference, accent: this.accent, theme: this.theme, searchEngine: this.searchEngine, restoreSession: this.restoreSession, setup: o.setup() }),
      canBrowse: o.canBrowse,
      run: (id, win) => this.run(id, win),
      prepareTab: o.prepareTab,
      suggest: (win, input) => {
        const tabs = [win, ...this.windows.filter(w => w !== win)].flatMap(w => w.suggestionTabs(win));
        return localSuggestions(input, tabs, o.bookmarks, o.history);
      },
      activateSuggestion: (target) => {
        const win = this.windows.find(w => w.win.id === target.windowId);
        return !!win && win.activateSuggestion(target);
      },
      hasCertificateException: (url) => { try { const u = new URL(url); return u.protocol === 'https:' && this.certificates.hasHost(u.hostname); } catch { return false; } },
      allowCertificate: (host, fingerprint) => { if (this.certificateRevoking) return false; this.certificates.add(host, fingerprint); return true; },
      permissionDecision: (origin, permission) => o.siteSettings.getPermission(origin, permission),
      savePermissions: (origin, permissions, decision) => { if (!o.persistentSettings) throw new Error('unavailable'); o.siteSettings.setPermissions(origin, permissions, decision); },
      getZoom: (origin) => o.siteSettings.getZoom(origin),
      setZoom: (origin, value) => { o.siteSettings.setZoom(origin, value); for (const w of this.windows) w.applyOriginZoom(origin, value); },
      favicon: (url) => o.favicons.get(url),
      fetchFavicon: (tab, url, icons) => o.favicons.load(tab.wc.session, url, icons),
      historyVisit: (url, title) => o.history.visit(url, title, false),
      historyTitle: (url, title) => o.history.setTitle(url, title),
      load: (wc, url) => this.navigator.load(wc, url),
      forget: (wc) => this.navigator.forget(wc),
      back: (wc) => this.navigator.back(wc),
      focused: (win) => { this.front = win; this.updateMenu(); },
      closedTabsChanged: () => this.updateMenu(),
      sessionChanged: () => this.scheduleSession(),
      sessionResume: () => { this.suppressSessionSave = false; },
      windowClosing: () => this.saveSession(),
      lastTabClosed: () => this.saveSession(true),
      closed: (win) => {
        this.windows.splice(this.windows.indexOf(win), 1);
        if (this.front === win) this.front = this.windows[0] ?? null;
        if (!this.windows.length) this.emit('closed');
      },
    };
    this.updateMenu();
    this.sessionInterval = setInterval(() => this.saveSession(), 5000);
  }

  private suppressSessionSave = false;

  private scheduleSession(): void {
    if (this.quitting || this.suppressSessionSave) return;
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    this.sessionTimer = setTimeout(() => { this.sessionTimer = null; this.saveSession(); }, 500);
  }

  saveSession(clearEmpty = false): void {
    if (this.quitting || this.offeredSession || this.suppressSessionSave) return;
    if (this.sessionTimer) { clearTimeout(this.sessionTimer); this.sessionTimer = null; }
    const windows = this.windows.map(w => w.sessionSnapshot()).filter(w => w !== null);
    if (windows.length) this.o.sessions.save({ version: 1, windows });
    else if (clearEmpty) this.o.sessions.discardSnapshots();
  }

  prepareQuit(): void { this.saveSession(); this.quitting = true; this.o.sessions.cleanQuit(this.restoreSession); }

  stopSessionSaving(): void { clearInterval(this.sessionInterval); if (this.sessionTimer) clearTimeout(this.sessionTimer); }

  private updateMenu(): void { Menu.setApplicationMenu(appMenu((id) => this.run(id), this.front?.canReopenTab ?? false)); }

  /** A new window with one tab. */
  newWindow(url?: string): ShellWindow {
    const win = new ShellWindow(this.host);
    this.windows.push(win);
    this.front = win;
    this.updateMenu();
    win.newTab(url);
    return win;
  }

  offerSession(snapshot: SessionSnapshot, win: ShellWindow): void {
    this.offeredSession = snapshot;
    win.surfaces.open('restoreSession');
    this.broadcast();
  }

  acceptSession(): void {
    const snapshot = this.offeredSession;
    if (!snapshot) return;
    this.offeredSession = null;
    const old = [...this.windows];
    this.restore(snapshot);
    for (const win of old) win.win.close();
  }

  discardSession(): void {
    if (!this.offeredSession) return;
    this.offeredSession = null;
    this.o.sessions.discardSnapshots();
    for (const win of this.windows) if (win.surfaces.state?.name === 'restoreSession') win.surfaces.close();
    this.broadcast();
  }

  restore(snapshot: SessionSnapshot): void {
    for (const saved of snapshot.windows) {
      const win = new ShellWindow(this.host);
      this.windows.push(win);
      this.front = win;
      win.restoreWindow(saved);
    }
    this.updateMenu();
  }

  get current(): ShellWindow | null {
    return this.front;
  }

  /** The window whose own page (chrome, settings, overlay) this is. */
  windowOf(wc: WebContents): ShellWindow | null {
    return this.windows.find((w) => w.isUi(wc)) ?? null;
  }

  invalidateCertificates(host?: string): void { for (const w of this.windows) w.invalidateCertificates(host); }

  certificateError(wc: WebContents, url: string, data: string, isMainFrame: boolean): boolean {
    if (this.certificateRevoking || !isMainFrame || wc.isDestroyed()) return false;
    const tab = this.windows.map(w => w.certificateTab(wc)).find(Boolean);
    const key = certificateKey(url, data);
    if (!tab || !key || !tab.recordCertificate(url, key.host, key.fingerprint)) return false;
    const accepted = this.certificates.has(key.host, key.fingerprint);
    if (accepted) tab.markCertificateAccepted();
    return accepted;
  }

  /** Runs a command by name in a window; a surface that is open there closes first. */
  run(id: CommandId, win: ShellWindow | null = this.front): void {
    if (!isCommand(id) || !win) return;
    if (win.inSetup && id !== 'app.quit' && id !== 'window.fullscreen') return;
    win.surfaces.close();
    this.commands[id](win);
  }

  broadcast(): void {
    for (const w of this.windows) w.broadcast();
  }

  /** Puts every window in setup or in the normal layout, as the derived step says; then tells the pages. */
  syncSetup(): void {
    const setup = this.o.setup().step !== 'normal';
    for (const w of this.windows) w.setSetup(setup);
    this.broadcast();
  }

  /** Called on every gate change. */
  gateChanged(open: boolean): void {
    if (open && this.navigator.release()) this.notice = null;
    this.broadcast();
  }

  setNotice(text: string | (() => string) | null): void {
    this.notice = text;
    this.broadcast();
  }

  private get locale() { return this.localePreference === 'system' ? systemLocale(process.env.CAVE_LANG || app.getLocale()) : this.localePreference; }

  setLocale(locale: LocalePreference): void {
    for (const w of this.windows) w.surfaces.close();
    this.localePreference = locale;
    this.o.saveLocale(locale);
    setLocale(this.locale);
    this.updateMenu();
    this.broadcast();
  }

  setRestoreSession(enabled: boolean): void {
    if (typeof enabled !== 'boolean') return;
    this.o.saveRestoreSession(enabled);
    this.restoreSession = enabled;
    this.broadcast();
  }

  setSearchEngine(value: unknown): boolean {
    if (!isSearchEngine(value)) return false;
    const engine: SearchEngine = value.kind === 'custom' ? { kind: 'custom', template: value.template } : { kind: value.kind };
    try { this.o.saveSearchEngine(engine); } catch { return false; }
    this.searchEngine = engine;
    this.broadcast();
    return true;
  }

  setAccent(value: unknown): void {
    this.accent = accentValue(value);
    this.o.saveAccent(this.accent);
    this.broadcast();
  }

  setTheme(value: unknown): void {
    this.theme = themeValue(value);
    this.o.saveTheme(this.theme);
    nativeTheme.themeSource = this.theme;
    this.broadcast();
  }

  setSidebarWidth(value: number): void {
    this.sidebarWidth = sidebarWidth(value);
    this.o.saveSidebarWidth(this.sidebarWidth);
    for (const w of this.windows) w.layout();
    this.broadcast();
  }

  setTabLayout(layout: TabLayout): void {
    this.tabLayout = layout;
    this.o.saveTabLayout(layout);
    for (const w of this.windows) w.layout();
    this.broadcast();
  }

  cancelPermissions(): void { for (const w of this.windows) w.cancelAllPermissions(); }

  clearOriginSettings(origin: string): void {
    this.o.siteSettings.clearOrigin(origin);
    for (const w of this.windows) w.applyOriginZoom(origin, 100);
  }

  reloadOrigin(origin: string): void {
    for (const w of this.windows) w.reloadOrigin(origin);
  }

  clearHistoryMemory(): void {
    this.discardSession();
    this.o.sessions.clear();
    for (const w of this.windows) w.clearClosedTabs();
    this.suppressSessionSave = true;
    if (this.sessionTimer) { clearTimeout(this.sessionTimer); this.sessionTimer = null; }
  }

  clearFavicons(origin?: string): void { for (const w of this.windows) w.clearFavicons(origin); }

  reloadWebTabs(): void { for (const w of this.windows) w.reloadWebTabs(); }

  /** A clean slate after a full reset, in every window. */
  reset(): void {
    this.discardSession();
    this.downloads.clear();
    for (const w of this.windows) w.resetTabs();
  }
}
