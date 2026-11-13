// The one contract between the main process and the shell's own pages: the state it sends, the
// calls the pages may make and the events they may hear. The preload builds the bridge from
// CALLS and EVENTS, the main process must implement every call (Handlers), and the pages see
// the result as CaveApi, so a call that is missing or mistyped on any side fails the typecheck.
import type { Accent, Theme } from './appearance.ts';
import type { GateView } from '../main/gate.ts';
import type { Locale, LocalePreference } from './i18n/index.ts';
import type { CommandId } from './commands.ts';
import type { Profile, ProfilePatch, SubscriptionVia, NodeSelection } from './profile.ts';

export interface Shortcut { id: number; name: string; url: string; favicon?: string | null }

export interface ClearDataOptions { from: number; to: number; history: boolean; siteData: boolean; cache: boolean; downloads: boolean }
export interface CertificateDetails { issuer: string; subject: string; validFrom: string; validTo: string }
export interface HistoryRow { url: string; title: string; lastVisit: number; visits: number; favicon?: string | null }

export interface TabState {
  id: number;
  kind: 'web' | 'settings' | 'history' | 'bookmarks';
  title: string;
  url: string;
  favicon: string | null;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
  audible: boolean;
  pinned: boolean;
  muted: boolean;
  /** The page's process died; a reload brings it back. */
  crashed: boolean;
  insecure: boolean;
  /** Why the last load of the page failed (a Chromium net error), until something else is loaded. */
  error: { code: number; description: string; url: string; kind: 'network' | 'gate' | 'certificate'; generation: number } | null;
}
export interface DownloadState { id: number; name: string; path: string; received: number; total: number; paused: boolean; started: number; ended: number | null; exists: boolean; state: 'progressing' | 'completed' | 'cancelled' | 'interrupted' }
export interface CheckItem { id: number; title: string; pass: boolean; detail: string }
/** country: the egress last seen through that node in this run ('' until it has been checked) */
export type DelayOutcome = { status: 'untested' } | { status: 'measured'; ms: number } | { status: 'timeout' };
export interface NodeState { nodes: { source: string; name: string; type: string; delay: DelayOutcome; country: string }[]; selected: NodeSelection | null }

export type SearchEngine =
  | { kind: 'default' }
  | { kind: 'custom'; template: string };

export type TabLayout = 'top' | 'side';
export type SettingsSection = 'overview' | 'nodes' | 'env' | 'privacy' | 'downloads' | 'appearance' | 'advanced';
/** In window coordinates (CSS pixels from the content area's top left). */
export interface Rect { x: number; y: number; width: number; height: number }
/** What can float above the page: each is an element of the overlay page, anchored to an element of the chrome. */
export type Permission = 'media-camera' | 'media-microphone' | 'geolocation' | 'notifications' | 'clipboard-read';
export type SurfaceName = 'siteInfo' | 'status' | 'menu' | 'contextMenu' | 'suggestions' | 'permission' | 'httpAuth' | 'restoreSession' | 'downloads' | 'bookmarkEdit';
export type MenuEntry = { separator: true } | { id: string; label: string; enabled: boolean; checked?: boolean; shortcut?: string };

export interface AddressSuggestion { id: string; kind: 'tab' | 'bookmark' | 'history' | 'search'; title: string; url: string; favicon?: string | null }
export interface AddressQueryResult { session: string; sequence: number; items: AddressSuggestion[]; unavailable: boolean }

export type Bookmark = { id: number; parent: number | null; position: number; kind: 'folder' | 'link'; title: string; url: string | null; favicon?: string | null };

export interface ShellState {
  bookmarked: boolean;
  bookmarkMatches: Bookmark[];
  /** Native traffic-light origin; other platforms use the titlebar-area CSS environment variables. */
  trafficLightPosition: { x: number; y: number } | null;
  tabs: TabState[];
  recovery: { tabId: number; generation: number; kind: 'network' | 'gate' | 'certificate' | 'crash'; displayUrl: string; code: number | null; canRetry: boolean; canContinue: boolean } | null;
  shortcuts: Shortcut[];
  active: number | null;
  zoom: number;
  zoomError: boolean;
  /** Origin of the web tab most recently in front ('' when none): the site "this site" refers to. */
  site: string;
  gate: GateView;
  downloads: DownloadState[];
  notice: string | null;
  tabLayout: TabLayout;
  sidebarWidth: number;
  accent: Accent;
  theme: Theme;
  locale: Locale;
  localePreference: LocalePreference;
  searchEngine: SearchEngine;
  restoreSession: boolean;
  /** The surface that is open, and where its anchor is. */
  surface: { name: SurfaceName; generation: number; anchor: Rect; viewport: { width: number; height: number } } | null;
  httpAuthPrompt: { id: string; origin: string; realm: string; error: boolean } | null;
  permissionPrompt: { id: string; origin: string; permissions: Permission[]; error: boolean } | null;
  address: { session: string; initial: string } | null;
  contextMenu: { token: string; items: MenuEntry[] } | null;
  /** Which of the window's pages has the keyboard: the chrome, the page in front, or the overlay. */
  focus: 'chrome' | 'page' | 'overlay';
}

