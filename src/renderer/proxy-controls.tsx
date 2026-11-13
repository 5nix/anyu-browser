// Proxy controls shared by the settings page and first-run setup: the node rows, the local proxy
// port fields and the appearance picker. Each page lays them out with its own CSS.
import type { Theme } from '../shared/appearance.ts';
import type { NodeState } from '../shared/ipc.ts';
import { t } from '../shared/i18n/index.ts';
import { regionName } from './gate-status.tsx';
import { Icon } from './ui/index.tsx';

const PROTOCOLS: Record<string, string> = { shadowsocks: 'ss', shadowsocksr: 'ssr' };
export const protocol = (type: string) => PROTOCOLS[type.toLowerCase()] ?? type.toLowerCase();

export type NodeRow = NodeState['nodes'][number];

/** Compact node rows; the radio shows only the selection the main process reports. */
export function NodeList({ rows, locale, isSelected, onSelect, className = 'nodes compact one', label }: { rows: NodeRow[]; locale: string; isSelected: (n: NodeRow) => boolean; onSelect: (n: NodeRow) => void; className?: string; label?: string }) {
  return <ul class={className} role={label ? 'radiogroup' : undefined} aria-label={label}>{rows.map((n, i) => <li key={`${n.source}\n${n.name}`} class={[isSelected(n) && 'selected', i === 0 && 'top'].filter(Boolean).join(' ')}><label><input type="radio" name="node" checked={isSelected(n)} onClick={e => { e.preventDefault(); onSelect(n); }} /><span class="mark">{isSelected(n) && <Icon name="check" />}</span><span class="name" title={n.name}>{n.name}</span>{n.country && <span class="country">{t('set.nodes.exit', { country: regionName(locale, n.country) })}</span>}<span class="type">{protocol(n.type)}</span><span class="delay">{n.delay.status === 'measured' ? `${n.delay.ms} ms` : n.delay.status === 'timeout' ? t('set.nodes.timeout') : '—'}</span></label></li>)}</ul>;
}

/** The local proxy port as typed: every field a string until it is saved. */
export type ExternalDraft = { protocol: string; host: string; port: string; username: string; password: string };

/** Protocol, host and port of the local proxy software. */
export function ExternalEndpoint({ value, set, fieldClass }: { value: ExternalDraft; set: (key: keyof ExternalDraft, value: string) => void; fieldClass: string }) {
  return <>
    <label class={fieldClass}><span>{t('set.nodes.extProtocol')}</span><select id="ext-protocol" value={value.protocol} onChange={e => set('protocol', e.currentTarget.value)}><option value="socks5">SOCKS5</option><option value="http">HTTP</option></select></label>
    <label class={fieldClass}><span>{t('set.nodes.extHost')}</span><input id="ext-host" value={value.host} onInput={e => set('host', e.currentTarget.value)} spellcheck={false} /></label>
    <label class={fieldClass}><span>{t('set.nodes.extPort')}</span><input id="ext-port" type="number" min="1" max="65535" value={value.port} onInput={e => set('port', e.currentTarget.value)} spellcheck={false} /></label>
  </>;
}

/** Username and password for the local proxy software. */
export function ExternalCredentials({ value, set, fieldClass, labels = [t('set.nodes.extUser'), t('set.nodes.extPass')] }: { value: ExternalDraft; set: (key: keyof ExternalDraft, value: string) => void; fieldClass: string; labels?: [string, string] }) {
  return <>
    <label class={fieldClass}><span>{labels[0]}</span><input id="ext-user" value={value.username} onInput={e => set('username', e.currentTarget.value)} spellcheck={false} /></label>
    <label class={fieldClass}><span>{labels[1]}</span><input id="ext-pass" type="password" value={value.password} onInput={e => set('password', e.currentTarget.value)} spellcheck={false} /></label>
  </>;
}

/** System / light / dark as one segmented control; native radios give arrow-key navigation. */
export function ThemePicker({ value, onChange, label }: { value: Theme; onChange: (theme: Theme) => void; label: string }) {
  return <div class="theme-picker" role="radiogroup" aria-label={label}>{(['system', 'light', 'dark'] as Theme[]).map(mode => <label><input type="radio" name="theme" value={mode} checked={value === mode} onChange={() => onChange(mode)} /><span><Icon name={mode === 'system' ? 'monitor' : mode === 'light' ? 'sun' : 'moon'} />{t(mode === 'system' ? 'set.appearance.followSystem' : mode === 'light' ? 'set.appearance.light' : 'set.appearance.dark')}</span></label>)}</div>;
}
