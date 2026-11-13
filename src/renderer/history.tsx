import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { HistoryRow } from '../shared/ipc.ts';
import { Icon } from './ui/index.tsx';
import { historyDay, t } from '../shared/i18n/index.ts';
import { cave } from './bridge.ts';
import { useCave } from './ui/index.tsx';

function History() {
  const state = useCave();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [more, setMore] = useState(false);
  const sequence = useRef(0);
  const load = async (text: string, before: number | null = null) => {
    const id = ++sequence.current;
    const next = await cave.historyList(text, before, 50);
    if (id !== sequence.current) return;
    setRows(old => before === null ? next : [...old, ...next]);
    setMore(next.length === 50);
  };
  useEffect(() => { if (state?.tabs.find(tab => tab.id === state.active)?.kind === 'history') { setSelected([]); void load(query); } return () => { sequence.current++; }; }, [state?.active, query]);
  const remove = async (urls: string[]) => { for (let i = 0; i < urls.length; i += 100) await cave.historyDelete(urls.slice(i, i + 100)); setSelected([]); await load(query); };
  let day = '';
  return <main><h1>{t('command_history_open')}</h1><div class="toolbar"><input type="search" value={query} maxLength={256} placeholder={t('history_search')} aria-label={t('history_search')} onInput={e => setQuery(e.currentTarget.value)} />{selected.length > 0 && <button class="btn" onClick={() => void remove(selected)}>{t('history_delete')} ({selected.length})</button>}</div>{!rows.length && <p>{t('history_empty')}</p>}{rows.map(row => {
    const date = new Date(row.lastVisit), label = historyDay(date);
    const heading = day !== label; day = label;
    return <section key={`${row.url}:${row.lastVisit}`}>{heading && <h2>{label}</h2>}<div class="row"><input type="checkbox" aria-label={`${t('history_select')}: ${row.title || row.url}`} checked={selected.includes(row.url)} onChange={e => setSelected(old => e.currentTarget.checked ? [...old, row.url] : old.filter(url => url !== row.url))} /><button class="visit" onClick={() => void cave.newTab(row.url)}><time>{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>{row.favicon ? <img class="row-favicon" src={row.favicon} alt="" /> : <Icon name="globe" />}<span><strong>{row.title || row.url}</strong><small>{row.url}</small></span></button><button class="btn" aria-label={`${t('history_delete')}: ${row.title || row.url}`} onClick={() => void remove([row.url])}>{t('history_delete')}</button></div></section>;
  })}{more && <button class="btn" onClick={() => void load(query, rows[rows.length - 1].lastVisit)}>{t('history_more')}</button>}</main>;
}
render(<History />, document.body);
