import { useMemo } from 'preact/hooks';
import type { DownloadAction, DownloadState, ShellState } from '../shared/ipc.ts';
import { t } from '../shared/i18n/index.ts';
import { cave } from './bridge.ts';
import { Icon } from './ui/index.tsx';

export function useDownloadDateFormat({ locale, systemTimezone, clock24Hour }: Pick<ShellState, 'locale' | 'systemTimezone' | 'clock24Hour'>) {
  return useMemo(() => new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    timeZone: systemTimezone,
    dateStyle: 'medium',
    timeStyle: 'short',
    hourCycle: clock24Hour ? 'h23' : 'h12',
  }), [locale, systemTimezone, clock24Hour]);
}

export function DownloadTime({ started, format }: { started: number; format: Intl.DateTimeFormat }) {
  const date = new Date(started);
  return <time dateTime={date.toISOString()} title={t('download_started')}>{format.format(date)}</time>;
}

export function DownloadFileStatus({ download }: { download: DownloadState }) {
  if (download.trashFailed && download.exists) return <small class="download-file-status" role="status">{t('download_trash_failed')}</small>;
  if (download.state === 'completed' && !download.exists) return <small class="download-file-status">{t('download_missing')}</small>;
  return null;
}

export function DownloadActions({ download }: { download: DownloadState }) {
  const action = (command: DownloadAction, icon: string, label: string, disabled = false) => (
    <button type="button" class={`icon-btn${command === 'trash' ? ' download-delete-file' : ''}`} title={label} aria-label={label}
      disabled={disabled} onClick={() => void cave.downloadAction(download.id, command)}><Icon name={icon} /></button>
  );
  if (download.state === 'progressing') return <>
    {download.paused ? action('resume', 'play', t('download_resume')) : action('pause', 'pause', t('download_pause'))}
    {action('cancel', 'x', t('download_cancel'))}
  </>;

  const unavailable = !download.exists || !!download.trashing;
  return <>
    {download.state === 'completed' && <>
      {action('open', 'external-link', t(download.exists ? 'download_open' : 'download_missing'), unavailable)}
      {action('reveal', 'folder-open', t(download.exists ? 'download_reveal' : 'download_missing'), unavailable)}
      {download.exists && action('trash', 'trash-2', t('download_trash'), unavailable)}
    </>}
    {action('remove', 'x', t('download_remove'), download.trashing)}
  </>;
}
