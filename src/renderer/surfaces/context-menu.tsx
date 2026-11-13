import { t } from '../../shared/i18n/index.ts';
import type { ShellState } from '../../shared/ipc.ts';
import { cave } from '../bridge.ts';
import { Surface } from '../ui/index.tsx';
import { Menu } from '../ui/menu.tsx';

const icons: Record<string, string> = { edit: 'pencil', remove: 'trash-2', 'tab.new': 'plus', 'window.new': 'app-window', 'history.open': 'history', 'bookmarks.open': 'bookmark', 'downloads.open': 'download', 'zoom.out': 'zoom-out', 'zoom.reset': 'search', 'zoom.in': 'zoom-in', 'page.print': 'printer', 'settings.open': 'settings', 'page.back': 'arrow-left', 'page.forward': 'arrow-right', 'page.reload': 'rotate-cw', 'tab.close': 'x', copy: 'copy', copyLink: 'copy', paste: 'clipboard-paste', openLink: 'external-link', 'tab.pin': 'pin', 'tab.duplicate': 'copy', 'tab.mute': 'volume-2', 'tab.reopen': 'history', cut: 'scissors', selectAll: 'list-checks', 'address.pasteAndGo': 'clipboard-paste', openImage: 'image', copyImage: 'copy', saveImage: 'download', undo: 'undo-2', redo: 'redo-2', inspect: 'scan-search' };

export function ContextMenu({ state, open }: { state: ShellState; open: boolean }) {
  const menu = state.contextMenu;
  if (!menu || !state.surface) return null;
  const name = state.surface.name;
  const label = t(name === 'menu' ? 'menu' : menu.items.some(i => !('separator' in i) && i.id === 'tab.close') ? 'tabMenu' : 'pageMenu');
  const showIcons = menu.items.every(item => 'separator' in item || !!icons[item.id]);
  return <Surface open={open} name={name} anchor={state.surface.anchor} prefer={name === 'contextMenu' ? 'bottom-right' : state.tabLayout === 'side' ? 'top' : 'bottom'} label={label}>
    <Menu closeOnAction={false} ariaLabel={label} items={menu.items.map(item => 'separator' in item ? item : { label: item.label, icon: showIcons ? icons[item.id] : undefined, disabled: !item.enabled, checked: item.checked, shortcut: item.shortcut, action: () => { void cave.contextAction(menu.token, item.id); } })} onClose={() => { void cave.closeSurface(); }} />
  </Surface>;
}
