import { t } from '../shared/i18n/index.ts';

// The network gate as a pure state machine (no Electron). It is open only while every fact holds.
// Anything that could change where traffic exits invalidates the last check, so a stale "passed"
// can never keep it open. Geolocation is deliberately not a fact here.

export interface Egress { node: string; ip: string; country: string }

export type CheckResult =
  | { ok: true; egress: Egress }
  | { ok: false; kind: 'mismatch'; egress: Egress }
  | { ok: false; kind: 'failed'; error: string };

export interface GateFacts {
  core: 'starting' | 'up' | 'down';
  hasNode: boolean;
  country: string;
  paused: boolean;
  /** bumped on every invalidation; results from an older generation are discarded */
  generation: number;
  check: { status: 'none' | 'running' | 'done'; result?: CheckResult; at?: number };
}

export type GateEvent =
  | { type: 'core-up'; hasNode: boolean }
  | { type: 'core-down' }
  | { type: 'node-changed'; hasNode: boolean }
  | { type: 'country-changed'; country: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'recheck' }
  | { type: 'check-started' }
  | { type: 'check-finished'; generation: number; result: CheckResult; at: number };

export const initialGate = (country: string): GateFacts => ({
  core: 'starting',
  hasNode: false,
  country,
  paused: false,
  generation: 0,
  check: { status: 'none' },
});

const invalidate = (f: GateFacts, patch: Partial<GateFacts>): GateFacts => ({
  ...f,
  ...patch,
  generation: f.generation + 1,
  check: { status: 'none' },
});

export function reduceGate(f: GateFacts, e: GateEvent): GateFacts {
  switch (e.type) {
    case 'core-up':
      return invalidate(f, { core: 'up', hasNode: e.hasNode });
    case 'core-down':
      return invalidate(f, { core: 'down' });
    case 'node-changed':
      return invalidate(f, { hasNode: e.hasNode });
    case 'country-changed':
      return e.country === f.country ? f : invalidate(f, { country: e.country });
    case 'pause':
      return invalidate(f, { paused: true });
    case 'resume':
      return invalidate(f, { paused: false });
    case 'recheck':
      return invalidate(f, {});
    case 'check-started':
      return { ...f, check: { status: 'running' } };
    case 'check-finished':
      return e.generation === f.generation ? { ...f, check: { status: 'done', result: e.result, at: e.at } } : f;
  }
}

export const isOpen = (f: GateFacts): boolean =>
  f.core === 'up' && f.hasNode && !!f.country && !f.paused && f.check.status === 'done' && f.check.result!.ok;

/** True when an egress check should start now. */
export const needsCheck = (f: GateFacts): boolean =>
  f.core === 'up' && f.hasNode && !!f.country && !f.paused && f.check.status === 'none';

export interface GateView {
  state: 'open' | 'checking' | 'closed';
  reason: string;
  /** Closed because the user paused it (not because something failed). */
  paused: boolean;
  egress: Egress | null;
  checkedAt: number | null;
}

export function viewGate(f: GateFacts): GateView {
  const r = f.check.result;
  const egress = r && 'egress' in r ? r.egress : null;
  const facts = { paused: f.paused, egress, checkedAt: f.check.at ?? null };
  const closed = (reason: string): GateView => ({ state: 'closed', reason, ...facts });
  if (f.paused) return closed(t('core.paused'));
  if (f.core === 'starting') return { state: 'checking', reason: t('core.starting'), ...facts };
  if (f.core === 'down') return closed(t('core.down'));
  if (!f.hasNode) return closed(t('core.noNode'));
  if (!f.country) return closed(t('core.noCountry'));
  if (f.check.status !== 'done') return { state: 'checking', reason: t('core.checking'), ...facts };
  if (r!.ok) return { state: 'open', reason: t('core.open', { country: r!.egress.country }), ...facts };
  if (r!.kind === 'mismatch') return closed(t('core.mismatch', { actual: r!.egress.country || t('core.unknown'), expected: f.country }));
  return closed(t('core.checkFailed', { error: r!.error }));
}

/** Parses an endpoint trace (key=value lines) into the egress IP and country. */
export function parseTrace(text: string): { ip: string; country: string; colo: string } {
  const kv = new Map(text.split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()] as const));
  const colo = (kv.get('colo') ?? '').toUpperCase();
  return { ip: kv.get('ip') ?? '', country: (kv.get('loc') ?? '').toUpperCase(), colo: /^[A-Z]{3}$/.test(colo) ? colo : '' };
}
