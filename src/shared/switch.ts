// The confirmation shown before switching nodes: what changes, and whether the exit country does.
import { t } from './i18n/index.ts';
import type { NodeState } from './ipc.ts';

type NodeRow = NodeState['nodes'][number];

/** `wanted` is the configured egress country; a known mismatch means the gate will stay closed. */
export function switchText(from: NodeRow, to: NodeRow, wanted: string): string {
  const country =
    !to.country ? t('switchUnknown', { name: to.name })
    : from.country && from.country !== to.country ? t('switchChanged', { from: from.country, to: to.country })
    : t('switchSame', { country: to.country });
  const gate = to.country && wanted && to.country !== wanted ? t('switchMismatch', { wanted }) : '';
  return t('switchConfirm', { from: from.name, to: to.name, country, gate });
}
