import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coreNodeName, removeSource, selectedCoreName, sourceProxies } from '../../src/main/proxy-sources.ts';
import { initialGate, reduceGate, isOpen } from '../../src/main/gate.ts';
import type { ProxySources } from '../../src/shared/profile.ts';

const source = (id: string) => ({ id, name: id, origin: { kind: 'text' as const }, nodes: [{ name: 'Node 01', type: 'socks5', server: '127.0.0.1', port: 1234 }], updatedAt: null });
test('duplicate names route to distinct source identities', () => {
  const model: ProxySources = { sources: [source('a'), source('b')], selected: { source: 'b', node: 'Node 01' } };
  assert.deepEqual(sourceProxies(model).map(p => p.name), [coreNodeName('a', 'Node 01'), coreNodeName('b', 'Node 01')]);
  assert.equal(selectedCoreName(model), coreNodeName('b', 'Node 01'));
});
test('removing selected source removes the only valid selection and invalidates the gate', () => {
  const model: ProxySources = { sources: [source('a'), source('b')], selected: { source: 'a', node: 'Node 01' } };
  assert.deepEqual(removeSource(model, 'b').selected, model.selected);
  const next = removeSource(model, 'a');
  assert.equal(next.selected, null);
  assert.equal(selectedCoreName(next), '');
  let gate = reduceGate(initialGate('QM'), { type: 'core-up', hasNode: true });
  gate = reduceGate(gate, { type: 'check-finished', generation: gate.generation, result: { ok: true, egress: { node: 'a', ip: '203.0.113.7', country: 'QM' } }, at: 1 });
  assert.equal(isOpen(gate), true);
  assert.equal(isOpen(reduceGate(gate, { type: 'node-changed', hasNode: !!selectedCoreName(next) })), false);
});
