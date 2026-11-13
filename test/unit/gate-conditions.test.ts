import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { initialGate, reduceGate, viewGate } from '../../src/main/gate.ts';
import { gateConditions } from '../../src/shared/gate-conditions.ts';

test('conditions reflect gate states and exposed facts without inventing a report', () => {
  let f = initialGate('QM');
  assert.deepEqual(gateConditions(viewGate(f)), { switch: 'ok', core: 'unknown', node: 'unknown', exit: 'unknown' });
  f = reduceGate(f, { type: 'core-down' });
  assert.equal(gateConditions(viewGate(f), { coreUp: false }).core, 'failed');
  f = reduceGate(f, { type: 'core-up', hasNode: false });
  assert.equal(gateConditions(viewGate(f), { coreUp: true, selectedNode: '' }).node, 'failed');
  f = reduceGate(f, { type: 'node-changed', hasNode: true });
  f = reduceGate(f, { type: 'country-changed', country: '' });
  assert.equal(gateConditions(viewGate(f), { country: '' }).exit, 'failed');
  f = reduceGate(f, { type: 'country-changed', country: 'QM' });
  assert.equal(gateConditions(viewGate(f), { country: 'QM' }).exit, 'unknown');
  f = reduceGate(f, { type: 'check-started' });
  assert.equal(gateConditions(viewGate(f), { country: 'QM' }).exit, 'unknown');
  f = reduceGate(f, { type: 'check-finished', generation: f.generation, result: { ok: false, kind: 'failed', error: 'offline' }, at: 1 });
  assert.equal(gateConditions(viewGate(f), { country: 'QM' }).exit, 'failed');
  f = reduceGate(f, { type: 'check-finished', generation: f.generation, result: { ok: false, kind: 'mismatch', egress: { node: 'n', country: 'QN', ip: '1' } }, at: 2 });
  assert.equal(gateConditions(viewGate(f), { country: 'QM' }).exit, 'failed');
  f = reduceGate(f, { type: 'check-finished', generation: f.generation, result: { ok: true, egress: { node: 'n', country: 'QM', ip: '1' } }, at: 3 });
  assert.deepEqual(gateConditions(viewGate(f)), { switch: 'ok', core: 'ok', node: 'ok', exit: 'ok' });
  f = reduceGate(f, { type: 'pause' });
  assert.equal(gateConditions(viewGate(f)).switch, 'failed');
});