export interface PermissionEntry { origin: string; permission: Permission; decision: 'allow' | 'deny' }

export interface PanelData {
  permissions: PermissionEntry[];
  profile: Profile;
  profileError: string | null;
  profileDir: string;
  hostPlatform: string;
  nodes: NodeState;
  restartNeeded: boolean;
}

/** Every call a shell page can make, as the main process sees it. Each acts on the caller's own window. */
export interface CaveCalls {
  respondHttpAuth(id: string, credentials: { username: string; password: string } | null): void;
  respondPermission(id: string, decision: 'once' | 'allow' | 'deny'): void;
  beginAddress(): { session: string; initial: string };
  suggestAddress(session: string, sequence: number, input: string): AddressQueryResult;
  selectAddress(session: string, sequence: number, active: number): void;
  chooseAddress(session: string, sequence: number, id: string): boolean;
  submitAddress(session: string, input: string): boolean;
  testSuggestionMouse(x: number, y: number): void;
  testSuggestionBounds(): Rect;
  cancelAddress(session: string, focus: 'page' | 'chrome' | 'none'): void;
  getState(): ShellState;
  retryTab(id: number, generation: number): void;
  backFromError(id: number, generation: number): void;
  recoveryStatus(id: number, generation: number): void;
  continueCertificate(id: number, generation: number): void;
  importBookmarks(): { added: number; skipped: number };
  bookmarkChildren(parent: number | null): Bookmark[];
  bookmarkMove(id: number, parent: number | null, position: number): void;
  bookmarkAdd(parent: number | null, kind: Bookmark["kind"], title: string, url: string | null): number;
  bookmarkUpdate(id: number, title: string, url: string | null): void;
  bookmarkRemove(id: number): void;
  clearData(options: ClearDataOptions): void;
  historyDelete(urls: string[]): void;
  historyList(query: string, before: number | null, limit: number): HistoryRow[];
  shortcuts(): Shortcut[];
  saveShortcut(input: { id?: number; name: string; url: string }): void;
  removeShortcut(id: number): void;
  newTab(url?: string): void;
  closeTab(id: number): void;
  reopenClosedTab(): void;
  pinTab(id: number, pinned: boolean): void;
  moveTab(id: number, index: number): void;
  duplicateTab(id: number): void;
  setTabMuted(id: number, muted: boolean): void;
  activate(id: number): void;
  navigate(input: string): void;
  run(command: CommandId): void;
  find(text: string, forward: boolean): void;
  stopFind(keepSelection?: boolean): void;
  /** Hands the keyboard to the page in front. */
  focusPage(): void;
  openSettings(section?: SettingsSection): void;
  toggleSurface(name: SurfaceName): void;
  closeSurface(): void;
  openAddressMenu(anchor: Rect): void;
  openTabMenu(tabId: number, anchor: Rect): void;
  openShortcutMenu(id: number, anchor: Rect): void;
  contextAction(token: string, id: string): void;
  setSurfaceBounds(session: string, sequence: number, bounds: Rect, generation: number): boolean;
  setAnchors(anchors: Partial<Record<SurfaceName, Rect>>): void;
  setTabLayout(layout: TabLayout): void;
  setSidebarWidth(width: number): void;
  setAccent(accent: Accent): void;
  setTheme(theme: Theme): void;
  setLocale(locale: LocalePreference): void;
  restoreSession(): void;
  discardSession(): void;
  setRestoreSession(enabled: boolean): void;
  setSearchEngine(engine: SearchEngine): boolean;
  listDownloads(): DownloadState[];
  downloadAction(id: number, action: 'pause' | 'resume' | 'cancel' | 'open' | 'reveal' | 'remove'): void;
  siteInfo(): { permissions: PermissionEntry[]; cookies: number; certificate: CertificateDetails | null };
  panelData(): PanelData;
  removePermission(origin: string, permission: Permission): void;
  updateProfile(patch: ProfilePatch): PanelData;
  importSubscriptionFile(): boolean;
  importSubscriptionText(text: string): void;
  addSubscription(url: string, via: SubscriptionVia): void;
  updateSource(id: string): void;
  updateSourceFile(id: string): boolean;
  updateSourceText(id: string, text: string): void;
  renameSource(id: string, name: string): void;
  removeSource(id: string): void;
  selectNode(source: string, name: string): void;
  testDelays(): void;
  measureExit(): { country: string; colo: string };
  pause(): void;
  resume(): void;
  restartAndCheck(): void;
  runChecks(): CheckItem[];
  copyReport(): void;
  clearSite(url: string): void;
  resetEnvironment(): void;
  revealProfile(): void;
  restart(): void;
}

