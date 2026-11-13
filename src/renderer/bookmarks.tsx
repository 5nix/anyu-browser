import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Bookmark } from '../shared/ipc.ts';
import { t } from '../shared/i18n/index.ts';
import { cave } from './bridge.ts';
import { Icon, useCave } from './ui/index.tsx';

function Manager() {
  const state = useCave();
  const [path, setPath] = useState<Bookmark[]>([]);
  const [rows, setRows] = useState<Bookmark[]>([]);
  const [folders, setFolders] = useState<{ id: number | null; label: string }[]>([]);
  const [editing, setEditing] = useState<{ id?: number; kind: 'folder' | 'link'; title: string; url: string } | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const parent = path.at(-1)?.id ?? null;
  const load = async () => {
    const id = ++sequence.current;
    try {
      const next = await cave.bookmarkChildren(parent);
      const all: { id: number | null; label: string }[] = [{ id: null, label: t('bookmarks_root') }];
      const walk = async (p: number | null, prefix: string, depth: number) => {
        if (depth > 16) return;
        for (const row of await cave.bookmarkChildren(p)) if (row.kind === 'folder') { const label = `${prefix} / ${row.title}`; all.push({ id: row.id, label }); await walk(row.id, label, depth + 1); }
      };
      await walk(null, t('bookmarks_root'), 0);
      if (id === sequence.current) { setRows(next); setFolders(all); setError(false); }
    } catch { if (id === sequence.current) setError(true); }
  };
  useEffect(() => { if (state?.tabs.find(tab => tab.id === state.active)?.kind === 'bookmarks') void load(); return () => { sequence.current++; }; }, [state, parent]);
  const run = async (action: () => Promise<unknown>) => { if (busy) return; setBusy(true); try { await action(); setError(false); await load(); } catch { setError(true); } finally { setBusy(false); } };
  const save = () => { if (!editing) return; void run(async () => { if (editing.id) await cave.bookmarkUpdate(editing.id, editing.title, editing.kind === 'folder' ? null : editing.url); else await cave.bookmarkAdd(parent, editing.kind, editing.title, editing.kind === 'folder' ? null : editing.url); setEditing(null); }); };
  return <main><h1>{t('command_bookmarks_open')}</h1><div class="manager-heading"><nav aria-label={t('bookmarks_root')}>
    {path.length ? <button onClick={() => setPath([])}>{t('bookmarks_root')}</button> : <span>{t('bookmarks_root')}</span>}
    {path.map((folder, i) => <span class="crumb" key={folder.id}><Icon name="chevron-right" />{i === path.length - 1 ? <span aria-current="page">{folder.title}</span> : <button onClick={() => setPath(path.slice(0, i + 1))}>{folder.title}</button>}</span>)}
    </nav><div class="toolbar"><button class="btn" onClick={() => setEditing({ kind: 'folder', title: '', url: '' })}><Icon name="folder-plus" />{t('bookmarks_folder')}</button><button class="btn" onClick={() => setEditing({ kind: 'link', title: '', url: '' })}><Icon name="plus" />{t('bookmarks_link')}</button><button class="btn" disabled={busy} onClick={() => void run(async () => { setResult(await cave.importBookmarks()); })}><Icon name="upload" />{t('bookmarks_import')}</button></div></div>
    {result && <p role="status">{t('bookmarks_import_result', result)}</p>}
    {error && <p role="alert">{t('bookmarks_error')}</p>}
    {editing && <form onSubmit={e => { e.preventDefault(); save(); }} onKeyDown={e => { if (e.key === 'Escape') setEditing(null); }}><label>{t('bookmarks_title')}<input autoFocus value={editing.title} maxLength={1024} onInput={e => setEditing({ ...editing, title: e.currentTarget.value })} /></label>{editing.kind === 'link' && <label>{t('bookmarks_url')}<input type="url" required value={editing.url} maxLength={2048} onInput={e => setEditing({ ...editing, url: e.currentTarget.value })} /></label>}<button class="btn" disabled={busy}>{t('bookmarks_save')}</button><button type="button" class="btn" onClick={() => setEditing(null)}>{t('bookmarks_cancel')}</button></form>}
    {!rows.length && <p>{t('bookmarks_empty')}</p>}{rows.map((row, i) => <div class="row" key={row.id}><button class="visit" onClick={() => row.kind === 'folder' ? setPath([...path, row]) : void cave.newTab(row.url!)}>{row.favicon ? <img class="row-favicon" src={row.favicon} alt="" /> : <Icon name={row.kind === 'folder' ? 'folder' : 'globe'} />}<span><strong>{row.title || row.url}</strong>{row.kind === 'link' && <small>{row.url}</small>}</span></button><div class="row-actions">
      <button class="icon-action" aria-label={t('bookmarks_edit')} title={t('bookmarks_edit')} onClick={() => setEditing({ id: row.id, kind: row.kind, title: row.title, url: row.url ?? '' })}><Icon name="pencil" /></button>
      <button class="icon-action" aria-label={t('bookmarks_up')} title={t('bookmarks_up')} disabled={busy || i === 0} onClick={() => void run(() => cave.bookmarkMove(row.id, parent, i - 1))}><Icon name="arrow-up" /></button>
      <button class="icon-action" aria-label={t('bookmarks_down')} title={t('bookmarks_down')} disabled={busy || i === rows.length - 1} onClick={() => void run(() => cave.bookmarkMove(row.id, parent, i + 1))}><Icon name="arrow-down" /></button>
      <select class="move-control" aria-label={`${t('bookmarks_move')}: ${row.title}`} title={t('bookmarks_move')} value="" onChange={e => { const value = e.currentTarget.value; if (value !== '') void run(() => cave.bookmarkMove(row.id, value === 'root' ? null : Number(value), 20000)); e.currentTarget.value = ''; }}><option value="">{t('bookmarks_move')}</option>{folders.filter(f => f.id !== row.id && f.id !== parent).map(f => <option value={f.id ?? 'root'}>{f.label}</option>)}</select>
      <button class="icon-action" aria-label={t('bookmarks_delete')} title={t('bookmarks_delete')} disabled={busy} onClick={() => void run(async () => { if (row.kind === 'folder' && (await cave.bookmarkChildren(row.id)).length) setConfirm(row.id); else await cave.bookmarkRemove(row.id); })}><Icon name="trash-2" /></button></div>{confirm === row.id && <span class="confirmation" role="alert">{t('bookmarks_confirm')} <button class="btn" onClick={() => void run(async () => { await cave.bookmarkRemove(row.id); setConfirm(null); })}>{t('bookmarks_delete')}</button><button class="btn" onClick={() => setConfirm(null)}>{t('bookmarks_cancel')}</button></span>}</div>)}
  </main>;
}
render(<Manager />, document.body);
