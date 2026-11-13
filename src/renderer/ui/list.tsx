import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { nextEnabled, typeAhead } from './logic.ts';

export type ListItem = { id: string; label: string; disabled?: boolean; content?: ComponentChildren };
export function List({ items, onSelect, label, selected, onHover }: { items: readonly ListItem[]; onSelect: (id: string) => void; label: string; selected?: number; onHover?: (index: number) => void }) {
  const [active, setActive] = useState(() => nextEnabled(items.map(i => !!i.disabled), -1, 1));
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const typed = useRef(''); const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const disabled = items.map(i => !!i.disabled);
  const focus = (index: number) => { if (index >= 0) { setActive(index); refs.current[index]?.focus(); } };
  return <div class="ui-list" role="listbox" aria-label={label} onKeyDown={e => {
    let index = -1;
    if (e.key === 'ArrowDown') index = nextEnabled(disabled, active, 1);
    else if (e.key === 'ArrowUp') index = nextEnabled(disabled, active, -1);
    else if (e.key === 'Home') index = nextEnabled(disabled, -1, 1);
    else if (e.key === 'End') index = nextEnabled(disabled, 0, -1);
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
      typed.current += e.key; clearTimeout(timer.current); timer.current = setTimeout(() => { typed.current = ''; }, 700);
      index = typeAhead(items.map(i => i.label), disabled, typed.current, active);
    } else return;
    e.preventDefault(); focus(index);
  }}>{items.map((item, i) => <button type="button" role="option" aria-selected={i === (selected ?? active)} disabled={item.disabled} tabIndex={i === active ? 0 : -1} ref={el => { refs.current[i] = el; }} onFocus={() => setActive(i)} onMouseDown={e => { if (selected !== undefined) e.preventDefault(); }} onMouseEnter={() => onHover?.(i)} onClick={() => onSelect(item.id)}>{item.content ?? item.label}</button>)}</div>;
}
