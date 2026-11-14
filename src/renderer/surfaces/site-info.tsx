import { useEffect, useState } from 'preact/hooks';
import type { CertificateDetails, Permission, PermissionEntry, ShellState, SiteUaInfo } from '../../shared/ipc.ts';
import { formatDate, t } from '../../shared/i18n/index.ts';
import { uaModeLabel, type UaPreference } from '../../shared/ua.ts';
import { cave } from '../bridge.ts';
import { addressSecurity } from '../address-display.ts';
import { Icon, Surface } from '../ui/index.tsx';

const labels: Record<Permission, Parameters<typeof t>[0]> = { 'media-camera': 'set.permissions.camera', 'media-microphone': 'set.permissions.microphone', geolocation: 'set.permissions.location', notifications: 'set.permissions.notifications', 'clipboard-read': 'set.permissions.clipboard' };
export function SiteInfo({ state, open }: { state: ShellState; open: boolean }) {
  const tab = state.tabs.find(t => t.id === state.active);
  const host = (() => { try { return new URL(tab?.url || '').host; } catch { return ''; } })();
  const security = tab?.error?.kind === 'certificate' ? 'exception' : addressSecurity(tab);
  const text = { https: 'siteInfo_secure', http: 'siteInfo_insecure', exception: 'siteInfo_certificate', internal: 'siteInfo_internal', unknown: 'siteInfo_unknown' } as const;
  const [data, setData] = useState<{ permissions: PermissionEntry[]; cookies: number; certificate: CertificateDetails | null; ua: SiteUaInfo | null }>({ permissions: [], cookies: 0, certificate: null, ua: null });
  const [confirming, setConfirming] = useState(false);
  const [uaNotice, setUaNotice] = useState(false);
  const refresh = () => void cave.siteInfo().then(setData);
  useEffect(() => { setUaNotice(false); refresh(); }, [tab?.id, tab?.url]);
  return <Surface name="siteInfo" anchor={state.surface!.anchor} open={open}>
    <div class="site-info-heading"><Icon name="globe" /><b id="title">{host || t('siteInfo_title')}</b></div>
    <div class="site-info-row"><Icon name={security === 'https' ? 'shield-check' : security === 'exception' || security === 'http' ? 'shield-alert' : 'info'} /><span>{t(text[security])}</span></div>
    {data.certificate && <details class="site-info-certificate"><summary><Icon name="chevron-right" /><span>{t('siteInfo_details')}</span></summary><dl><dt>{t('siteInfo_subject')}</dt><dd>{data.certificate.subject}</dd><dt>{t('siteInfo_issuer')}</dt><dd>{data.certificate.issuer}</dd><dt>{t('siteInfo_validFrom')}</dt><dd>{formatDate(new Date(data.certificate.validFrom))}</dd><dt>{t('siteInfo_validTo')}</dt><dd>{formatDate(new Date(data.certificate.validTo))}</dd></dl></details>}
    {data.permissions.map(p => <div class="site-info-row"><span>{t(labels[p.permission])}</span><span class="site-info-value">{t(p.decision === 'allow' ? 'set.permissions.allow' : 'set.permissions.deny')}</span><button class="icon-btn" title={t('set.permissions.remove')} aria-label={`${t('set.permissions.remove')} ${t(labels[p.permission])}`} onClick={async () => { await cave.removePermission(p.origin, p.permission); refresh(); }}><Icon name="x" /></button></div>)}
    {host && data.ua && <>
      <div class="site-info-row">
        <label for="site-ua">{t('siteInfo_ua')}</label>
        <select id="site-ua" class="site-info-select" value={data.ua.preference} onChange={async e => {
          const preference = e.currentTarget.value as UaPreference;
          await cave.setSiteUa(data.ua!.origin, preference);
          setUaNotice(true);
          refresh();
        }}>
          <option value="default">{t('siteInfo_uaDefault', { mode: uaModeLabel(data.ua.builtin ?? 'chromium') })}</option>
          <option value="chromium">Chromium</option>
          <option value="chrome">Chrome</option>
          <option value="electron">Electron</option>
        </select>
      </div>
      {uaNotice && <div class="site-info-notice" role="status">
        <small>{t('siteInfo_uaNotice')}</small>
        <button class="btn link" onClick={() => void cave.run('page.reload')}>{t('error_reload')}</button>
      </div>}
    </>}
    {host && <div class="site-info-row"><span>{t('siteInfo_cookies')}</span><span class="site-info-value">{t('siteInfo_cookieCount', { count: data.cookies })}</span></div>}
    {confirming && <div class="site-info-confirm"><b>{t('set.privacy.clearTitle', { host })}</b><p>{t('set.privacy.clearBody', { host })}</p><div><button onClick={() => setConfirming(false)}>{t('cancel')}</button><button class="btn primary" onClick={async () => { await cave.clearSite(tab!.url); setConfirming(false); refresh(); }}>{t('set.privacy.clear')}</button></div></div>}
    <div class="status-actions">{host && <button onClick={() => setConfirming(true)}>{t('set.privacy.clearSite')}</button>}<button class="site-info-settings" onClick={() => cave.openSettings('privacy')}>{t('siteInfo_settings')}</button></div>
  </Surface>;
}
