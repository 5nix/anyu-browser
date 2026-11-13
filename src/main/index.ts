import { accentValue, themeValue } from '../shared/appearance.ts';
import { parseBookmarks, insertBookmarks, MAX_BOOKMARK_FILE } from './shell/bookmark-import.ts';
import { appendFileSync } from 'node:fs';
import { sessionStartup } from './shell/session-startup.ts';
import { validSession } from './shell/session-snapshot.ts';
import { DEFAULT_SEARCH_ENGINE, isSearchEngine } from '../shared/url.ts';
import { allowedSiteOrigin } from '../shared/navigation-safety.ts';
// Startup order matters: profile → ports → command-line switches all happen before `ready`
// (Electron emits `ready` only after this module's top-level awaits settle), so no request can
// ever be made without the proxy. Everything after `ready` lives in start().
import { app, clipboard, dialog, ipcMain, shell as electronShell, type IpcMainInvokeEvent } from 'electron';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProfileStore } from './profile.ts';
import { browserSession, pinNetwork, pinSessions, reservePorts } from './network.ts';
import { applyFingerprint, buildIdentity, emulationCommands, type Identity, type PlatformHints } from './fingerprint.ts';
import { applyPermissions } from './permissions.ts';
import { Gatekeeper } from './gatekeeper.ts';
import { resolveWindowsEgress } from './windows-egress.ts';
import { FaviconFetcher } from './shell/favicons.ts';
import { Browser } from './shell/browser.ts';
import type { ShellWindow } from './shell/window.ts';
import { registerProbeScheme, runProbe, selfCheckSession } from './probe.ts';
import { evaluateChecks, renderReport } from './checks.ts';
import { CALLS, channel, type CheckItem, type Handlers, type PanelData, type TabLayout } from '../shared/ipc.ts';
import { openStore, Favicons, Prefs, History, Sessions, Bookmarks, Downloads as DownloadRepository, Shortcuts, SiteSettings, clearBrowsingData } from './store/index.ts';
import { t, setLocale, systemLocale, type LocalePreference } from '../shared/i18n/index.ts';
import type { ProfilePatch } from '../shared/profile.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const resources = app.isPackaged ? process.resourcesPath : join(root, 'resources');
const exe = process.platform === 'win32' ? '.exe' : '';
const coreBinary = app.isPackaged
  ? join(process.resourcesPath, 'proxy-core', `cave-core${exe}`)
  : join(root, 'vendor', 'proxy-core', `${process.platform}-${process.arch}`, `cave-core${exe}`);

const backgroundE2e = process.env.CAVE_E2E_BACKGROUND === '1';
if (backgroundE2e) {
  // Electron's default uncaught-exception handler opens a modal dialog. Keep the error visible
  // to the harness and fail the app instead, so a test cannot leave a dialog on the desktop.
  process.on('uncaughtException', (error) => { console.error(error); app.exit(1); });
  // Inactive windows may stop producing animation frames, leaving geometry mid-transition.
  app.commandLine.appendSwitch('force-prefers-reduced-motion');
  if (process.platform === 'darwin') app.setActivationPolicy('accessory');
}

app.setName('Anyu');
const profileDir = process.env.CAVE_PROFILE || join(app.getPath('appData'), 'Cave', 'profile');
app.setPath('userData', join(profileDir, 'browser'));
// One instance per profile: the lock lives in userData, so separate profiles run side by side.
if (!app.requestSingleInstanceLock()) app.exit(0);
setLocale(systemLocale(process.env.CAVE_LANG || app.getLocale()));
const store = await ProfileStore.open(profileDir);
const profile = () => store.current;
const startupProfile = profile();

const ports = await reservePorts();
pinNetwork(ports);
app.commandLine.appendSwitch('lang', startupProfile.locale);
// Engine-wide default for anything the debugger cannot reach before it runs (macOS/Linux).
process.env.TZ = startupProfile.timezone;
registerProbeScheme();
// Hidden helper windows come and go; Cave quits when its last browser window closes, not before.
app.on('window-all-closed', () => undefined);

