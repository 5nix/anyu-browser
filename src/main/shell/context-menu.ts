import { accelerator, label, type CommandId } from '../../shared/commands.ts';
import { t, type TranslationKey } from '../../shared/i18n/index.ts';
import type { MenuEntry } from '../../shared/ipc.ts';
const WEB = /^(https?|about|blob|data):/i;

export const validWeb = (url: unknown): url is string => typeof url === 'string' && url.length <= 8192 && URL.canParse(url) && WEB.test(url);
const item = (id: string, key: TranslationKey, enabled = true): MenuEntry => ({ id, label: t(key), enabled });
const command = (id: CommandId, enabled = true): MenuEntry => ({ id, label: label(id), enabled, shortcut: accelerator(id, process.platform === 'darwin') });
const groups = (...parts: MenuEntry[][]): MenuEntry[] => parts.filter(p => p.length).flatMap((p, i) => i ? [{ separator: true } as MenuEntry, ...p] : p);

export function toolbarMenu(web: boolean, zoomable = web): MenuEntry[] {
  return groups([command('tab.new'), command('window.new')], [command('history.open'), command('bookmarks.open'), command('downloads.open')], [command('zoom.out', zoomable), command('zoom.reset', zoomable), command('zoom.in', zoomable)], [command('page.print', web), command('settings.open')]);
}
export function addressMenu(): MenuEntry[] { return [item('cut', 'cut'), item('copy', 'copy'), item('paste', 'paste'), command('address.pasteAndGo'), item('selectAll', 'selectAll')]; }
export function tabMenu(web: boolean, pinned = false, muted = false, canReopen = false): MenuEntry[] { return [command('page.reload', web), item('tab.pin', pinned ? 'tab_unpin' : 'tab_pin', web), command('tab.duplicate', web), item('tab.mute', muted ? 'tab_unmute' : 'tab_mute_menu', web), command('tab.close'), command('tab.reopen', canReopen)]; }
export function pageMenu(p: Electron.ContextMenuParams, back: boolean, forward: boolean, gate: boolean): MenuEntry[] {
  const flags = p.editFlags;
  return groups(
    p.linkURL ? [item('openLink', 'openLink', validWeb(p.linkURL)), item('copyLink', 'copyLink')] : [],
    p.mediaType === 'image' && p.srcURL ? [item('openImage', 'openImage', validWeb(p.srcURL)), item('copyImage', 'copyImage'), item('saveImage', 'saveImage', gate && validWeb(p.srcURL) && /^https?:/i.test(p.srcURL))] : [],
    p.isEditable ? [item('undo', 'undo', flags.canUndo), item('redo', 'redo', flags.canRedo)] : [],
    p.isEditable ? [item('cut', 'cut', flags.canCut), item('copy', 'copy', flags.canCopy), item('paste', 'paste', flags.canPaste), item('selectAll', 'selectAll', flags.canSelectAll)] : p.selectionText ? [item('copy', 'copy', flags.canCopy)] : [],
    [command('page.back', back), command('page.forward', forward), command('page.reload')], [item('inspect', 'inspect')],
  );
}
