import { t } from '../shared/i18n/index.ts';
// How the UI names the gate's state. "Paused" is a closed gate the user asked for.
import type { GateView } from '../shared/ipc.ts';

export type Status = GateView['state'] | 'paused';

export const status = (g: GateView): Status => (g.paused ? 'paused' : g.state);

export const STATUS_TITLE: Record<Status, string> = { get open() { return t('statusOpen'); }, get checking() { return t('statusChecking'); }, get closed() { return t('statusClosed'); }, get paused() { return t('statusPaused'); } };