void app.whenReady().then(start);

async function start(): Promise<void> {
  await pinSessions(ports);

  const hostHints: PlatformHints = await runProbe().then((r) => ({
    platform: r.main.ua!.platform,
    platformVersion: r.main.ua!.high.platformVersion,
    architecture: r.main.ua!.high.architecture,
    bitness: r.main.ua!.high.bitness,
    wow64: r.main.ua!.high.wow64,
  }));
  const identity: Identity = buildIdentity(startupProfile, process.versions.chrome, hostHints);
  const commands = emulationCommands(startupProfile, identity);
  app.userAgentFallback = identity.userAgent;
  for (const ses of [browserSession(), selfCheckSession()]) ses.setUserAgent(identity.userAgent, identity.acceptLanguages);


  const downloadsDir = join(profileDir, 'downloads');
  await mkdir(downloadsDir, { recursive: true });

  const gate = new Gatekeeper({
    ...(process.platform === 'win32' ? { resolveOutboundInterface: resolveWindowsEgress } : {}),
    binary: coreBinary,
    dir: profileDir,
    ports,
    secret: randomBytes(32).toString('hex'),
    profile,
    saveProxy: async (proxy) => void (await store.update({ proxy })),
  });

  const uiFile = join(profileDir, 'ui.json');
  let database;
  let databaseNotice: { key: 'databaseRecovered' | 'databaseFailed'; value: string } | null = null;
  try {
    database = openStore(join(profileDir, 'cave.sqlite'));
    if (database.recovered) databaseNotice = { key: 'databaseRecovered', value: database.recovered };
  } catch (error) {
    databaseNotice = { key: 'databaseFailed', value: String(error) };
    database = openStore(':memory:');
  }
  const prefs = new Prefs(database);
  if (!prefs.get('uiImported', false)) {
    const ui: { tabLayout?: TabLayout } | null = await readFile(uiFile, 'utf8').then(JSON.parse).catch(() => null);
    if (ui?.tabLayout === 'side' || ui?.tabLayout === 'top') prefs.set('tabLayout', ui.tabLayout);
    prefs.set('uiImported', true);
  }
  const preferredLocale = prefs.get<LocalePreference>('locale', 'system');
  setLocale(preferredLocale === 'zh' || preferredLocale === 'en' ? preferredLocale : systemLocale(app.getLocale()));
  const history = new History(database);
  let savedSearch: unknown;
  try { savedSearch = prefs.get('searchEngine', DEFAULT_SEARCH_ENGINE); } catch { savedSearch = DEFAULT_SEARCH_ENGINE; }
  const shortcuts = new Shortcuts(database);
  const siteSettings = new SiteSettings(database);
  const sessions = new Sessions(database);
  const startup = sessionStartup(sessions.latest(validSession), prefs.get<boolean>('restoreSession', false) === true, prefs.get<boolean>('cleanExit', true) === true);
  prefs.set('cleanExit', false);
  const bookmarks = new Bookmarks(database);
  const favicons = new FaviconFetcher(new Favicons(database), () => gate.open);
  const browser = new Browser({
    favicons,
    sessions,
    accent: accentValue(prefs.get('accent', 'teal')),
    theme: themeValue(prefs.get('theme', 'system')),
    saveAccent: (accent) => prefs.set('accent', accent),
    saveTheme: (theme) => prefs.set('theme', theme),
    restoreSession: prefs.get<boolean>('restoreSession', false) === true,
    saveRestoreSession: (enabled) => prefs.set('restoreSession', enabled),
    searchEngine: isSearchEngine(savedSearch) ? savedSearch : DEFAULT_SEARCH_ENGINE,
    saveSearchEngine: (engine) => prefs.set('searchEngine', engine),
    rendererDir: join(root, 'dist', 'renderer'),
    preload: join(root, 'dist', 'preload.cjs'),
    downloadsDir,
    downloadStore: new DownloadRepository(database),
    ...(process.env.CAVE_TEST_DOWNLOAD_LOG ? { downloadFiles: {
      openPath: async (path: string) => { appendFileSync(process.env.CAVE_TEST_DOWNLOAD_LOG!, JSON.stringify(['open', path]) + '\n'); return ''; },
      showItemInFolder: (path: string) => { appendFileSync(process.env.CAVE_TEST_DOWNLOAD_LOG!, JSON.stringify(['reveal', path]) + '\n'); },
    } } : {}),
    history,
    bookmarks,
    siteSettings,
    persistentSettings: databaseNotice?.key !== 'databaseFailed',
    shortcuts: () => shortcuts.list(),
    tabLayout: prefs.get<TabLayout>('tabLayout', 'top') === 'side' ? 'side' : 'top',
    saveTabLayout: (tabLayout) => prefs.set('tabLayout', tabLayout),
    sidebarWidth: prefs.get<number>('sidebarWidth', 256),
    saveSidebarWidth: (width) => prefs.set('sidebarWidth', width),
    locale: (['zh', 'en'].includes(prefs.get<string>('locale', 'system')) ? prefs.get<LocalePreference>('locale', 'system') : 'system'),
    saveLocale: (locale) => prefs.set('locale', locale),
    prepareTab: (wc) => applyFingerprint(wc, commands),
    canBrowse: () => gate.open,
    gate: () => gate.view,
  });
  applyPermissions(browserSession(), profile, (wc, permission, details, callback) => {
    const win = browser.windows.find(w => w.hasTab(wc));
    if (!win) return callback(false);
    win.requestPermission(wc, permission, details, callback, profile, startupProfile);
  }, (wc, permission, origin, details) => {
    const win = wc && browser.windows.find(w => w.hasTab(wc));
    return !!win && win.checkPermission(wc!, permission, origin, details, profile, startupProfile);
  });
  app.on('login', (event, wc, details, info, callback) => {
    // Preserve Electron's existing default handling for proxy authentication.
    if (info.isProxy) return;
    event.preventDefault();
    const win = wc && browser.windows.find(w => w.hasTab(wc));
    if (!win || !wc) return callback();
    win.requestHttpAuth(wc, details, info, callback);
  });
  app.on('certificate-error', (event, wc, url, _error, certificate, callback, isMainFrame) => {
    event.preventDefault();
    callback(browser.certificateError(wc, url, certificate.data, isMainFrame));
  });
  if (databaseNotice) { const notice = databaseNotice; browser.setNotice(() => t(notice.key, notice.key === 'databaseRecovered' ? { path: notice.value } : { error: notice.value })); }
  app.once('will-quit', () => { browser.stopSessionSaving(); prefs.set('cleanExit', true); database.close(); });
  browser.on('closed', () => app.quit());
  gate.on('change', () => browser.gateChanged(gate.open));
  gate.on('error', (message: string) => browser.setNotice(message));
  if (store.error) browser.setNotice(() => store.error!);

  let lastChecks: CheckItem[] = [];
  let restartNeeded = false;

  async function runChecks(): Promise<CheckItem[]> {
    const ses = browserSession();
    const cmd = app.commandLine;
    const expectedProxy = `SOCKS5 127.0.0.1:${ports.browser}`;
    const [remote, loopback, localDnsRefused, runtimeYaml, probe, coreUp] = await Promise.all([
      ses.resolveProxy('https://example.com/'),
      ses.resolveProxy('http://127.0.0.1/'),
      ses.resolveHost('example.com').then(() => false, () => true),
      gate.runtimeConfig(),
      runProbe((wc) => applyFingerprint(wc, commands)).catch(() => null),
      gate.core.running ? gate.controller.version().then(() => true, () => false) : Promise.resolve(false),
    ]);
    lastChecks = evaluateChecks({
      profile: profile(),
      identity,
      gate: gate.view,
      coreUp,
      expectedProxy,
      proxyFor: { remote, loopback },
      switches: {
        hostResolverRules: cmd.getSwitchValue('host-resolver-rules'),
        quic: cmd.hasSwitch('disable-quic'),
        ipv6: cmd.hasSwitch('disable-ipv6'),
      },
      localDnsRefused,
      runtimeYaml,
      probe,
      hostPlatform: hostHints.platform,
    });
    return lastChecks;
  }

  async function panelData(): Promise<PanelData> {
    return {
      permissions: siteSettings.listPermissions(),
      profile: profile(),
      profileError: store.error,
      profileDir,
      hostPlatform: hostHints.platform,
      nodes: await gate.nodes().catch(() => ({ nodes: [], selected: profile().proxy.selected })),
      restartNeeded,
    };
  }

  const RESTART_FIELDS: (keyof ProfilePatch)[] = ['locale', 'acceptLanguages', 'timezone', 'geolocation', 'platform', 'notifications'];

  // Only the shell's own pages (chrome, settings, overlay) may call in, and only these calls; each
  // acts on the window the calling page is in.
  const handlers = (win: ShellWindow): Handlers => ({
    beginAddress: () => win.beginAddress(),
    suggestAddress: (session, sequence, input) => win.suggestAddress(session, sequence, input),
    selectAddress: (session, sequence, active) => win.selectAddress(session, sequence, active),
    chooseAddress: (session, sequence, id) => win.chooseAddress(session, sequence, id),
    submitAddress: (session, input) => win.submitAddress(session, input),
    testSuggestionBounds: () => win.overlay.getBounds(),
    testSuggestionMouse: async (x, y) => {
      if (process.env.CAVE_TEST_HARNESS !== '1' || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error('forbidden');
      win.overlay.webContents.focus();
      await win.chrome.webContents.executeJavaScript("document.querySelector('#address')?.blur()");
      await new Promise(resolve => setTimeout(resolve, 30));
      win.overlay.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      win.overlay.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    },
    cancelAddress: (session, focus) => win.cancelAddress(session, focus),
    getState: () => win.state,
    respondHttpAuth: (id, credentials) => win.respondHttpAuth(id, credentials),
    respondPermission: (id, decision) => win.respondPermission(id, decision),
    retryTab: (id, generation) => win.retryTab(id, generation),
    backFromError: (id, generation) => win.backFromError(id, generation),
    continueCertificate: (id, generation) => win.continueCertificate(id, generation),
    recoveryStatus: (id, generation) => win.recoveryStatus(id, generation),
    clearData: async (options) => {
      if (!options || !Number.isSafeInteger(options.from) || !Number.isSafeInteger(options.to) || options.from < 0 || options.to < options.from || !['history', 'siteData', 'cache', 'downloads'].every(key => typeof (options as unknown as Record<string, unknown>)[key] === 'boolean')) throw new Error('invalid options');
      if (options.history) {
        history.removeRange(options.from, options.to);
        if (options.from === 0 && options.to >= Date.now()) {
          browser.certificateRevoking = true;
          try { browser.certificates.clear(); browser.invalidateCertificates(); await browserSession().closeAllConnections(); browser.clearHistoryMemory(); }
          finally { browser.certificateRevoking = false; }
        }
      }
      if (options.downloads) browser.downloads.clearRange(options.from, options.to);
      if (options.siteData || options.cache) {
        favicons.clear();
        browser.clearFavicons();
        browser.cancelPermissions();
        const dataTypes: Electron.ClearDataOptions['dataTypes'] = [];
        if (options.siteData) dataTypes.push('cookies', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL', 'backgroundFetch');
        if (options.cache) dataTypes.push('cache');
        await browserSession().closeAllConnections();
        await browserSession().clearData({ dataTypes });
        if (options.siteData) { await browserSession().clearStorageData({ storages: ['cachestorage'] }); await browserSession().clearAuthCache(); browser.reloadWebTabs(); }
      }
    },
    historyDelete: (urls) => { if (Array.isArray(urls) && urls.length <= 100 && urls.every(url => typeof url === 'string' && url.length <= 2048)) history.removeMany(urls); },
    historyList: (query, before, limit) => {
      if (typeof query !== 'string' || query.length > 256 || (before !== null && (!Number.isSafeInteger(before) || before < 0)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return [];
      return history.list(query, before, limit).map(row => ({ url: row.url, title: row.title, lastVisit: row.last_visit, visits: row.visits, favicon: favicons.get(row.url) }));
    },
    shortcuts: () => shortcuts.list(),
    saveShortcut: (input) => { shortcuts.save(input); browser.broadcast(); },
    removeShortcut: (id) => { shortcuts.remove(id); browser.broadcast(); },
    newTab: (url) => void win.newTab(url),
    closeTab: (id) => win.closeTab(id),
    reopenClosedTab: () => win.reopenClosedTab(),
    pinTab: (id, pinned) => win.pinTab(id, pinned),
    moveTab: (id, index) => win.moveTab(id, index),
    duplicateTab: (id) => win.duplicateTab(id),
    setTabMuted: (id, muted) => win.setTabMuted(id, muted),
    activate: (id) => win.activate(id),
    navigate: (input) => win.navigate(input),
    run: (command) => browser.run(command, win),
    find: (text, forward) => win.find(text, forward),
    stopFind: (keepSelection) => win.stopFind(keepSelection === true),
    focusPage: () => win.focusPage(),
    openSettings: (section) => win.openSettings(section),
    importBookmarks: async () => {
      const testPath = process.env.CAVE_TEST_HARNESS === '1' ? process.env.CAVE_TEST_BOOKMARK_FILE : undefined;
      const selected = testPath ? [testPath] : (await dialog.showOpenDialog(win.win, { properties: ['openFile'], filters: [{ name: 'HTML', extensions: ['html', 'htm'] }] })).filePaths;
      if (!selected.length) return { added: 0, skipped: 0 };
      if ((await stat(selected[0])).size > MAX_BOOKMARK_FILE) throw new Error('Bookmark file too large');
      const data = await readFile(selected[0]);
      if (data.length > MAX_BOOKMARK_FILE) throw new Error('Bookmark file too large');
      const parsed = parseBookmarks(data.toString('utf8'));
      const added = insertBookmarks(bookmarks, parsed.nodes, t('bookmarks_imported'));
      browser.broadcast(); return { added, skipped: parsed.skipped };
    },
    bookmarkChildren: (parent) => { if (parent !== null && (!Number.isSafeInteger(parent) || parent <= 0)) throw new Error('invalid parent'); return bookmarks.children(parent).map(row => ({ ...row, favicon: row.url ? favicons.get(row.url) : null })); },
    bookmarkMove: (id, parent, position) => { if (!Number.isSafeInteger(id) || id <= 0 || (parent !== null && (!Number.isSafeInteger(parent) || parent <= 0)) || !Number.isSafeInteger(position) || position < 0) throw new Error('invalid move'); bookmarks.move(id, parent, position); browser.broadcast(); },
    bookmarkAdd: (parent, kind, title, url) => { validateBookmark(kind, title, url); const id = bookmarks.add({ parent, kind, title, url }); browser.broadcast(); return id; },
    bookmarkUpdate: (id, title, url) => { if (!Number.isSafeInteger(id) || id <= 0) throw new Error('invalid id'); const row = database.prepare('SELECT kind FROM bookmarks WHERE id=?').get(id); if (!row) return; validateBookmark(row.kind as 'link' | 'folder', title, url); bookmarks.update(id, { title, url }); browser.broadcast(); },
    bookmarkRemove: (id) => { if (!Number.isSafeInteger(id) || id <= 0) throw new Error('invalid id'); bookmarks.remove(id); browser.broadcast(); },
    toggleSurface: (name) => { if (name === 'menu') win.toggleMenu(); else if (name === 'bookmarkEdit') win.toggleBookmark(); else if (name === 'siteInfo' || name === 'status' || name === 'downloads') win.surfaces.toggle(name); },
    openAddressMenu: (anchor) => win.openAddressMenu(anchor),
    openTabMenu: (id, anchor) => win.openTabMenu(id, anchor),
    openShortcutMenu: (id, anchor) => win.openShortcutMenu(id, anchor),
    contextAction: (token, id) => win.contextAction(token, id),
    closeSurface: () => { if (win.surfaces.state?.name === 'restoreSession') browser.discardSession(); else win.surfaces.close(); },
    restoreSession: () => browser.acceptSession(),
    discardSession: () => browser.discardSession(),
    setSurfaceBounds: (session, sequence, bounds, generation) => win.setSuggestionBounds(session, sequence, bounds, generation),
    setAnchors: (anchors) => win.surfaces.setAnchors(anchors),
    setAccent: (accent) => browser.setAccent(accent),
    setTheme: (theme) => browser.setTheme(theme),
    setTabLayout: (layout) => browser.setTabLayout(layout === 'side' ? 'side' : 'top'),
    setSidebarWidth: (width) => browser.setSidebarWidth(width),
    setRestoreSession: (enabled) => browser.setRestoreSession(enabled),
    setSearchEngine: (engine) => browser.setSearchEngine(engine),
    setLocale: (locale) => browser.setLocale(locale === 'zh' || locale === 'en' ? locale : 'system'),
    listDownloads: () => browser.downloads.all(),
    downloadAction: (id, action) => browser.downloads.action(id, action),
    siteInfo: async () => {
      const active = win.state.tabs.find(tab => tab.id === win.state.active && tab.kind === 'web');
      const origin = active && allowedSiteOrigin(active.url, [active.url]);
      if (!origin) return { permissions: [], cookies: 0, certificate: null };
      const certificate = origin.startsWith('https:') && !active?.error ? win.currentCertificate : null;
      const cookies = await browserSession().cookies.get({ url: origin });
      return { permissions: siteSettings.listPermissions().filter(p => p.origin === origin), cookies: cookies.length, certificate };
    },
    panelData,
    removePermission: (origin, permission) => {
      if (!siteSettings.listPermissions().some(p => p.origin === origin && p.permission === permission)) return;
      browser.cancelPermissions();
      siteSettings.delete(origin, `permission:${permission}`);
    },
    updateProfile: async (patch) => {
      browser.cancelPermissions();
      const before = profile();
      // A connection change must shut the old route down before the new one is saved or applied:
      // mode switches and external-endpoint edits restart the core on the new outbound, while a
      // monitor-URL-only edit just invalidates the last check and re-measures through it.
      const routeChanged = (patch.connectionMode !== undefined && patch.connectionMode !== before.connectionMode)
        || (patch.externalProxy !== undefined && JSON.stringify(patch.externalProxy) !== JSON.stringify(before.externalProxy));
      const monitorChanged = patch.monitorUrls !== undefined && JSON.stringify(patch.monitorUrls) !== JSON.stringify(before.monitorUrls);
      const wasPaused = gate.view.paused;
      if (routeChanged) await gate.pause();
      let next;
      try {
        next = await store.update(patch);
      } catch (err) {
        // The save failed, so the old route is still the configured one: restore it instead of
        // leaving the gate paused with the core stopped.
        if (routeChanged && !wasPaused) await gate.resume();
        throw err;
      }
      if (RESTART_FIELDS.some((k) => JSON.stringify(before[k]) !== JSON.stringify(next[k]))) restartNeeded = true;
      if (before.egressCountry !== next.egressCountry) await gate.setCountry(next.egressCountry);
      if (before.allowPrivateNetwork !== next.allowPrivateNetwork) await gate.refreshConfig();
      if (routeChanged && !wasPaused) await gate.resume();
      else if (monitorChanged) await gate.recheck();
      return panelData();
    },
    importSubscriptionFile: async () => {
      const r = await dialog.showOpenDialog(win.win, { title: t('importSubscription'), filters: [{ name: 'Clash YAML', extensions: ['yaml', 'yml', 'txt'] }], properties: ['openFile'] });
      if (r.canceled || !r.filePaths[0]) return false;
      await gate.importSubscription(await readFile(r.filePaths[0], 'utf8'), { kind: 'file', filename: basename(r.filePaths[0]) }, basename(r.filePaths[0]));
      return true;
    },
    importSubscriptionText: (text) => gate.importSubscription(text, { kind: 'text' }, t('set.nodes.pasted')),
    addSubscription: (url, via) => gate.addSubscription(url, via),
    updateSource: (id) => gate.updateSource(id),
    updateSourceFile: async (id) => {
      if (typeof id !== 'string' || !profile().proxy.sources.some(s => s.id === id && s.origin.kind === 'file')) throw new Error('invalid source');
      const r = await dialog.showOpenDialog(win.win, { title: t('importSubscription'), filters: [{ name: 'Clash YAML', extensions: ['yaml', 'yml', 'txt'] }], properties: ['openFile'] });
      if (r.canceled || !r.filePaths[0]) return false;
      await gate.updateSourceContent(id, await readFile(r.filePaths[0], 'utf8'), 'file', basename(r.filePaths[0]));
      return true;
    },
    updateSourceText: (id, text) => gate.updateSourceContent(id, text, 'text'),
    renameSource: (id, name) => gate.renameSource(id, name),
    removeSource: (id) => gate.removeSource(id),
    selectNode: (source, name) => gate.select(source, name),
    testDelays: () => gate.delays(),
    pause: () => gate.pause(),
    resume: () => gate.resume(),
    restartAndCheck: () => gate.restartAndCheck(),
    runChecks,
    copyReport: async () => {
      const items = await runChecks();
      clipboard.writeText(renderReport(items, gate.view, profile(), new Date()));
    },
    // Site data is only ever cleared on request, from the panel, after the user confirmed it there.
    clearSite: async (url) => {
      const origin = allowedSiteOrigin(url, [...win.state.tabs.filter(tab => tab.kind === 'web').map(tab => tab.url), win.state.site]);
      if (!origin) throw new Error('forbidden');
      browser.cancelPermissions();
      browser.certificateRevoking = true;
      try {
        const host = new URL(origin).hostname;
        browser.certificates.clearHost(host);
        browser.invalidateCertificates(host);
        await browserSession().closeAllConnections();
        await browserSession().clearData({ origins: [origin] });
        await browserSession().clearAuthCache();
        favicons.clear(origin);
        browser.clearFavicons(origin);
        browser.clearOriginSettings(origin);
        browser.reloadOrigin(origin);
      } finally { browser.certificateRevoking = false; }
    },
    resetEnvironment: async () => {
      browser.cancelPermissions();
      browser.certificateRevoking = true;
      try {
        browser.certificates.clear();
        browser.invalidateCertificates();
        await browserSession().closeAllConnections();
        await Promise.all([browserSession().clearData(), browserSession().clearAuthCache()]);
        favicons.clear();
        browser.clearFavicons();
        clearBrowsingData(database);
        browser.reset();
      } finally { browser.certificateRevoking = false; }
    },
    revealProfile: () => electronShell.openPath(profileDir),
    restart: () => {
      app.relaunch();
      app.quit();
    },
  });
  const bound = new WeakMap<ShellWindow, Handlers>();
  for (const name of Object.keys(CALLS) as (keyof Handlers)[]) {
    ipcMain.handle(channel(name), (e: IpcMainInvokeEvent, ...args) => {
      const win = browser.windowOf(e.sender);
      if (!win) throw new Error('forbidden');
      if ((name === 'retryTab' || name === 'backFromError' || name === 'recoveryStatus' || name === 'continueCertificate') && e.sender !== win.recovery.webContents) return;
      if (e.sender === win.recovery.webContents && !['getState', 'retryTab', 'backFromError', 'recoveryStatus', 'continueCertificate'].includes(name)) return;
      if (['testSuggestionMouse', 'testSuggestionBounds'].includes(name) && (process.env.CAVE_TEST_HARNESS !== '1' || e.sender !== win.chrome.webContents)) return;
      if (['beginAddress', 'suggestAddress', 'submitAddress'].includes(name) && e.sender !== win.chrome.webContents) return;
      if (['selectAddress', 'chooseAddress', 'cancelAddress'].includes(name) && e.sender !== win.chrome.webContents && e.sender !== win.overlay.webContents) return;
      if ((name === 'openTabMenu' || name === 'openAddressMenu' || name === 'setAnchors') && e.sender !== win.chrome.webContents) return;
      if (name === 'openShortcutMenu' && !win.isActiveHome(e.sender)) return;
      if (name === 'toggleSurface' && e.sender !== win.chrome.webContents && e.sender !== win.overlay.webContents) return;
      if (name === 'setSurfaceBounds' && e.sender !== win.overlay.webContents) return;
      if ((name === 'historyList' || name === 'historyDelete') && e.sender !== win.history.webContents) return;
      if (e.sender === win.history.webContents && !['getState', 'historyList', 'historyDelete', 'newTab'].includes(name)) return;
      if (e.sender === win.history.webContents && name === 'newTab' && (typeof args[0] !== 'string' || args[0].length > 2048 || !/^https?:\/\//i.test(args[0]) || !URL.canParse(args[0]))) return;
      if (name === 'importBookmarks' && e.sender !== win.bookmarks.webContents) return;
      if (['bookmarkChildren', 'bookmarkMove'].includes(name) && e.sender !== win.chrome.webContents && e.sender !== win.bookmarks.webContents) return;
      if (['bookmarkAdd', 'bookmarkUpdate', 'bookmarkRemove'].includes(name) && e.sender !== win.chrome.webContents && e.sender !== win.overlay.webContents && e.sender !== win.bookmarks.webContents) return;
      if (e.sender === win.bookmarks.webContents && !['getState', 'bookmarkChildren', 'bookmarkMove', 'bookmarkAdd', 'bookmarkUpdate', 'bookmarkRemove', 'importBookmarks', 'newTab'].includes(name)) return;
      if (e.sender === win.bookmarks.webContents && name === 'newTab' && (typeof args[0] !== 'string' || args[0].length > 2048 || !/^https?:\/\//i.test(args[0]) || !URL.canParse(args[0]))) return;
      if (['clearData', 'updateProfile', 'importSubscriptionFile', 'importSubscriptionText', 'addSubscription', 'updateSource', 'updateSourceFile', 'updateSourceText', 'renameSource', 'removeSource', 'selectNode', 'testDelays'].includes(name) && e.sender !== win.settings.webContents) throw new Error('forbidden');
      if (name === 'siteInfo' && e.sender !== win.overlay.webContents) return;
      if (name === 'removePermission' && e.sender !== win.settings.webContents) {
        const active = win.state.tabs.find(tab => tab.id === win.state.active && tab.kind === 'web');
        if (e.sender !== win.overlay.webContents || !active || args[0] !== allowedSiteOrigin(active.url, [active.url])) return;
      }
      if ((name === 'respondPermission' || name === 'respondHttpAuth') && e.sender !== win.overlay.webContents) return;
      if (name === 'contextAction' && e.sender !== win.overlay.webContents) return;
      if (!bound.has(win)) bound.set(win, handlers(win));
      return (bound.get(win)![name] as (...args: unknown[]) => unknown)(...args);
    });
  }

  app.on('second-instance', () => { if (!backgroundE2e) browser.current?.win.focus(); });
  app.on('before-quit', () => { browser.prepareQuit(); void gate.quit(); });

  if (startup.action === 'restore') browser.restore(startup.snapshot);
  else {
    const win = browser.newWindow(process.argv.find((a) => /^https?:\/\//.test(a)));
    // A new environment has no route to enable yet: start at the node import screen.
    if (!profile().proxy.sources.some(source => source.nodes.length > 0)) win.openSettings('nodes');
    if (startup.action === 'offer') browser.offerSession(startup.snapshot, win);
  }
  await gate.start();

}

function validateBookmark(kind: unknown, title: unknown, url: unknown): void {
  if ((kind !== 'link' && kind !== 'folder') || typeof title !== 'string' || title.length > 1024) throw new Error('invalid bookmark');
  if (kind === 'folder' ? url !== null : typeof url !== 'string' || url.length > 2048 || !URL.canParse(url) || !['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('invalid bookmark URL');
}
