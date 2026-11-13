import { useEffect, useRef, useState } from 'preact/hooks';
import { label, accelerator, type CommandId } from '../../shared/commands.ts';
import { Icon } from './index.tsx';
import { nextEnabled, typeAhead } from './logic.ts';

export type MenuItem = { separator: true } | { id?: CommandId; label?: string; icon?: string; shortcut?: string; disabled?: boolean; checked?: boolean; items?: readonly MenuItem[]; action?: () => void };
type ActionItem = Exclude<MenuItem, { separator: true }>;
const separator = (item: MenuItem): item is { separator: true } => 'separator' in item;
const labelOf = (item: MenuItem) => separator(item) ? '' : item.label ?? (item.id ? label(item.id) : '');
function shortcut(item: ActionItem, mac: boolean): string {
  return (item.shortcut ?? (item.id ? accelerator(item.id, mac) : '') ?? '').replaceAll('CmdOrCtrl', mac ? '⌘' : 'Ctrl').replaceAll('Cmd', '⌘').replaceAll('Alt', mac ? '⌥' : 'Alt').replaceAll('Shift', mac ? '⇧' : 'Shift').replaceAll('Ctrl', mac ? '⌃' : 'Ctrl').replaceAll(mac ? '+' : '\0', '');
}
export function Menu({ items, onCommand, onClose, mac = /Mac/i.test(navigator.platform), opener, nested = false, onDismissAll, ariaLabel, closeOnAction = true }: { items: readonly MenuItem[]; onCommand?: (id: CommandId) => void; onClose: () => void; mac?: boolean; opener?: HTMLElement | null; nested?: boolean; onDismissAll?: () => void; ariaLabel?: string; closeOnAction?: boolean }) {
  const disabled = items.map(i => separator(i) || !!i.disabled);
  const [active, setActive] = useState(-1);
  const [child, setChild] = useState(-1);
  const menuRef = useRef<HTMLDivElement>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]); const typed = useRef(''); const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { const previous = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null); menuRef.current?.focus(); return () => { clearTimeout(timer.current); if (!nested && opener) previous?.focus(); }; }, []);
  const focus = (i: number) => { if (i >= 0) { setActive(i); setChild(-1); refs.current[i]?.focus(); refs.current[i]?.scrollIntoView({ block: 'nearest' }); } };
  const invoke = (i: number) => { const item = items[i]; if (!item || separator(item) || item.disabled) return; if (item.items) { setChild(i); return; } item.action?.(); if (item.id) onCommand?.(item.id); if (closeOnAction) (onDismissAll ?? onClose)(); };
  return <div ref={menuRef} class="ui-menu" role="menu" tabIndex={-1} aria-label={ariaLabel} onKeyDown={e => {
    e.stopPropagation(); let index = -1;
    if (e.key === 'ArrowDown') index = nextEnabled(disabled, active, 1);
    else if (e.key === 'ArrowUp') index = nextEnabled(disabled, active < 0 ? 0 : active, -1);
    else if (e.key === 'Home') index = nextEnabled(disabled, -1, 1);
    else if (e.key === 'End') index = nextEnabled(disabled, 0, -1);
    else if (e.key === 'ArrowRight') { const item = items[active]; if (item && !separator(item) && item.items && !item.disabled) setChild(active); e.preventDefault(); return; }
    else if (e.key === 'Tab' || e.key === 'ArrowLeft' && nested || e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); invoke(active); return; }
    else if (!e.isComposing && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { typed.current += e.key; clearTimeout(timer.current); timer.current = setTimeout(() => { typed.current = ''; }, 700); index = typeAhead(items.map(labelOf), disabled, typed.current, active); }
    else return;
    e.preventDefault(); focus(index);
  }}>{items.map((item, i) => separator(item) ? <div role="separator" class="ui-menu-separator" /> : <div class="ui-menu-row"><button type="button" role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={item.checked} aria-haspopup={item.items ? 'menu' : undefined} aria-expanded={item.items ? child === i : undefined} disabled={item.disabled} tabIndex={i === active ? 0 : -1} ref={el => { refs.current[i] = el; }} onFocus={() => setActive(i)} onClick={() => invoke(i)}><span class="ui-menu-check">{item.checked ? '✓' : item.icon ? <Icon name={item.icon} /> : null}</span><span>{labelOf(item)}</span><span class="ui-menu-shortcut">{item.items ? '›' : shortcut(item, mac)}</span></button>{child === i && item.items && <Menu items={item.items} onCommand={onCommand} mac={mac} nested onDismissAll={onDismissAll ?? onClose} opener={refs.current[i]} onClose={() => { setChild(-1); refs.current[i]?.focus(); }} />}</div>)}</div>;
}
