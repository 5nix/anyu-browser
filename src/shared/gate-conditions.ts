import type { GateView } from '../main/gate.ts';
import { coreEn } from './i18n/core.en.ts';
import { coreZh } from './i18n/core.zh.ts';

export type Condition = 'ok' | 'failed' | 'unknown';
/** Interpret only reasons produced by viewGate; other snapshots remain unknown. */
export function gateConditions(gate: GateView, facts: { coreUp?: boolean; selectedNode?: string; country?: string } = {}) {
  const reasons = [coreZh, coreEn];
  const is = (key: 'core.down' | 'core.noNode' | 'core.noCountry' | 'core.checking' | 'core.checkFailed') => reasons.some(r => gate.reason.startsWith(r[key].split('{')[0]));
  const checked = gate.state === 'open' || !!gate.egress || is('core.checkFailed');
  const core: Condition = checked || is('core.noNode') || is('core.noCountry') || is('core.checking') ? 'ok' : is('core.down') ? 'failed' : facts.coreUp === undefined ? 'unknown' : facts.coreUp ? 'ok' : 'failed';
  const node: Condition = checked || is('core.noCountry') || is('core.checking') || !!facts.selectedNode ? 'ok' : is('core.noNode') || facts.selectedNode === '' ? 'failed' : 'unknown';
  const exit: Condition = gate.state === 'open' ? 'ok' : facts.country === '' || is('core.noCountry') || is('core.checkFailed') || (gate.state === 'closed' && !!gate.egress) ? 'failed' : 'unknown';
  return { switch: gate.paused ? 'failed' : 'ok', core, node, exit } as const;
}
