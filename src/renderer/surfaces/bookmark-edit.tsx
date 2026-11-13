import { useEffect, useState } from 'preact/hooks';
import type { ShellState } from '../../shared/ipc.ts';
import { t } from '../../shared/i18n/index.ts';
import { cave } from '../bridge.ts';
import { Popover } from '../ui/popover.tsx';

export function BookmarkEdit({ state, open }: { state: ShellState; open: boolean }) {
  const initial = state.bookmarkMatches;
  const [title, setTitle] = useState(initial[0]?.title ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => { if (open) { setTitle(state.bookmarkMatches[0]?.title ?? ''); setError(false); setBusy(false); } }, [open]);
  const save = async () => {
    if (busy || !initial[0]) return;
    setBusy(true); setError(false);
    try { await cave.bookmarkUpdate(initial[0].id, title, initial[0].url); await cave.closeSurface(); }
    catch { setError(true); setBusy(false); }
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true); setError(false);
    try { for (const item of initial) await cave.bookmarkRemove(item.id); await cave.closeSurface(); }
    catch { setError(true); setBusy(false); }
  };
  return <Popover name="bookmarkEdit" anchor={state.surface!.anchor} open={open} prefer="bottom-right">
    <form onSubmit={e => { e.preventDefault(); void save(); }}>
      <label>{t('bookmark_title')}<input id="bookmark-title" autoFocus maxLength={1024} value={title} onInput={e => setTitle(e.currentTarget.value)} /></label>
      {initial.length > 1 && <p>{t('bookmark_count', { count: initial.length })}</p>}
      {error && <p role="alert">{t('bookmark_error')}</p>}
      <div class="bookmark-actions"><button type="button" disabled={busy} onClick={() => void remove()}>{t('bookmark_remove')}</button><button type="submit" class="btn primary" disabled={busy}>{t('bookmark_done')}</button></div>
    </form>
  </Popover>;
}