/** Every event the main process sends to a shell page, with its payload. */
export interface CaveEvents {
  state: ShellState;
  addressResults: AddressQueryResult & { active: number };
  found: { tabId: number; requestId: number; query: string; active: number; total: number; final: boolean };
  resetFind: void;
  focusAddress: void;
  cancelAddressEdit: void;
  openFind: void;
  section: SettingsSection;
  shortcutAction: { id: number; action: 'edit' | 'remove' };
}

/** The names at run time. A Record, so leaving one out (or adding a stray one) does not compile. */
export const CALLS: Record<keyof CaveCalls, true> = {
  respondHttpAuth: true, respondPermission: true, retryTab: true, backFromError: true, recoveryStatus: true, continueCertificate: true,
  testSuggestionMouse: true, testSuggestionBounds: true, beginAddress: true, suggestAddress: true, selectAddress: true, chooseAddress: true, submitAddress: true, cancelAddress: true,
  importBookmarks: true, bookmarkChildren: true, bookmarkMove: true, bookmarkAdd: true, bookmarkUpdate: true, bookmarkRemove: true,
  clearData: true, historyDelete: true, historyList: true, shortcuts: true, saveShortcut: true, removeShortcut: true, getState: true, newTab: true, closeTab: true, reopenClosedTab: true, pinTab: true, moveTab: true, duplicateTab: true, setTabMuted: true, activate: true, navigate: true, run: true, find: true, stopFind: true, focusPage: true,
  setSurfaceBounds: true, openAddressMenu: true, openTabMenu: true, openShortcutMenu: true, contextAction: true, openSettings: true, toggleSurface: true, closeSurface: true, setAnchors: true, setTabLayout: true, setSidebarWidth: true, setAccent: true, setTheme: true, setLocale: true, restoreSession: true, discardSession: true, setRestoreSession: true, setSearchEngine: true, listDownloads: true, downloadAction: true,

  siteInfo: true, removePermission: true, panelData: true, updateProfile: true, importSubscriptionFile: true, importSubscriptionText: true, addSubscription: true, updateSource: true, updateSourceFile: true, updateSourceText: true, renameSource: true, removeSource: true,
  selectNode: true, testDelays: true, measureExit: true, pause: true, resume: true, restartAndCheck: true, runChecks: true, copyReport: true,
  clearSite: true, resetEnvironment: true, revealProfile: true, restart: true,
};
export const EVENTS: Record<keyof CaveEvents, true> = { state: true, addressResults: true, found: true, resetFind: true, focusAddress: true, cancelAddressEdit: true, openFind: true, section: true, shortcutAction: true };

export const channel = (name: keyof CaveCalls | keyof CaveEvents): string => `cave:${name}`;

/** What the main process implements: a call that returns nothing may return anything (it is dropped). */
export type Handlers = {
  [K in keyof CaveCalls]: (...args: Parameters<CaveCalls[K]>) => ReturnType<CaveCalls[K]> extends void ? unknown : ReturnType<CaveCalls[K]> | Promise<ReturnType<CaveCalls[K]>>;
};

/** What a shell page holds as `cave`. */
export type CaveApi = {
  [K in keyof CaveCalls]: (...args: Parameters<CaveCalls[K]>) => Promise<ReturnType<CaveCalls[K]>>;
} & {
  platform: string;
  on<E extends keyof CaveEvents>(event: E, listener: (data: CaveEvents[E]) => void): void;
};

export type { Profile, ProfilePatch, GateView };
