import { t, type TranslationKey } from './i18n/index.ts';

// Everything the user can tell the browser to do without an argument, named once. The
// application menu is built from this table, a shell page runs one with cave.run(id), and the
// main process binds each id to what it does (Shell.commands), so a menu drawn anywhere shows
// the same labels and shortcuts and does the same thing.

export interface CommandSpec {
  label: TranslationKey;
  /** Electron accelerator; macKey replaces it on macOS. */
  key?: string;
  macKey?: string;
  alternatives?: readonly string[];
  macAlternatives?: readonly string[];
}

export const COMMANDS = {
  'app.quit': { label: 'command_app_quit', key: 'Ctrl+Shift+Q', macKey: 'Cmd+Q' },
  'window.fullscreen': { label: 'command_window_fullscreen', key: 'F11', macKey: 'Ctrl+Cmd+F' },
  'window.new': { label: 'command_window_new', key: 'CmdOrCtrl+N' },
  'tab.new': { label: 'command_tab_new', key: 'CmdOrCtrl+T' },
  'tab.duplicate': { label: 'tab_duplicate' },
  'tab.mute': { label: 'tab_mute' },
  'tab.pin': { label: 'command_tab_pin' },
  'tab.reopen': { label: 'command_tab_reopen', key: 'CmdOrCtrl+Shift+T' },
  'tab.close': { label: 'command_tab_close', key: 'CmdOrCtrl+W' },
  'tab.next': { label: 'command_tab_next', key: 'Ctrl+Tab', alternatives: ['Ctrl+PageDown'], macAlternatives: ['Cmd+Alt+Right'] },
  'tab.previous': { label: 'command_tab_previous', key: 'Ctrl+Shift+Tab', alternatives: ['Ctrl+PageUp'], macAlternatives: ['Cmd+Alt+Left'] },
  'address.pasteAndGo': { label: 'command_address_pasteAndGo' },
  'address.focus': { label: 'command_address_focus', key: 'CmdOrCtrl+L' },
  'page.back': { label: 'command_page_back', key: 'Alt+Left', macKey: 'Cmd+[' },
  'page.forward': { label: 'command_page_forward', key: 'Alt+Right', macKey: 'Cmd+]' },
  'page.reload': { label: 'command_page_reload', key: 'CmdOrCtrl+R', alternatives: ['F5'] },
  'page.reloadHard': { label: 'command_page_reloadHard', key: 'CmdOrCtrl+Shift+R' },
  'page.stop': { label: 'command_page_stop' },
  'page.find': { label: 'command_page_find', key: 'CmdOrCtrl+F' },
  'page.print': { label: 'command_page_print', key: 'CmdOrCtrl+P' },
  'zoom.in': { label: 'command_zoom_in', key: 'CmdOrCtrl+=', alternatives: ['CmdOrCtrl+Plus', 'CmdOrCtrl+numadd'], macAlternatives: ['CmdOrCtrl+Plus', 'CmdOrCtrl+numadd'] },
  'zoom.out': { label: 'command_zoom_out', key: 'CmdOrCtrl+-', alternatives: ['CmdOrCtrl+numsub'], macAlternatives: ['CmdOrCtrl+numsub'] },
  'zoom.reset': { label: 'command_zoom_reset', key: 'CmdOrCtrl+0', alternatives: ['CmdOrCtrl+num0'], macAlternatives: ['CmdOrCtrl+num0'] },
  'devtools.toggle': { label: 'command_devtools_toggle', key: 'F12', macKey: 'Alt+Cmd+I', alternatives: ['Ctrl+Shift+I'] },
  'bookmark.toggle': { label: 'command_bookmark_toggle', key: 'CmdOrCtrl+D' },
  'bookmarks.open': { label: 'command_bookmarks_open', key: 'Ctrl+Shift+O', macKey: 'Cmd+Alt+B' },
  'history.open': { label: 'command_history_open', key: 'Ctrl+H', macKey: 'Cmd+Y' },
  'downloads.open': { label: 'command_downloads_open', key: 'Ctrl+J', macKey: 'Cmd+Shift+J' },
  'settings.open': { label: 'command_settings_open', key: 'CmdOrCtrl+,' },
  'settings.status': { label: 'command_settings_status', key: 'CmdOrCtrl+Shift+K' },
} as const satisfies Record<string, CommandSpec>;

export type CommandId = keyof typeof COMMANDS;

export const label = (id: CommandId): string => t(COMMANDS[id].label);

export const isCommand = (id: unknown): id is CommandId => typeof id === 'string' && Object.hasOwn(COMMANDS, id);

export function accelerator(id: CommandId, mac: boolean): string | undefined {
  const spec: CommandSpec = COMMANDS[id];
  return (mac && spec.macKey) || spec.key;
}

/** All bindings, with the displayed accelerator first. */
export function accelerators(id: CommandId, mac: boolean): readonly string[] {
  const spec: CommandSpec = COMMANDS[id];
  const key = accelerator(id, mac);
  return [...(key ? [key] : []), ...(mac ? spec.macAlternatives ?? [] : spec.alternatives ?? [])];
}
