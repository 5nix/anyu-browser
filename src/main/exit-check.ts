import { parseTrace, type Egress } from './gate.ts';

/** Each measurement starts with a cleared connection pool and closes it afterwards. */
export async function measureExit<S extends { close: () => Promise<void> }>(o: {
  selected: () => Promise<string>;
  createSession: () => Promise<S>;
  fetchTrace: (session: S) => Promise<string>;
}): Promise<{ node: string; ip: string; country: string; colo: string }> {
  const node = await o.selected();
  if (!node || node === 'REJECT') throw new Error('No selected node');
  const session = await o.createSession();
  try {
    return { node, ...parseTrace(await o.fetchTrace(session)) };
  } finally {
    await session.close();
  }
}

/** Labels, like gate results, must belong to the current generation. */
export function acceptExit(generation: number, current: number, egress: Egress, countries: Map<string, string>): boolean {
  if (generation !== current) return false;
  countries.set(egress.node, egress.country);
  return true;
}

/** A read-only measurement: it cannot publish a gate result or cache a node label. */
export async function measureExitOnly<S extends { close: () => Promise<void> }>(o: {
  running: () => boolean;
  expected: () => string;
  selected: () => Promise<string>;
  createSession: () => Promise<S>;
  fetchTrace: (session: S) => Promise<string>;
}): Promise<{ country: string; colo: string }> {
  if (!o.running()) throw new Error('Core is not running');
  const expected = o.expected();
  if (!expected) throw new Error('No selected node');
  const egress = await measureExit(o);
  if (!o.running()) throw new Error('Core is not running');
  if (!egress.ip || !/^[A-Z]{2}$/.test(egress.country)) throw new Error('Invalid exit trace');
  if (egress.node !== expected || o.expected() !== expected || await o.selected() !== expected) throw new Error('Selected node changed');
  return { country: egress.country, colo: egress.colo };
}
