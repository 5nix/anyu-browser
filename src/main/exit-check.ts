import { parseTrace, type Egress } from './gate.ts';

/** Each measurement starts with a cleared connection pool and closes it afterwards. */
export async function measureExit<S extends { close: () => Promise<void> }>(o: {
  selected: () => Promise<string>;
  createSession: () => Promise<S>;
  fetchTrace: (session: S) => Promise<string>;
}): Promise<Egress> {
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
