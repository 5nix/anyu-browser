import { trustworthyPermissionOrigin } from './permission-origin.ts';
// One browser window. Its chrome page fills it and draws the tab strip and toolbar (on top) or
// the sidebar (on the left); the active tab, or the settings page as a tab of its own, sits
// over the rest; the overlay page comes on top while a surface is open (surfaces.ts).
import { BaseWindow, BrowserWindow, View, WebContentsView, nativeTheme, clipboard, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import type { SavedTab, SavedWindow } from './session-snapshot.ts';
import { ClosedTabs } from './closed-tabs.ts';
import { moveOrder, pinOrder } from './tab-order.ts';
import { join } from 'node:path';
import { zoomOrigin, zoomStep } from '../../shared/zoom.ts';
import { t } from '../../shared/i18n/index.ts';
import { toUrl } from '../../shared/url.ts';
import { FRAME, METRICS, SETUP_CAPTION, captionHeight, pageBounds, setupTrafficLights } from '../../shared/layout.ts';
import { channel, type CaveEvents, type SettingsSection, type ShellState, type TabLayout, type MenuEntry, type Rect, type SurfaceName, type Permission } from '../../shared/ipc.ts';
import { mac, titleBar, trafficLightPosition } from '../platform.ts';
import { addressMenu, pageMenu, tabMenu, toolbarMenu, validWeb } from './context-menu.ts';
import { type CommandId } from '../../shared/commands.ts';
import type { LocalSuggestion, LocalTab } from './suggestions.ts';
import type { AddressQueryResult } from '../../shared/ipc.ts';
import { PermissionQueue } from '../permission-queue.ts';
import { Surfaces } from './surfaces.ts';
import { displayFailureUrl } from './recovery.ts';
import { Tab, WEB, originOf, type TabHost } from './tab.ts';

const backgroundE2e = process.env.CAVE_E2E_BACKGROUND === '1';
const theme = () => (nativeTheme.shouldUseDarkColors ? FRAME.dark : FRAME.light);

/** What a window needs from the browser it belongs to. */
export interface WindowHost {
  bookmarkMatches(url: string): import('../../shared/ipc.ts').Bookmark[];
  toggleBookmark(win: ShellWindow): void;
  suggest(win: ShellWindow, input: string): { items: LocalSuggestion[]; unavailable: boolean };
  activateSuggestion(target: LocalTab): boolean;
  favicon(url: string): string | null;
  fetchFavicon(tab: Tab, url: string, icons: string[]): Promise<string | null>;
  historyVisit(url: string, title: string): void;
  historyTitle(url: string, title: string): void;
  rendererDir: string;
  preload: string;
  tabLayout(): TabLayout;
  sidebarWidth(): number;
  /** The part of the state that is the same in every window. */
  shared(): Pick<ShellState, 'shortcuts' | 'gate' | 'downloads' | 'notice' | 'locale' | 'localePreference' | 'accent' | 'theme' | 'searchEngine' | 'restoreSession' | 'setup'>;
  canBrowse(): boolean;
  run(id: CommandId, win: ShellWindow): void;
  prepareTab(wc: WebContents): void;
  allowCertificate(host: string, fingerprint: string): boolean;
  hasCertificateException(url: string): boolean;
  permissionDecision(origin: string, permission: Permission): 'allow' | 'deny' | null;
  savePermissions(origin: string, permissions: Permission[], decision: 'allow' | 'deny'): void;
  getZoom(origin: string): number;
  setZoom(origin: string, value: number): void;
  load(wc: WebContents, url: string): void;
  forget(wc: WebContents): void;
  back(wc: WebContents): void;
  focused(win: ShellWindow): void;
  closedTabsChanged(): void;
  sessionChanged(): void;
  sessionResume(): void;
  windowClosing(): void;
  lastTabClosed(): void;
  closed(win: ShellWindow): void;
}

type AuthCredentials = { username: string; password: string };
type Prompt = { kind: 'permission'; id: string; wc: WebContents; key: string; origin: string; permissions: Permission[]; valid: () => boolean; error: boolean } | { kind: 'auth'; id: string; wc: WebContents; key: string; origin: string; realm: string; error: boolean };

export class ShellWindow implements TabHost {
  readonly win: BaseWindow;
  readonly chrome: WebContentsView;
  readonly settings: WebContentsView;
  /** First-run setup. It replaces `root` in the window: while it is shown, nothing of the browser is attached. */
  readonly welcome: WebContentsView;
  /** Holds every browser view (chrome, pages, overlay). Detached as a whole during setup, so no
   *  browser view can be shown, focused or clicked then, whatever adds itself to it meanwhile. */
  private readonly root = new View();
  private setup = false;
  get inSetup(): boolean { return this.setup; }
  readonly history: WebContentsView;
  readonly bookmarks: WebContentsView;
  readonly overlay: WebContentsView;
  /** Paints the open card's shadow. It ignores the mouse, so the shadow can never take a press. */
  private shadow: BrowserWindow;
  private shadowCard: Rect | null = null;
  private shadowHide: ReturnType<typeof setTimeout> | null = null;
  readonly recovery: WebContentsView;
  private recoveryVisible = false;
  readonly surfaces: Surfaces;
  private addressSession: { session: string; initial: string; tab: number | null; sequence: number; items: LocalSuggestion[]; unavailable: boolean; active: number } | null = null;
  private keepingAddress = false;
  private suggestionPress = false;
  private pendingAddressCancel: ReturnType<typeof setTimeout> | null = null;
  private cancelAfterSuggestionPress: (() => void) | null = null;
  private generations = new Map<number, number>();
  private settingsTab: Tab;
  private historyTab: Tab;
  private bookmarksTab: Tab;
  private tabs: Tab[] = [];
  private closedTabs = new ClosedTabs();
  get canReopenTab(): boolean { return this.closedTabs.available; }
  private homes = new Map<number, WebContentsView>();
  private visibleHome: number | null = null;
  private active: number | null = null;
  private zoomError = false;
  private findRequest: { tab: Tab; text: string; requestId: number } | null = null;
  /** The web tab most recently in front: "this site" for the settings page. */
  private lastWeb: number | null = null;
  /** Which of the window's pages has the keyboard. */
  private focus: ShellState['focus'] = 'chrome';
  private closingPermission = false;
  private permissionQueue = new PermissionQueue<Prompt, boolean | AuthCredentials>();
  private get permission() { const p = this.permissionQueue.head; return p?.kind === 'permission' ? p : null; }
  private get auth() { const p = this.permissionQueue.head; return p?.kind === 'auth' ? p : null; }
  private suppressed = new Map<WebContents, Set<string>>();
  private bookmarkTarget: { tab: number | null; url: string } | null = null;
  private closing = false;
  private resetting = false;
  /** Height of the Windows/Linux caption-button band; it follows the tab layout. */
  private caption = 0;
  private menu: { token: string; items: MenuEntry[]; kind: 'toolbar' | 'tab' | 'page' | 'address' | 'shortcut'; tab?: Tab; params?: Electron.ContextMenuParams; shortcutId?: number; pageContents?: WebContents } | null = null;

  constructor(private host: WindowHost) {
    const t = theme();
    this.win = new BaseWindow({
      width: 1280,
      height: 860,
      minWidth: 720,
      minHeight: 480,
      title: 'Anyu',
      backgroundColor: t.frame,
      show: false,
      // Off-screen keeps a test window off the desktop on macOS, which still draws it; elsewhere
      // an off-screen window is occluded and its pages turn hidden.
      ...(backgroundE2e && mac ? { x: -32000, y: -32000 } : {}),
      autoHideMenuBar: false,
      ...titleBar(t.frame, t.symbol, host.tabLayout()),
    });
    if (!mac) this.win.setMenuBarVisibility(false);
    const ui = { preload: host.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false };
    this.chrome = new WebContentsView({ webPreferences: ui });
    this.settings = new WebContentsView({ webPreferences: ui });
    this.welcome = new WebContentsView({ webPreferences: ui });
    this.history = new WebContentsView({ webPreferences: ui });
    this.bookmarks = new WebContentsView({ webPreferences: ui });
    this.overlay = new WebContentsView({ webPreferences: { ...ui, backgroundThrottling: false } });
    this.recovery = new WebContentsView({ webPreferences: { ...ui, focusOnNavigation: false } });
    this.recovery.webContents.on('focus', () => this.focused());
    this.recovery.webContents.on('before-mouse-event', (_event, mouse) => { if (mouse.type === 'mouseDown') { this.outsidePress(); this.focused(); } });
    this.overlay.setBackgroundColor('#00000000');
    this.shadow = new BrowserWindow({ parent: this.win, show: false, frame: false, transparent: true, hasShadow: false, focusable: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, roundedCorners: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    this.shadow.setIgnoreMouseEvents(true);
    this.shadow.webContents.on('will-navigate', (e) => e.preventDefault());
    this.shadow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    void this.shadow.loadFile(join(host.rendererDir, 'shadow.html'));
    for (const [v, page] of [[this.chrome, 'shell.html'], [this.settings, 'settings.html'], [this.welcome, 'welcome.html'], [this.history, 'history.html'], [this.bookmarks, 'bookmarks.html'], [this.overlay, 'overlay.html'], [this.recovery, 'internal-error.html']] as const) {
      // The shell's own pages never navigate anywhere and never open windows.
      v.webContents.on('will-navigate', (e) => e.preventDefault());
      v.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      void v.webContents.loadFile(join(host.rendererDir, page));
    }
    this.chrome.webContents.on('before-input-event', (_event, input) => { if (input.type === 'keyDown' && input.key === 'Escape') this.escapeSurface(); });
    this.chrome.webContents.on('focus', () => this.setFocus('chrome'));
    this.chrome.webContents.on('before-mouse-event', (_event, mouse) => {
      if (mouse.type !== 'mouseDown') return;
      const anchor = this.surfaces.anchor('suggestions');
      if (this.addressSession && (!anchor || mouse.x < anchor.x || mouse.x >= anchor.x + anchor.width || mouse.y < anchor.y || mouse.y >= anchor.y + anchor.height)) this.send(this.chrome, 'cancelAddressEdit');
      this.surfaces.outsidePress(mouse.x, mouse.y);
    });
    this.overlay.webContents.on('focus', () => this.setFocus('overlay'));
    this.overlay.webContents.on('before-mouse-event', (_event, mouse) => {
      if (this.surfaces.state?.name !== 'suggestions') return;
      if (mouse.type === 'mouseDown') {
        this.suggestionPress = true;
        if (this.pendingAddressCancel) { clearTimeout(this.pendingAddressCancel); this.pendingAddressCancel = null; }
      } else if (mouse.type === 'mouseUp') {
        this.suggestionPress = false;
        if (this.cancelAfterSuggestionPress) this.pendingAddressCancel = setTimeout(this.cancelAfterSuggestionPress, 100);
      }
    });
    this.settingsTab = Tab.settings(this.settings);
    this.settingsTab.host = this;
    this.historyTab = Tab.history(this.history);
    this.historyTab.host = this;
    this.bookmarksTab = Tab.bookmarks(this.bookmarks);
    this.bookmarksTab.host = this;
    this.surfaces = new Surfaces(
      this.root,
      this.overlay,
      () => [this.chrome.webContents, this.recovery.webContents, ...this.tabs.map((tab) => tab.wc)].find((wc) => wc.isFocused()) ?? null,
      () => this.broadcast(),
      () => { if (!this.closingPermission) { if (this.auth) this.cancelAuth(); else this.cancelPermission(); } this.menu = null; if (!this.keepingAddress) this.addressSession = null; },
      () => this.focusPage(),
      () => this.win.getContentBounds(),
      (card) => this.castShadow(card),
    );
    this.paint();
    nativeTheme.on('updated', this.paint);
    this.root.addChildView(this.chrome);
    this.root.addChildView(this.overlay);
    this.setup = this.host.shared().setup.step !== 'normal';
    this.win.contentView.addChildView(this.setup ? this.welcome : this.root);
    this.win.on('resize', () => this.layout());
    this.win.on('move', () => this.castShadow(this.shadowCard));
    this.win.on('focus', () => host.focused(this));
    this.win.on('blur', () => { const hadAddress = !!this.addressSession; this.addressSession = null; if (hadAddress && !this.surfaces.state) this.broadcast(); if (this.surfaces.state?.name !== 'httpAuth' && this.surfaces.state?.name !== 'restoreSession') this.surfaces.close(false); });
    this.win.on('close', () => { host.windowClosing(); this.closing = true; this.permissionQueue.clear(); });
    this.win.on('closed', () => {
      nativeTheme.off('updated', this.paint);
      if (this.shadowHide) clearTimeout(this.shadowHide);
      if (!this.shadow.isDestroyed()) this.shadow.destroy();
      for (const wc of [...this.tabs.map((tab) => tab.wc), ...this.ui.map((v) => v.webContents)]) {
        host.forget(wc);
        if (!wc.isDestroyed()) wc.close();
      }
      host.closed(this);
    });
    this.chrome.webContents.once('did-finish-load', () => { if (backgroundE2e) this.win.showInactive(); else this.win.show(); });
    this.layout();
  }

  /** Window and view backgrounds follow the system theme, so nothing flashes white in dark mode. */
  private paint = (): void => {
    const t = theme();
    this.win.setBackgroundColor(t.frame);
    if (!mac) this.win.setTitleBarOverlay({ color: t.frame, symbolColor: t.symbol, height: captionHeight(this.host.tabLayout()) });
    this.chrome.setBackgroundColor(t.frame);
    this.settings.setBackgroundColor(t.frame);
    this.welcome.setBackgroundColor(t.surface);
  };

  get state(): ShellState {
    const web = this.tabs.find((t) => t.id === this.lastWeb);
    return {
      ...this.host.shared(),
      bookmarked: !!this.current && this.host.bookmarkMatches(this.current.getURL()).length > 0,
      bookmarkMatches: this.current ? this.host.bookmarkMatches(this.current.getURL()) : [],
      tabs: this.tabs.map((t) => t.state),
      recovery: this.recoveryState,
      active: this.active,
      zoom: this.zoomValue,
      zoomError: this.zoomError,
      site: web ? originOf(web.wc.getURL()) : '',
      tabLayout: this.host.tabLayout(),
      sidebarWidth: this.host.sidebarWidth(),
      surface: this.surfaces.state,
      address: this.addressSession && { session: this.addressSession.session, initial: this.addressSession.initial },
      httpAuthPrompt: this.auth && { id: this.auth.id, origin: this.auth.origin, realm: this.auth.realm, error: this.auth.error },
      permissionPrompt: this.permission && { id: this.permission.id, origin: this.permission.origin, permissions: this.permission.permissions, error: this.permission.error },
      contextMenu: this.menu && { token: this.menu.token, items: this.menu.items },
      focus: this.focus,
      trafficLightPosition: mac ? (this.setup ? setupTrafficLights() : trafficLightPosition(this.host.tabLayout())) : null,
    };
  }

  private get recoveryState(): ShellState['recovery'] {
    const tab = this.tabs.find((t) => t.id === this.active && t.kind === 'web');
    if (!tab) return null;
    const state = tab.state;
    if (!state.crashed && !state.error) return null;
    const target = tab.recoveryTarget;
    return { tabId: tab.id, generation: tab.recoveryGeneration, kind: state.crashed ? 'crash' : state.error!.kind, displayUrl: displayFailureUrl(target), code: state.crashed ? null : state.error!.code, canRetry: !tab.retryPending && WEB.test(target) && target !== 'about:blank', canContinue: !tab.retryPending && tab.canContinueCertificate };
  }

  retryTab(id: number, generation: number): void {
    const recovery = this.recoveryState;
    const tab = this.tabs.find((t) => t.id === id);
    if (!recovery || recovery.tabId !== id || recovery.generation !== generation || !recovery.canRetry || !tab) return;
    tab.retryPending = true;
    this.host.load(tab.wc, tab.recoveryTarget);
    this.broadcast();
  }

  backFromError(id: number, generation: number): void {
    const recovery = this.recoveryState;
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab || recovery?.tabId !== id || recovery.generation !== generation || recovery.kind !== 'certificate') return;
    this.host.forget(tab.wc);
    this.host.back(tab.wc);
  }

  invalidateCertificates(host?: string): void { for (const tab of this.tabs) tab.invalidateCertificate(host); this.broadcast(); }

  certificateTab(wc: WebContents): Tab | undefined { return this.tabs.find(t => t.kind === 'web' && t.wc === wc); }

  continueCertificate(id: number, generation: number): void {
    const recovery = this.recoveryState;
    const tab = this.tabs.find(t => t.id === id);
    if (!tab || recovery?.tabId !== id || recovery.generation !== generation || recovery.kind !== 'certificate' || !recovery.canContinue) return;
    const challenge = tab.takeCertificate(generation);
    if (!challenge) return;
    if (!this.host.allowCertificate(challenge.host, challenge.fingerprint)) return;
    this.retryTab(id, generation);
  }

  recoveryStatus(id: number, generation: number): void {
    const recovery = this.recoveryState;
    if (recovery?.tabId === id && recovery.generation === generation && recovery.kind === 'gate') this.surfaces.open('status');
  }

  reload(hard = false): void {
    const recovery = this.recoveryState;
    if (recovery) this.retryTab(recovery.tabId, recovery.generation);
    else if (hard) this.current?.reloadIgnoringCache(); else this.current?.reload();
  }

  gateState(): string { return this.host.shared().gate.state; }
  hasCertificateException(url: string): boolean { return this.host.hasCertificateException(url); }

  /** The shell's own pages in this window. */
  private get ui(): WebContentsView[] {
    return [this.chrome, this.settings, this.welcome, this.history, this.bookmarks, this.overlay, this.recovery, ...this.homes.values()];
  }

  isUi(wc: WebContents): boolean {
    return this.ui.some((v) => v.webContents === wc);
  }

  requestHttpAuth(wc: WebContents, details: Electron.AuthenticationResponseDetails, info: Electron.AuthInfo, callback: (username?: string, password?: string) => void): void {
    const tab = this.tabs.find(t => t.kind === 'web' && t.wc === wc && t.id === this.active);
    let origin = '';
    try {
      const url = new URL(details.url);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && url.hostname.toLowerCase() === info.host.toLowerCase() && Number(url.port || (url.protocol === 'https:' ? 443 : 80)) === info.port) origin = url.origin;
    } catch {}
    if (!tab || !details.isRequestForNavigation || !wc.isLoadingMainFrame() || tab.recoveryTarget !== details.url || !origin) return callback();
    const item: Prompt = { kind: 'auth', id: randomUUID(), wc, key: randomUUID(), origin, realm: info.realm.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 256), error: false };
    const empty = !this.permissionQueue.head;
    if (empty && this.surfaces.state) this.surfaces.close(false);
    this.permissionQueue.enqueue(item, result => { if (typeof result === 'object') callback(result.username, result.password); else callback(); });
    if (empty) this.showPermission();
  }

  respondHttpAuth(id: string, credentials: AuthCredentials | null): void {
    const p = this.auth;
    if (!p || p.id !== id || this.surfaces.state?.name !== 'httpAuth') return;
    if (credentials !== null && (!credentials || typeof credentials.username !== 'string' || typeof credentials.password !== 'string' || credentials.username.length > 1024 || credentials.password.length > 1024)) { p.error = true; this.broadcast(); return; }
    this.permissionQueue.finish(p, credentials ?? false);
    this.closePermissionSurface(true);
    this.showPermission();
  }

  private cancelAuth(): void {
    const p = this.auth;
    if (!p) return;
    this.permissionQueue.finish(p, false);
    queueMicrotask(() => this.showPermission());
  }

  requestPermission(wc: WebContents, permission: string, details: Electron.PermissionRequest, callback: (allow: boolean) => void, profile: () => import('../../shared/profile.ts').Profile, startup: import('../../shared/profile.ts').Profile): void {
    const tab = this.tabs.find(t => t.wc === wc && t.kind === 'web' && t.id === this.active);
    const media = details as Electron.MediaAccessPermissionRequest;
    const types = permission === 'media' ? media.mediaTypes : undefined;
    const permissions: Permission[] = permission === 'media' ? (types && types.length && types.every(t => t === 'audio' || t === 'video') ? [...new Set(types.map(t => t === 'audio' ? 'media-microphone' as const : 'media-camera' as const))] : []) : ['geolocation', 'notifications', 'clipboard-read'].includes(permission) ? [permission as Permission] : [];
    let origin = '';
    try { const url = new URL(details.requestingUrl); if (trustworthyPermissionOrigin(url)) origin = url.origin; } catch {}
    const valid = () => {
      if (!tab || this.active !== tab.id || wc.isDestroyed() || !details.isMainFrame || !origin) return false;
      try { if (new URL(wc.getURL()).origin !== origin || (media.securityOrigin && new URL(media.securityOrigin).origin !== origin)) return false; } catch { return false; }
      const current = profile();
      if (permissions.includes('notifications') && !current.notifications) return false;
      if (permissions.includes('geolocation') && (!startup.geolocation || !current.geolocation || JSON.stringify(startup.geolocation) !== JSON.stringify(current.geolocation))) return false;
      return true;
    };
    if (!permissions.length || permissions.some(p => this.suppressed.get(wc)?.has(`${origin}:${p}`))) return callback(false);
    if (!valid()) return callback(false);
    const decisions = permissions.map(p => this.host.permissionDecision(origin, p));
    if (decisions.includes('deny')) return callback(false);
    if (decisions.every(d => d === 'allow')) return callback(true);
    const item = { kind: 'permission' as const, error: false, id: randomUUID(), wc, key: `${origin}:${[...permissions].sort().join(',')}`, origin, permissions, valid };
    const wasEmpty = !this.permissionQueue.head;
    if (wasEmpty && this.surfaces.state) this.surfaces.close(false);
    this.permissionQueue.enqueue(item, result => callback(result === true));
    if (wasEmpty) this.showPermission();
  }

  respondPermission(id: string, decision: 'once' | 'allow' | 'deny'): void {
    const p = this.permission;
    if (!p || p.id !== id || (decision !== 'once' && decision !== 'allow' && decision !== 'deny')) return;
    if (!p.valid() || p.permissions.some(item => this.host.permissionDecision(p.origin, item) === 'deny')) { this.finishPermission(false); this.closePermissionSurface(); this.showPermission(); return; }
    if (decision !== 'once') { try { this.host.savePermissions(p.origin, p.permissions, decision); } catch { p.error = true; this.broadcast(); return; } }
    const allow = decision !== 'deny';
    this.finishPermission(allow);
    this.closePermissionSurface(true);
    this.showPermission();
  }

  private finishPermission(allow: boolean): void {
    const p = this.permission;
    if (!p) return;
    if (!allow) { const set = this.suppressed.get(p.wc) ?? new Set<string>(); for (const item of p.permissions) set.add(`${p.origin}:${item}`); this.suppressed.set(p.wc, set); }
    this.permissionQueue.finish(p, allow);
  }

  checkPermission(wc: WebContents, permission: string, requestingOrigin: string, details: Electron.PermissionCheckHandlerHandlerDetails, profile: () => import('../../shared/profile.ts').Profile, startup: import('../../shared/profile.ts').Profile): boolean {
    const tab = this.tabs.find(t => t.wc === wc && t.kind === 'web' && t.id === this.active);
    if (!tab || wc.isDestroyed() || !details.isMainFrame || !details.requestingUrl) return false;
    let origin: string;
    try {
      const url = new URL(details.requestingUrl);
      if (!trustworthyPermissionOrigin(url)) return false;
      origin = url.origin;
      if (new URL(wc.getURL()).origin !== origin || new URL(requestingOrigin).origin !== origin || (details.securityOrigin && new URL(details.securityOrigin).origin !== origin)) return false;
    } catch { return false; }
    const p: Permission | null = permission === 'media' ? details.mediaType === 'video' ? 'media-camera' : details.mediaType === 'audio' ? 'media-microphone' : null : ['geolocation', 'notifications', 'clipboard-read'].includes(permission) ? permission as Permission : null;
    if (!p) return false;
    const current = profile();
    if (p === 'notifications' && !current.notifications) return false;
    if (p === 'geolocation' && (!startup.geolocation || !current.geolocation || JSON.stringify(startup.geolocation) !== JSON.stringify(current.geolocation))) return false;
    return this.host.permissionDecision(origin, p) === 'allow';
  }

  private dropTabPermissions(wc: WebContents): void {
    const visible = this.permissionQueue.head?.wc === wc;
    this.permissionQueue.removeTab(wc);
    if (visible) { this.closePermissionSurface(); queueMicrotask(() => this.showPermission()); }
    this.suppressed.delete(wc);
  }

  cancelAllPermissions(): void { this.permissionQueue.clear(); if (this.surfaces.state?.name === 'permission' || this.surfaces.state?.name === 'httpAuth') this.closePermissionSurface(); this.suppressed.clear(); }

  private closePermissionSurface(restore = false): void {
    this.closingPermission = true;
    this.surfaces.close(restore && this.win.isFocused());
    this.closingPermission = false;
  }

  private cancelPermission(): void {
    if (!this.permission) return;
    this.finishPermission(false);
    queueMicrotask(() => this.showPermission());
  }

  private showPermission(): void {
    const p = this.permission;
    if (!p || !this.alive) { if (this.auth && this.alive) this.surfaces.open('httpAuth'); return; }
    const decisions = p.permissions.map(item => this.host.permissionDecision(p.origin, item));
    if (!p.valid() || decisions.includes('deny') || p.permissions.some(item => this.suppressed.get(p.wc)?.has(`${p.origin}:${item}`))) { this.finishPermission(false); return this.showPermission(); }
    if (decisions.every(decision => decision === 'allow')) { this.finishPermission(true); return this.showPermission(); }
    this.surfaces.open('permission');
  }

  hasTab(wc: WebContents): boolean {
    return this.tabs.some((t) => t.wc === wc);
  }

  private get alive(): boolean {
    return !this.closing && !this.win.isDestroyed();
  }

  send<E extends keyof CaveEvents>(view: WebContentsView, event: E, ...data: CaveEvents[E] extends void ? [] : [CaveEvents[E]]): void {
    if (!view.webContents.isDestroyed()) view.webContents.send(channel(event), ...data);
  }

  broadcast(): void {
    if (!this.alive) return;
    if (this.surfaces.state?.name === 'bookmarkEdit' && (this.bookmarkTarget?.tab !== this.active || this.bookmarkTarget?.url !== this.current?.getURL())) { this.bookmarkTarget = null; this.surfaces.close(false); return; }
    const s = this.state;
    this.host.sessionChanged();
    for (const v of this.ui) this.send(v, 'state', s);
  }

  sessionSnapshot(): SavedWindow | null {
    const eligible = this.tabs.filter(t => {
      if (t.kind !== 'web' || t.wc.isDestroyed()) return false;
      try { const u = new URL(t.state.url); return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password; } catch { return false; }
    });
    if (!eligible.length) return null;
    const active = eligible.findIndex(t => t.id === this.active);
    return { tabs: eligible.map(t => ({ url: t.state.url, title: t.state.title.slice(0, 4096), pinned: t.pinned })), active: Math.max(0, active) };
  }

  suggestionTabs(requester: ShellWindow): LocalTab[] {
    return this.tabs.filter(t => t.kind === 'web' && !(this === requester && t.id === this.active)).map(t => ({ windowId: this.win.id, tabId: t.id, title: t.state.title, url: t.state.url, generation: this.generations.get(t.id) ?? 0 }));
  }

  activateSuggestion(target: LocalTab): boolean {
    const tab = this.tabs.find(t => t.id === target.tabId && t.kind === 'web' && t.state.url === target.url && (this.generations.get(t.id) ?? 0) === target.generation);
    if (!tab || !this.alive) return false;
    this.activate(tab.id); if (!backgroundE2e) { if (this.win.isMinimized()) this.win.restore(); this.win.show(); this.win.focus(); } return true;
  }

  beginAddress(): { session: string; initial: string } {
    this.clearPendingAddressCancel();
    this.surfaces.close(false);
    let initial = this.tabs.find(t => t.id === this.active)?.state.url ?? '';
    try { const url = new URL(initial); url.username = ''; url.password = ''; initial = url.href; } catch { /* empty or internal */ }
    this.addressSession = { session: randomUUID(), initial, tab: this.active, sequence: 0, items: [], unavailable: false, active: -1 };
    this.broadcast(); return { session: this.addressSession.session, initial };
  }

  suggestAddress(session: string, sequence: number, input: string): AddressQueryResult {
    const empty = { session, sequence, items: [], unavailable: true };
    const a = this.addressSession;
    if (!a || a.session !== session || a.tab !== this.active || !Number.isSafeInteger(sequence) || sequence <= a.sequence || typeof input !== 'string') return empty;
    a.sequence = sequence; a.active = -1;
    const found = input.length <= 2048 ? this.host.suggest(this, input) : { items: [], unavailable: true };
    a.items = found.items; a.unavailable = found.unavailable;
    if (a.items.length && this.surfaces.hasAnchor('suggestions')) this.surfaces.open('suggestions');
    else if (this.surfaces.state?.name === 'suggestions') { this.keepingAddress = true; this.surfaces.close(false); this.keepingAddress = false; }
    const result = { session, sequence, items: a.items.map(({ id, kind, title, url }) => ({ id, kind, title, url, favicon: kind === 'search' ? null : this.host.favicon(url) })), unavailable: a.unavailable };
    if (a.items.length) this.send(this.overlay, 'addressResults', { ...result, active: -1 });
    return result;
  }

  setSuggestionBounds(session: string, sequence: number, bounds: Rect, generation: number): boolean {
    if (this.addressSession?.session === session && this.addressSession.sequence === sequence) return this.surfaces.setBounds(bounds, 'suggestions', generation);
    else if (sequence === -1 && ['siteInfo', 'status', 'downloads', 'menu', 'bookmarkEdit', 'contextMenu'].includes(session)) return this.surfaces.setBounds(bounds, session as SurfaceName, generation);
    return false;
  }

  selectAddress(session: string, sequence: number, active: number): void {
    const a = this.addressSession;
    if (!a || a.session !== session || a.sequence !== sequence || !Number.isInteger(active) || active < -1 || active >= a.items.length) return;
    a.active = active;
    const result = { session, sequence, items: a.items.map(({ id, kind, title, url }) => ({ id, kind, title, url, favicon: kind === 'search' ? null : this.host.favicon(url) })), unavailable: a.unavailable, active };
    this.send(this.overlay, 'addressResults', result);
    this.send(this.chrome, 'addressResults', result);
  }

  chooseAddress(session: string, sequence: number, id: string): boolean {
    const a = this.addressSession;
    if (!a || a.session !== session || a.sequence !== sequence || a.tab !== this.active || typeof id !== 'string') return false;
    const item = a.items.find(i => i.id === id);
    if (!item) return false;
    this.clearPendingAddressCancel();
    this.addressSession = null; this.surfaces.close(false);
    if (item.kind === 'tab' && typeof item.target !== 'string') return this.host.activateSuggestion(item.target);
    if (typeof item.target === 'string') { this.navigate(item.target); return true; }
    return false;
  }

  submitAddress(session: string, input: string): boolean {
    const a = this.addressSession;
    if (!a || a.session !== session || a.tab !== this.active || typeof input !== 'string' || input.length > 2048) return false;
    this.addressSession = null; this.surfaces.close(false); this.navigate(input); return true;
  }

  private clearPendingAddressCancel(): void {
    if (this.pendingAddressCancel) clearTimeout(this.pendingAddressCancel);
    this.pendingAddressCancel = null; this.cancelAfterSuggestionPress = null; this.suggestionPress = false;
  }

  cancelAddress(session: string, focus: 'page' | 'chrome' | 'none'): void {
    if (!this.addressSession || this.addressSession.session !== session || !['page', 'chrome', 'none'].includes(focus)) return;
    if (focus === 'none' && this.surfaces.state?.name === 'suggestions') {
      const cancel = () => { this.clearPendingAddressCancel(); if (this.addressSession?.session === session) { this.addressSession = null; this.surfaces.close(false); this.broadcast(); } };
      this.cancelAfterSuggestionPress = cancel;
      if (!this.suggestionPress) this.pendingAddressCancel = setTimeout(cancel, 100);
      return;
    }
    this.clearPendingAddressCancel();
    this.addressSession = null; this.surfaces.close(false); this.broadcast();
    if (focus === 'page') this.focusPage(); else if (focus === 'chrome') this.chrome.webContents.focus();
  }

  // ---- tabs ----

  newTab(url?: string, adopt?: WebContents, foreground = true, saved?: SavedTab): WebContents {
    this.host.sessionResume();
    const tab = Tab.web(this.host.prepareTab, adopt);
    tab.host = this;
    if (saved) { tab.saved = { url: saved.url, title: saved.title, started: false }; tab.pinned = saved.pinned; }
    tab.wc.on('render-process-gone', () => this.dropTabPermissions(tab.wc));
    if (!adopt) {
      const home = new WebContentsView({ webPreferences: { preload: this.host.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, focusOnNavigation: false } });
      home.webContents.on('will-navigate', (e) => e.preventDefault());
      home.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      home.webContents.on('focus', () => this.focused());
      home.webContents.on('context-menu', (_e, p) => { if (this.visibleHome === tab.id) this.showPageMenu(tab, p, home); });
      home.webContents.on('before-mouse-event', (_event, mouse) => { if (mouse.type === 'mouseDown') { const bounds = home.getBounds(); this.send(this.chrome, 'cancelAddressEdit'); this.surfaces.outsidePress(bounds.x + mouse.x, bounds.y + mouse.y); this.focused(); } });
      void home.webContents.loadFile(join(this.host.rendererDir, 'home.html'));
      this.homes.set(tab.id, home);
    }
    this.tabs.push(tab);
    if (adopt) this.committed(tab, tab.wc.getURL());
    if (!saved && (foreground || this.active === null)) this.activate(tab.id);
    if (url) this.host.load(tab.wc, url);
    this.broadcast();
    return tab.wc;
  }

  restoreWindow(saved: SavedWindow): void {
    const tabs = saved.tabs.map(item => this.newTab(undefined, undefined, false, item));
    this.activate(tabs[saved.active].id);
  }

  setTabMuted(id: number, muted: boolean): void {
    if (!Number.isSafeInteger(id) || typeof muted !== 'boolean') return;
    const tab = this.tabs.find(t => t.id === id && t.kind === 'web');
    if (!tab || tab.wc.isDestroyed()) return;
    tab.wc.setAudioMuted(muted);
    this.broadcast();
  }

  muteActive(): void {
    const tab = this.tabs.find(t => t.id === this.active && t.kind === 'web');
    if (tab) this.setTabMuted(tab.id, !tab.wc.isAudioMuted());
  }

  duplicateTab(id: number): void {
    if (!Number.isSafeInteger(id)) return;
    const source = this.tabs.find(t => t.id === id && t.kind === 'web');
    if (!source || source.wc.isDestroyed()) return;
    const url = source.state.url;
    const wc = this.newTab(url || undefined);
    const tab = this.tabs.find(t => t.wc === wc)!;
    if (source.pinned) this.pinTab(tab.id, true);
    this.moveTab(tab.id, this.tabs.indexOf(source) + 1);
  }

  duplicateActive(): void { if (this.active !== null) this.duplicateTab(this.active); }

  moveTab(id: number, index: number): void {
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(index) || index < 0) return;
    const tab = this.tabs.find(t => t.id === id);
    if (!tab) return;
    this.tabs = moveOrder(this.tabs, tab, index);
    this.broadcast();
  }

  pinTab(id: number, pinned: boolean): void {
    if (!Number.isSafeInteger(id) || typeof pinned !== 'boolean') return;
    const tab = this.tabs.find(t => t.id === id && t.kind === 'web');
    if (!tab || tab.pinned === pinned) return;
    tab.pinned = pinned;
    this.tabs = pinOrder(this.tabs, tab, pinned);
    this.broadcast();
  }

  pinActive(): void {
    const tab = this.tabs.find(t => t.id === this.active);
    if (tab) this.pinTab(tab.id, !tab.pinned);
  }

  closeTab(id: number): void {
    // The settings page outlives its tab; a web tab goes when its webContents does.
    if (id === this.settingsTab.id) return this.closed(this.settingsTab);
    if (id === this.bookmarksTab.id) return this.closed(this.bookmarksTab);
    if (id === this.historyTab.id) return this.closed(this.historyTab);
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab || tab.wc.isDestroyed()) return;
    const state = tab.state;
    if (!this.resetting && tab.kind === 'web' && /^https?:/i.test(state.url) && URL.canParse(state.url)) {
      this.closedTabs.push({ url: state.url, title: state.title, pinned: tab.pinned, position: this.tabs.indexOf(tab) });
      this.host.closedTabsChanged();
    }
    tab.close();
  }

  reopenClosedTab(): void {
    const saved = this.closedTabs.pop();
    if (!saved) return;
    const wc = this.newTab(saved.url);
    const tab = this.tabs.find(t => t.wc === wc)!;
    if (saved.pinned) this.pinTab(tab.id, true);
    this.moveTab(tab.id, saved.position);
    this.host.closedTabsChanged();
  }

  activate(id: number): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (this.active !== id) {
      this.resetFind();
      this.zoomError = false;
      const previous = this.tabs.find((t) => t.id === this.active);
      if (previous?.state.error || previous?.state.crashed) { this.host.forget(previous.wc); previous.retryPending = false; previous.invalidateRecovery(); }
    }
    this.addressSession = null; this.surfaces.close();
    for (const t of this.tabs) { this.root.removeChildView(t.view); const home = this.homes.get(t.id); if (home) this.root.removeChildView(home); }
    this.visibleHome = null;
    this.root.removeChildView(this.recovery);
    this.recoveryVisible = false;
    this.root.addChildView(tab.view);
    this.root.addChildView(this.overlay);
    this.active = id;
    if (tab.saved && !tab.saved.started) { tab.saved.started = true; this.host.load(tab.wc, tab.saved.url); }
    this.updateHome(tab);
    this.updateRecovery();
    if (tab.kind === 'web') this.lastWeb = id;
    this.layout();
    // The visible tab needs focus, including for modal dialog close events.
    this.focusPage();
    this.broadcast();
  }

  cycle(step: number): void {
    const i = this.tabs.findIndex((t) => t.id === this.active);
    if (i >= 0) this.activate(this.tabs[(i + step + this.tabs.length) % this.tabs.length].id);
  }

  closeActive(): void {
    if (this.active !== null) this.closeTab(this.active);
  }

  /** The active web page; null while the settings tab is in front. */
  get currentCertificate() { return this.tabs.find(t => t.id === this.active && t.kind === 'web')?.certificateDetails ?? null; }

  get current(): WebContents | null {
    const tab = this.tabs.find((t) => t.id === this.active);
    return tab?.kind === 'web' ? tab.wc : null;
  }

  toggleBookmark(): void { this.host.toggleBookmark(this); }
  editBookmark(): void { this.bookmarkTarget = { tab: this.active, url: this.current?.getURL() ?? '' }; this.surfaces.toggle('bookmarkEdit'); }

  private get zoomValue(): number {
    const wc = this.current;
    const origin = wc && !this.recoveryState && zoomOrigin(wc.getURL());
    return origin ? this.host.getZoom(origin) : 100;
  }

  zoom(direction: 1 | -1 | 0): void {
    const wc = this.current;
    const origin = wc && !this.recoveryState && zoomOrigin(wc.getURL());
    if (!origin) return;
    const value = direction === 0 ? 100 : zoomStep(this.host.getZoom(origin), direction);
    try { this.host.setZoom(origin, value); this.zoomError = false; }
    catch { this.zoomError = true; }
    this.broadcast();
  }

  applyOriginZoom(origin: string, value: number): void {
    for (const tab of this.tabs) if (tab.kind === 'web' && !tab.wc.isDestroyed() && zoomOrigin(tab.wc.getURL()) === origin) tab.wc.setZoomFactor(value / 100);
    this.broadcast();
  }

  committed(tab: Tab, url: string): void {
    const origin = zoomOrigin(url);
    tab.wc.setZoomFactor((origin ? this.host.getZoom(origin) : 100) / 100);
    this.broadcast();
  }

  /** Brings up the one settings tab, opening it next to the active tab if it is not open yet. */
  openSettings(section?: SettingsSection): void {
    if (!this.tabs.includes(this.settingsTab)) {
      const i = this.tabs.findIndex((t) => t.id === this.active);
      this.tabs.splice(i + 1, 0, this.settingsTab);
    }
    this.activate(this.settingsTab.id);
    if (section) this.send(this.settings, 'section', section);
  }

  openBookmarks(): void {
    if (!this.tabs.includes(this.bookmarksTab)) {
      const i = this.tabs.findIndex((t) => t.id === this.active);
      this.tabs.splice(i + 1, 0, this.bookmarksTab);
    }
    this.activate(this.bookmarksTab.id);
  }

  openHistory(): void {
    if (!this.tabs.includes(this.historyTab)) {
      const i = this.tabs.findIndex((t) => t.id === this.active);
      this.tabs.splice(i + 1, 0, this.historyTab);
    }
    this.activate(this.historyTab.id);
  }

  clearClosedTabs(): void { this.closedTabs.clear(); this.host.closedTabsChanged(); }

  clearFavicons(origin?: string): void { for (const tab of this.tabs) tab.clearFavicon(origin); this.broadcast(); }

  reloadWebTabs(): void { for (const tab of this.tabs) if (tab.kind === 'web' && /^https?:/i.test(tab.wc.getURL())) tab.wc.reload(); }

  /** Reloads the tabs showing this origin, e.g. after its site data was cleared. */
  reloadOrigin(origin: string): void {
    for (const t of this.tabs) if (t.kind === 'web' && originOf(t.wc.getURL()) === origin) t.wc.reload();
  }

  /** A clean slate after a full reset: every tab (and the state it holds in memory) replaced by one empty tab. */
  resetTabs(): void {
    const old = [...this.tabs];
    this.resetting = true;
    try {
      this.closedTabs.clear();
      this.newTab();
      for (const t of old) this.closeTab(t.id);
    } finally { this.resetting = false; this.host.closedTabsChanged(); }
  }

  navigate(input: string): void {
    this.host.sessionResume();
    if (this.addressSession) { this.addressSession = null; this.surfaces.close(false); this.broadcast(); }
    if (!input.trim()) { this.focusPage(); return; }
    this.host.load(this.current ?? this.newTab(), toUrl(input, this.host.shared().searchEngine));
    this.focusPage();
  }

  // ---- what the window's tabs tell it (TabHost) ----

  favicon(url: string): string | null { return this.host.favicon(url); }
  fetchFavicon(tab: Tab, url: string, icons: string[]): Promise<string | null> { return this.host.fetchFavicon(tab, url, icons); }
  historyVisit(url: string, title: string): void { this.host.historyVisit(url, title); }
  historyTitle(url: string, title: string): void { this.host.historyTitle(url, title); }

  changed(tab: Tab): void {
    if (tab.id === this.active) { this.updateHome(tab); this.updateRecovery(); }
    this.broadcast();
  }

  private updateRecovery(): void {
    const visible = !!this.recoveryState;
    if (visible === this.recoveryVisible) return;
    this.recoveryVisible = visible;
    if (visible) {
      if (this.addressSession || this.surfaces.state?.name === 'suggestions') {
        this.addressSession = null;
        this.surfaces.close(false);
      }
      this.root.addChildView(this.recovery);
      this.root.addChildView(this.overlay);
      this.layout();
      if (this.focus === 'page' && !this.setup) this.recovery.webContents.focus();
    } else {
      const hadFocus = this.recovery.webContents.isFocused();
      this.root.removeChildView(this.recovery);
      if (hadFocus && !this.setup) this.current?.focus();
    }
  }

  private updateHome(tab: Tab): void {
    const home = this.homes.get(tab.id);
    if (!home) return;
    const blank = !tab.saved && !tab.state.error && !tab.state.crashed && (!tab.wc.getURL() || tab.wc.getURL() === 'about:blank');
    if ((this.visibleHome === tab.id) === blank) return;
    this.root.removeChildView(home);
    this.visibleHome = blank ? tab.id : null;
    if (blank) { this.root.addChildView(home); this.root.addChildView(this.overlay); }
    this.layout();
    if (blank && this.focus === 'page' && !this.setup) home.webContents.focus();
  }

  closed(tab: Tab): void {
    const i = this.tabs.indexOf(tab);
    if (i < 0 || !this.alive) return;
    this.dropTabPermissions(tab.wc);
    if (this.active === tab.id) this.resetFind();
    if (this.menu?.tab === tab) this.surfaces.close();
    this.tabs.splice(i, 1);
    this.host.forget(tab.wc);
    const home = this.homes.get(tab.id);
    if (home) { this.root.removeChildView(home); if (this.visibleHome === tab.id) this.visibleHome = null; this.homes.delete(tab.id); if (!home.webContents.isDestroyed()) home.webContents.close(); }
    this.root.removeChildView(tab.view);
    if (this.lastWeb === tab.id) this.lastWeb = null;
    if (this.active === tab.id) this.active = null;
    if (this.tabs.length === 0) { this.host.lastTabClosed(); this.win.close(); return; }
    else if (this.active === null) this.activate(this.tabs[Math.min(i, this.tabs.length - 1)].id);
    this.broadcast();
  }

  outsidePress(): void {
    this.send(this.chrome, 'cancelAddressEdit');
    this.surfaces.outsidePress();
  }

  escapeSurface(): void { this.surfaces.escape(); }

  focused(): void {
    if (this.addressSession) this.send(this.chrome, 'cancelAddressEdit');
    this.setFocus('page');
  }

  find(text: string, forward: boolean): void {
    if (typeof text !== 'string' || typeof forward !== 'boolean' || text.length > 4096) return;
    if (!text) { this.stopFind(); return; }
    const tab = this.tabs.find(t => t.id === this.active && t.kind === 'web');
    if (!tab || tab.wc.isDestroyed() || this.visibleHome !== null || this.recoveryVisible) return;
    const next = this.findRequest?.tab === tab && this.findRequest.text === text;
    if (this.findRequest && !next) this.stopFind();
    const requestId = tab.wc.findInPage(text, { forward, findNext: next });
    this.findRequest = { tab, text, requestId };
  }

  stopFind(keepSelection = false): void {
    const request = this.findRequest;
    this.findRequest = null;
    if (request && !request.tab.wc.isDestroyed()) request.tab.wc.stopFindInPage(keepSelection ? 'keepSelection' : 'clearSelection');
  }

  private resetFind(): void {
    this.stopFind();
    this.send(this.chrome, 'resetFind');
  }

  findNavigation(tab: Tab): void {
    if (tab.id === this.active) this.resetFind();
  }

  found(tab: Tab, result: Electron.Result): void {
    if ((result.matches > 0 || result.finalUpdate) && tab.id === this.active && this.findRequest?.tab === tab && this.findRequest.requestId === result.requestId)
      this.send(this.chrome, 'found', { tabId: tab.id, requestId: result.requestId, query: this.findRequest.text, active: result.activeMatchOrdinal, total: result.matches, final: result.finalUpdate });
  }

  opened(wc: WebContents, foreground: boolean): WebContents {
    return this.newTab(undefined, wc, foreground);
  }

  navigated(tab: Tab): void { this.dropTabPermissions(tab.wc); this.generations.set(tab.id, (this.generations.get(tab.id) ?? 0) + 1); if (this.menu?.tab === tab || this.addressSession?.tab === tab.id) { this.addressSession = null; this.surfaces.close(false); } }

  private showMenu(kind: 'toolbar' | 'tab' | 'page' | 'address' | 'shortcut', items: MenuEntry[], anchor?: Rect, tab?: Tab, params?: Electron.ContextMenuParams): void {
    this.surfaces.close();
    this.menu = { token: randomUUID(), items, kind, tab, params };
    this.surfaces.open(kind === 'toolbar' ? 'menu' : 'contextMenu', anchor);
  }

  toggleMenu(): void {
    if (this.surfaces.state?.name === 'menu') { this.surfaces.close(); return; }
    this.showMenu('toolbar', toolbarMenu(!!this.current, !!this.current && !this.recoveryState && !!zoomOrigin(this.current.getURL())));
  }

  openTabMenu(id: number, anchor: Rect): void {
    if (!Number.isInteger(id) || !anchor || typeof anchor !== 'object') return;
    const { x, y, width, height } = anchor;
    const bounds = this.win.getContentBounds();
    if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0 || x < 0 || y < 0 || x + width > bounds.width || y + height > bounds.height) return;
    const tab = this.tabs.find(t => t.id === id);
    if (tab) this.showMenu('tab', tabMenu(tab.kind === 'web', tab.pinned, tab.state.muted, this.canReopenTab), anchor, tab);
  }

  isActiveHome(wc: WebContents): boolean { return this.visibleHome !== null && this.homes.get(this.visibleHome)?.webContents === wc; }

  openShortcutMenu(id: number, anchor: Rect): void {
    const home = this.visibleHome === null ? undefined : this.homes.get(this.visibleHome);
    if (!home || !Number.isInteger(id) || !this.host.shared().shortcuts.some(item => item.id === id) || !anchor) return;
    const page = home.getBounds(), { x, y, width, height } = anchor;
    if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width < 0 || height < 0 || x + width > page.width || y + height > page.height) return;
    if (this.menu?.kind === 'shortcut' && this.menu.shortcutId === id && this.surfaces.state?.name === 'contextMenu') { this.surfaces.close(); return; }
    this.showMenu('shortcut', [{ id: 'edit', label: t('homeEditAction'), enabled: true }, { id: 'remove', label: t('homeRemove'), enabled: true }], { x: page.x + x, y: page.y + y, width, height });
    if (this.menu) this.menu.shortcutId = id;
  }

  openAddressMenu(anchor: Rect): void {
    if (!anchor || typeof anchor !== 'object') return;
    const { x, y, width, height } = anchor, bounds = this.win.getContentBounds();
    if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width < 0 || height < 0 || x + width > bounds.width || y + height > bounds.height) return;
    this.showMenu('address', addressMenu(), anchor);
  }

  contextMenu(tab: Tab, p: Electron.ContextMenuParams): void {
    if (tab.id !== this.active || tab.wc.isDestroyed() || (tab.kind === 'web' && this.visibleHome !== null)) return;
    this.showPageMenu(tab, p, tab.view);
  }

  private showPageMenu(tab: Tab, p: Electron.ContextMenuParams, view: WebContentsView): void {
    try {
      const bounds = view.getBounds(), all = this.win.getContentBounds(), wc = view.webContents;
      const x = Math.max(0, Math.min(all.width, bounds.x + p.x)), y = Math.max(0, Math.min(all.height, bounds.y + p.y));
      this.showMenu('page', pageMenu(p, wc.navigationHistory.canGoBack(), wc.navigationHistory.canGoForward(), this.host.canBrowse()), { x, y, width: 0, height: 0 }, tab, p);
      if (this.menu) this.menu.pageContents = wc;
    } catch { this.surfaces.close(); }
  }

  contextAction(token: string, id: string): void {
    const menu = this.menu;
    if (!this.alive || typeof token !== 'string' || typeof id !== 'string' || !menu || menu.token !== token || !menu.items.some(i => !('separator' in i) && i.id === id && i.enabled)) return;
    this.surfaces.close();
    const tab = menu.tab, p = menu.params;
    if (menu.kind === 'shortcut') {
      const home = this.visibleHome === null ? undefined : this.homes.get(this.visibleHome);
      if (home && menu.shortcutId !== undefined && (id === 'edit' || id === 'remove')) this.send(home, 'shortcutAction', { id: menu.shortcutId, action: id });
      return;
    }
    if (menu.kind === 'address') {
      if (id === 'address.pasteAndGo') {
        const active = this.active;
        void Promise.resolve().then(() => clipboard.readText()).catch(() => '').then(value => {
          if (!this.alive || this.active !== active) return;
          const text = value.trim(); if (text) this.navigate(text); else this.focusPage();
        });
      } else {
        const wc = this.chrome.webContents;
        if (!wc.isDestroyed()) { wc.focus(); if (id === 'cut') wc.cut(); else if (id === 'copy') wc.copy(); else if (id === 'paste') wc.paste(); else if (id === 'selectAll') wc.selectAll(); }
      }
      return;
    }
    if (menu.kind === 'toolbar') {
      if (['tab.new', 'window.new', 'history.open', 'bookmarks.open', 'downloads.open', 'zoom.out', 'zoom.reset', 'zoom.in', 'page.print', 'settings.open'].includes(id) && (!['zoom.out', 'zoom.reset', 'zoom.in', 'page.print'].includes(id) || this.current)) this.host.run(id as CommandId, this);
      return;
    }
    if (!tab || !this.tabs.includes(tab) || tab.wc.isDestroyed()) return;
    if (menu.kind === 'tab') { if (id === 'tab.reopen') this.reopenClosedTab(); else if (id === 'tab.mute') this.setTabMuted(tab.id, !tab.wc.isAudioMuted()); else if (id === 'tab.duplicate') this.duplicateTab(tab.id); else if (id === 'tab.pin') this.pinTab(tab.id, !tab.pinned); else if (id === 'tab.close') this.closeTab(tab.id); else if (id === 'page.reload' && tab.kind === 'web') tab.wc.reload(); return; }
    if (!p || tab.id !== this.active || !menu.pageContents || menu.pageContents.isDestroyed()) return;
    const wc = menu.pageContents;
    try {
      switch (id) {
        case 'openLink': if (validWeb(p.linkURL)) this.newTab(p.linkURL, undefined, false); break;
        case 'copyLink': clipboard.writeText(p.linkURL); break;
        case 'openImage': if (validWeb(p.srcURL)) this.newTab(p.srcURL, undefined, false); break;
        case 'copyImage': wc.copyImageAt(p.x, p.y); break;
        case 'saveImage': if (this.host.canBrowse() && validWeb(p.srcURL) && /^https?:/i.test(p.srcURL)) wc.downloadURL(p.srcURL); break;
        case 'undo': if (p.editFlags.canUndo) wc.undo(); break;
        case 'redo': if (p.editFlags.canRedo) wc.redo(); break;
        case 'cut': if (p.editFlags.canCut) wc.cut(); break;
        case 'copy': if (p.editFlags.canCopy) wc.copy(); break;
        case 'paste': if (p.editFlags.canPaste) wc.paste(); break;
        case 'selectAll': if (p.editFlags.canSelectAll) wc.selectAll(); break;
        case 'page.back': if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
        case 'page.forward': if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break;
        case 'page.reload': wc.reload(); break;
        case 'inspect': wc.inspectElement(p.x, p.y); break;
      }
    } catch { /* The target can disappear during an action. */ }
  }

  // ---- keyboard focus ----

  private setFocus(focus: ShellState['focus']): void {
    if (this.focus === focus) return;
    this.focus = focus;
    this.broadcast();
  }

  /** Hands the keyboard to the page in front (the active tab or the settings page). */
  focusPage(): void {
    if (this.setup) { this.welcome.webContents.focus(); return; }
    const tab = this.tabs.find((t) => t.id === this.active);
    if (tab && !tab.wc.isDestroyed()) { if (this.recoveryState) { this.recovery.webContents.focus(); return; } const home = this.homes.get(tab.id); if (home && (!tab.wc.getURL() || tab.wc.getURL() === 'about:blank')) home.webContents.focus(); else tab.wc.focus(); }
  }

  focusAddress(): void {
    this.chrome.webContents.focus();
    this.send(this.chrome, 'focusAddress');
  }

  openFind(): void {
    const tab = this.tabs.find(t => t.id === this.active && t.kind === 'web');
    if (!tab || this.visibleHome !== null || this.recoveryVisible) return;
    this.chrome.webContents.focus();
    this.send(this.chrome, 'openFind');
  }

  private castShadow(card: Rect | null): void {
    if (this.shadow.isDestroyed()) return;
    if (this.setup) card = null;
    const was = this.shadowCard;
    this.shadowCard = card;
    if (!card) {
      if (!was) return;
      void this.shadow.webContents.executeJavaScript("document.body.classList.remove('in')").catch(() => undefined);
      // The window stays until the fade in shadow.css has finished.
      this.shadowHide = setTimeout(() => { this.shadowHide = null; if (!this.shadow.isDestroyed()) this.shadow.hide(); }, 160);
      return;
    }
    if (this.shadowHide) { clearTimeout(this.shadowHide); this.shadowHide = null; }
    // shadow.css keeps this 64px margin; the box inside it coincides with the card.
    const content = this.win.getContentBounds();
    this.shadow.setBounds({ x: content.x + card.x - 64, y: content.y + card.y - 64, width: card.width + 128, height: card.height + 128 });
    if (was) return;
    this.shadow.showInactive();
    void this.shadow.webContents.executeJavaScript("document.body.classList.add('in')").catch(() => undefined);
  }

  /** Shows setup or the browser. The two never share the window: the other one is detached. */
  setSetup(enabled: boolean): void {
    if (enabled === this.setup || !this.alive) return;
    this.setup = enabled;
    this.surfaces.close(false);
    this.addressSession = null;
    const [show, hide] = enabled ? [this.welcome, this.root] : [this.root, this.welcome];
    this.win.contentView.removeChildView(hide);
    this.win.contentView.addChildView(show);
    this.layout();
    this.focusPage();
    this.broadcast();
  }

  layout(): void {
    if (!this.alive) return;
    if (this.surfaces.state?.name === 'contextMenu') this.surfaces.close();
    const { width, height } = this.win.getContentBounds();
    const all = { x: 0, y: 0, width, height };
    const layout = this.host.tabLayout();
    this.root.setBounds(all);
    if (this.setup) {
      if (mac) this.win.setWindowButtonPosition(setupTrafficLights());
      else if (this.caption !== SETUP_CAPTION) { this.caption = SETUP_CAPTION; this.win.setTitleBarOverlay({ height: SETUP_CAPTION }); }
      this.welcome.setBounds(all);
      return;
    }
    if (mac) this.win.setWindowButtonPosition(trafficLightPosition(layout));
    else if (captionHeight(layout) !== this.caption) { this.caption = captionHeight(layout); this.win.setTitleBarOverlay({ height: this.caption }); }
    this.chrome.setBounds(all);
    this.surfaces.fullBounds();
    const page = pageBounds(layout, width, height, mac && !(process.env.CAVE_TEST_HARNESS === '1' && process.env.CAVE_TEST_WINDOWS_CHROME === '1'), this.host.sidebarWidth());
    for (const v of [...this.tabs.map((t) => t.view), ...this.homes.values(), this.settings, this.history, this.bookmarks, this.recovery]) {
      v.setBounds(page);
      v.setBorderRadius(METRICS.radius);
    }
  }
}
