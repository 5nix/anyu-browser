import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialGate, reduceGate, isOpen, needsCheck, viewGate, parseTrace, type GateFacts, type GateEvent } from '../../src/main/gate.ts';
import { status } from '../../src/renderer/gate.ts';

const egress = { node: 'Node 1', ip: '203.0.113.7', country: 'QM' };
const run = (events: GateEvent[], f: GateFacts = initialGate('QM')) => events.reduce(reduceGate, f);
const pass = (f: GateFacts): GateEvent => ({ type: 'check-finished', generation: f.generation, result: { ok: true, egress }, at: 1 });

function opened() {
  const f = run([{ type: 'core-up', hasNode: true }, { type: 'check-started' }]);
  return reduceGate(f, pass(f));
}

test('starts closed and opens only after a passing egress check', () => {
  assert.equal(isOpen(initialGate('QM')), false);
  const up = run([{ type: 'core-up', hasNode: true }]);
  assert.equal(needsCheck(up), true);
  assert.equal(isOpen(up), false);
  assert.equal(isOpen(opened()), true);
  assert.equal(viewGate(opened()).state, 'open');
});

test('every fact that changes the exit closes it again', () => {
  const events: GateEvent[] = [
    { type: 'core-down' },
    { type: 'node-changed', hasNode: true },
    { type: 'country-changed', country: 'QN' },
    { type: 'pause' },
    { type: 'recheck' },
  ];
  for (const e of events) assert.equal(isOpen(reduceGate(opened(), e)), false, e.type);
});

test('setting the same country again does not reopen a check', () => {
  const f = opened();
  assert.equal(reduceGate(f, { type: 'country-changed', country: 'QM' }), f);
});

test('a check started before an invalidation cannot open the gate', () => {
  const started = run([{ type: 'core-up', hasNode: true }, { type: 'check-started' }]);
  const stale = pass(started);
  const moved = reduceGate(started, { type: 'node-changed', hasNode: true });
  assert.equal(isOpen(reduceGate(moved, stale)), false);
});

test('mismatch and failures keep it closed with a Chinese reason', () => {
  const f = run([{ type: 'core-up', hasNode: true }]);
  const mismatch = reduceGate(f, { type: 'check-finished', generation: f.generation, result: { ok: false, kind: 'mismatch', egress: { ...egress, country: 'QP' } }, at: 1 });
  assert.equal(isOpen(mismatch), false);
  assert.match(viewGate(mismatch).reason, /QP.*QM/);
  const failed = reduceGate(f, { type: 'check-finished', generation: f.generation, result: { ok: false, kind: 'failed', error: 'timeout' }, at: 1 });
  assert.equal(viewGate(failed).state, 'closed');
});

test('no country or no node: closed and no check is attempted', () => {
  assert.equal(needsCheck(run([{ type: 'core-up', hasNode: true }], initialGate(''))), false);
  assert.equal(needsCheck(run([{ type: 'core-up', hasNode: false }])), false);
  assert.match(viewGate(run([{ type: 'core-up', hasNode: false }])).reason, /节点/);
});

test('paused stays closed until resumed and re-checked', () => {
  const paused = reduceGate(opened(), { type: 'pause' });
  assert.equal(needsCheck(paused), false);
  assert.deepEqual([viewGate(paused).state, viewGate(paused).paused], ['closed', true]);
  assert.equal(status(viewGate(paused)), 'paused');
  const resumed = reduceGate(paused, { type: 'resume' });
  assert.equal(isOpen(resumed), false);
  assert.equal(needsCheck(resumed), true);
  assert.equal(viewGate(resumed).paused, false);
  assert.equal(status(viewGate(resumed)), viewGate(resumed).state);
});

test('only a pause reads as paused, whatever a closed reason says', () => {
  const down = viewGate(run([{ type: 'core-up', hasNode: false }]));
  assert.equal(status({ ...down, reason: '已手动暂停外网' }), 'closed');
});

test('parseTrace reads ip and loc', () => {
  assert.deepEqual(parseTrace('fl=1\nip=203.0.113.7\nts=1\nloc=qm\n'), { ip: '203.0.113.7', country: 'QM' });
  assert.deepEqual(parseTrace('garbage'), { ip: '', country: '' });
});
