import { cave } from '../bridge.ts';
import type { ShellState } from '../../shared/ipc.ts';
import { t } from '../../shared/i18n/index.ts';
import { Popover } from '../ui/popover.tsx';
import { Icon } from '../ui/index.tsx';

const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
const middle = (name: string) => { const i = name.lastIndexOf('.'); return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, '']; };

export function Downloads({ state, open }: { state: ShellState; open: boolean }) {
  const action = (id: number, command: 'pause' | 'resume' | 'cancel' | 'open' | 'reveal' | 'remove', icon: string, label: string, disabled = false) => <button class="icon-btn" title={label} aria-label={label} disabled={disabled} onClick={() => cave.downloadAction(id, command)}><Icon name={icon} /></button>;
  return <Popover name="downloads" anchor={state.surface!.anchor} open={open} prefer={state.tabLayout === 'side' ? 'top' : 'bottom-right'}>
    <div class="downloads-heading"><h2 id="title">{t('downloads')}</h2>{state.downloads.some(d => d.state !== 'progressing') && <button onClick={() => state.downloads.filter(d => d.state !== 'progressing').forEach(d => void cave.downloadAction(d.id, 'remove'))}>{t('downloads_clear')}</button>}</div>
    {!state.downloads.length ? <div class="downloads-empty"><Icon name="download" /><span>{t('downloads_empty')}</span></div> : <ul class="download-list">{state.downloads.map(d => { const [base, ext] = middle(d.name); const status = d.state === 'progressing' ? d.paused ? t('download_paused') : `${d.total ? Math.round(d.received / d.total * 100) : 0}%` : { completed: t('set.downloads.completed'), cancelled: t('set.downloads.cancelled'), interrupted: t('set.downloads.interrupted') }[d.state]; return <li class="download-item"><Icon name="file" /><div class="download-detail"><div class="download-name" title={d.name}><span>{base}</span><span>{ext}</span></div><small>{size(d.received)} · {status}</small>{d.state === 'progressing' && <div class="download-progress"><div style={{ width: `${d.total ? Math.min(100, d.received / d.total * 100) : 0}%` }} /></div>}</div><div class="download-actions">{d.state === 'progressing' ? <>{action(d.id, d.paused ? 'resume' : 'pause', d.paused ? 'play' : 'pause', d.paused ? t('download_resume') : t('download_pause'))}{action(d.id, 'cancel', 'x', t('download_cancel'))}</> : <>{d.state === 'completed' && <>{action(d.id, 'open', 'external-link', d.exists ? t('download_open') : t('download_missing'), !d.exists)}{action(d.id, 'reveal', 'folder-open', d.exists ? t('download_reveal') : t('download_missing'), !d.exists)}</>}{action(d.id, 'remove', 'trash-2', t('download_remove'))}</>}</div></li>; })}</ul>}
  </Popover>;
}
