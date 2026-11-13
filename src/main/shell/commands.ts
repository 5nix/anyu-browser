import { t } from '../../shared/i18n/index.ts';
// What each command in shared/commands.ts does, and the application menu made from them.
import { app, Menu, type WebContents } from 'electron';
import { COMMANDS, label, accelerators, type CommandId } from '../../shared/commands.ts';
import { mac } from '../platform.ts';
import type { ShellWindow } from './window.ts';

export type Commands = Record<CommandId, (win: ShellWindow) => void>;

export function bindCommands(newWindow: () => void): Commands {
  const page = (fn: (wc: WebContents) => void) => (win: ShellWindow) => {
    const wc = win.current;
    if (wc) fn(wc);
  };
  /** Going somewhere is a turn to the page: it gets the keyboard, as after a press on it. */
  const go = (fn: (wc: WebContents) => void) => (win: ShellWindow) => {
    page(fn)(win);
    win.focusPage();
  };
  return {
    'app.quit': () => app.quit(),
    'window.fullscreen': (win) => win.win.setFullScreen(!win.win.isFullScreen()),
    'window.new': () => newWindow(),
    'tab.new': (win) => void win.newTab(),
    'tab.duplicate': (win) => win.duplicateActive(),
    'tab.mute': (win) => win.muteActive(),
    'tab.pin': (win) => win.pinActive(),
    'tab.reopen': (win) => win.reopenClosedTab(),
    'tab.close': (win) => win.closeActive(),
    'tab.next': (win) => win.cycle(1),
    'tab.previous': (win) => win.cycle(-1),
    'address.pasteAndGo': () => {}, // Available only through the one-shot address menu.
    'address.focus': (win) => win.focusAddress(),
    'page.back': go((wc) => wc.navigationHistory.goBack()),
    'page.forward': go((wc) => wc.navigationHistory.goForward()),
    'page.reload': (win) => { win.reload(); win.focusPage(); },
    'page.reloadHard': (win) => { win.reload(true); win.focusPage(); },
    'page.stop': page((wc) => wc.stop()),
    'page.find': (win) => win.openFind(),
    'page.print': page((wc) => wc.print()),
    'zoom.in': (win) => win.zoom(1),
    'zoom.out': (win) => win.zoom(-1),
    'zoom.reset': (win) => win.zoom(0),
    'devtools.toggle': page((wc) => wc.toggleDevTools()),
    'bookmark.toggle': (win) => win.toggleBookmark(),
    'bookmarks.open': (win) => win.openBookmarks(),
    'history.open': (win) => win.openHistory(),
    'downloads.open': (win) => win.openSettings('downloads'),
    'settings.open': (win) => win.openSettings(),
    'settings.status': (win) => win.openSettings('overview'),
  };
}

/** The application menu: every item is a command, so its label and shortcut come from the table. */
export function appMenu(run: (id: CommandId) => void, canReopen = false): Menu {
  const item = (id: CommandId): Electron.MenuItemConstructorOptions => ({ id, enabled: id !== 'tab.reopen' || canReopen, label: label(id), accelerator: accelerators(id, mac)[0], click: () => run(id) });
  // Invisible menu entries still register accelerators, including when the menu bar is hidden.
  const alternatives = (Object.keys(COMMANDS) as CommandId[]).flatMap((id) => accelerators(id, mac).slice(1).map((key) => ({ id, enabled: id !== 'tab.reopen' || canReopen, label: label(id), accelerator: key, visible: false, click: () => run(id) })));
  const sep = { type: 'separator' as const };
  return Menu.buildFromTemplate([
    ...(mac ? [{ role: 'appMenu' as const, submenu: [{ role: 'about' as const, label: t('about') }, { role: 'services' as const, label: t('services') }, { role: 'hide' as const, label: t('hide') }, { role: 'hideOthers' as const, label: t('hideOthers') }, { role: 'unhide' as const, label: t('unhide') }, sep, item('app.quit')] }] : []),
    {
      label: t('menuFile'),
      submenu: [item('tab.new'), item('window.new'), item('tab.close'), item('tab.reopen'), item('address.focus'), sep, item('page.print'), ...(mac ? [] : [sep, item('app.quit')])],
    },
    { label: t('menuEdit'), submenu: [{ role: 'undo', label: t('undo') }, { role: 'redo', label: t('redo') }, sep, { role: 'cut', label: t('cut') }, { role: 'copy', label: t('copy') }, { role: 'paste', label: t('paste') }, ...(mac ? [{ role: 'pasteAndMatchStyle' as const, label: t('pasteAndMatchStyle') }] : []), { role: 'delete', label: t('deleteText') }, { role: 'selectAll', label: t('selectAll') }, ...(mac ? [sep, { label: t('speech'), submenu: [{ role: 'startSpeaking' as const, label: t('startSpeaking') }, { role: 'stopSpeaking' as const, label: t('stopSpeaking') }] }] : [])] },
    {
      label: t('menuView'),
      submenu: [
        item('page.find'), item('page.reload'), item('page.reloadHard'), sep,
        item('zoom.in'), item('zoom.out'), item('zoom.reset'), sep,
        item('devtools.toggle'), item('window.fullscreen'),
      ],
    },
    { label: t('menuNavigation'), submenu: [item('page.back'), item('page.forward'), item('tab.next'), item('tab.previous')] },
    { label: 'Cave', submenu: [item('bookmark.toggle'), item('bookmarks.open'), item('history.open'), item('downloads.open'), item('settings.open'), item('settings.status'), ...alternatives] },
    ...(mac ? [{ label: t('menuWindow'), submenu: [{ role: 'minimize' as const, label: t('minimize') }, { role: 'zoom' as const, label: t('zoomWindow') }, sep, { role: 'front' as const, label: t('front') }] }] : []),
  ]);
}
