import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureExit, acceptExit } from '../../src/main/exit-check.ts';
import { initialGate, reduceGate, isOpen } from '../../src/main/gate.ts';

test('each measurement clears the shared connection pool before and after use', async () => {
  let selected = 'old';
  let connection: string | null = 'old';
  const events: string[] = [];
  const session = { close: async () => { events.push('close'); connection = null; } };
  const createSession = async () => {
    await session.close();
    return session;
  };
  const measure = () => measureExit({
    selected: async () => selected,
    createSession,
    fetchTrace: async () => {
      connection ??= selected;
      events.push(`fetch:${connection}`);
      return `ip=1\nloc=${connection === 'old' ? 'QM' : 'QN'}\n`;
    },
  });
  assert.equal((await measure()).country, 'QM');
  selected = 'new';
  connection = 'old'; // A connection established by another user of the shared session.
  assert.equal((await measure()).country, 'QN');
  assert.deepEqual(events, ['close', 'fetch:old', 'close', 'close', 'fetch:new', 'close']);
});

test('a late measurement cannot open the gate or update a node label', () => {
  let facts = reduceGate(initialGate('QM'), { type: 'core-up', hasNode: true });
  const generation = facts.generation;
  facts = reduceGate(facts, { type: 'node-changed', hasNode: true });
  const labels = new Map<string, string>();
  const egress = { node: 'old', ip: '1', country: 'QM' };
  assert.equal(acceptExit(generation, facts.generation, egress, labels), false);
  facts = reduceGate(facts, { type: 'check-finished', generation, result: { ok: true, egress }, at: 1 });
  assert.equal(isOpen(facts), false);
  assert.equal(labels.size, 0);
});
