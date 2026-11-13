// The gate's summary and its four release conditions, drawn the same way on the settings status page and in the toolbar status card.
import { t } from '../shared/i18n/index.ts';
import type { ShellState } from '../shared/ipc.ts';
import { gateConditions, type Condition } from '../shared/gate-conditions.ts';
import { STATUS_TITLE, status, type Status } from './gate.ts';
import { Icon } from './ui/index.tsx';

export const regionName = (locale: string, code: string) => { try { return new Intl.DisplayNames([locale], { type: 'region' }).of(code) || code; } catch { return code; } };

/** `running` and `pending` are used by setup, which shows a check while it runs. */
export type GateRow = { id: 'switch' | 'core' | 'node' | 'exit'; icon: string; label: string; value: string; condition: Condition | 'running' | 'pending' };

/** `selectedNode` and `country` are left out while they are not known yet. */
export function gateStatus(state: ShellState, facts: { coreUp?: boolean; selectedNode?: string; country?: string }) {
  const st = status(state.gate), e = state.gate.egress, conditions = gateConditions(state.gate, facts);
  const country = (code: string) => regionName(state.locale, code);
  const mismatch = conditions.exit === 'failed' && !!e && !!facts.country && e.country !== facts.country;
  const rows: GateRow[] = [
    { id: 'switch', icon: 'power', label: t('set.conditions.switch'), value: t(st === 'paused' ? 'set.conditions.paused' : 'set.conditions.on'), condition: conditions.switch },
    { id: 'core', icon: 'cpu', label: t('set.conditions.core'), value: t(st === 'paused' ? 'set.conditions.pausedCore' : conditions.core === 'ok' ? 'set.conditions.running' : conditions.core === 'failed' ? 'set.conditions.stopped' : 'set.overview.unknown'), condition: st === 'paused' ? 'unknown' : conditions.core },
    { id: 'node', icon: 'network', label: t('set.overview.node'), value: e?.node || facts.selectedNode || t(facts.selectedNode === '' ? 'set.conditions.noNode' : 'set.overview.unknown'), condition: conditions.node },
    { id: 'exit', icon: 'map-pin', label: t('set.overview.country'), value: mismatch ? t('set.conditions.mismatchIp', { actual: country(e!.country), ip: e!.ip, expected: country(facts.country!) }) : e ? `${country(e.country)} · ${e.ip}` : t(st === 'paused' ? 'set.conditions.pausedExit' : 'set.conditions.noReport'), condition: conditions.exit },
  ];
  const title = st === 'open' ? t('set.conditions.allowed', { country: country(e?.country || '') }) : STATUS_TITLE[st];
  return { st, e, conditions, mismatch, rows, title, country };
}

/** Badge, title and reason, with the switch that pauses and resumes external access at the right end. On means not paused. */
export function GateSummary({ st, title, reason, titleId, reasonId, busy, onToggle }: { st: Status; title: string; reason: string; titleId: string; reasonId: string; busy: boolean; onToggle: () => void }) {
  return <div class={`overview-summary ${st}`}>
    <span class="overview-badge"><Icon name={st === 'open' ? 'shield-check' : st === 'closed' ? 'shield-off' : 'shield'} /></span>
    <div class="label"><b id={titleId} title={title}>{title}</b><small id={reasonId} title={reason}>{reason}</small></div>
    <input type="checkbox" class="switch" role="switch" id="pause" aria-label={t('set.conditions.switch')} title={t(st === 'paused' ? 'set.overview.resume' : 'set.overview.pause')} checked={st !== 'paused'} disabled={busy} onChange={onToggle} />
  </div>;
}

/** The four conditions: icon, label, value and state mark. They carry no actions. */
export function ConditionList({ st, rows, className = 'condition-list', live = false }: { st: Status; rows: GateRow[]; className?: string; live?: boolean }) {
  return <div class={className} role={live ? 'status' : undefined} aria-live={live ? 'polite' : undefined}>{rows.map(row => <div class={`condition-row ${row.condition}${row.id === 'switch' && st === 'paused' ? ' is-paused' : ''}`} data-condition={row.id}>
    <Icon name={row.icon} className="condition-icon" /><div class="label"><b>{row.label}</b><small title={row.value}>{row.value}</small></div>
    <span class="condition-mark">{row.condition === 'unknown' ? '—' : row.condition === 'running' ? <span class="dot checking" /> : <Icon name={row.condition === 'pending' ? 'circle-dashed' : row.condition === 'ok' ? 'circle-check' : row.id === 'switch' && st === 'paused' ? 'circle-pause' : 'circle-x'} />}</span>
  </div>)}</div>;
}
