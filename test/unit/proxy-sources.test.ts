import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProxySources } from '../../src/shared/profile.ts';

const node = { name: 'Node 01', type: 'ss', server: 'example.invalid' };

test('legacy subscription retains its definitions and selected node', () => {
  const result = normalizeProxySources({ subscriptionUrl: 'https://example.invalid/sub', subscriptionVia: 'proxy', selectedNode: 'Node 01' }, [node]);
  assert.deepEqual(result.sources[0], { id: 'legacy', name: 'example.invalid', origin: { kind: 'subscription', url: 'https://example.invalid/sub', via: 'proxy' }, nodes: [node], updatedAt: null });
  assert.deepEqual(result.selected, { source: 'legacy', node: 'Node 01' });
  assert.equal(normalizeProxySources({ selectedNode: 'missing' }, [node]).selected, null);
});

test('new source selections distinguish identical names', () => {
  const source = (id: string) => ({ id, name: id, origin: { kind: 'text' }, nodes: [node], updatedAt: 42 });
  const result = normalizeProxySources({ sources: [source('a'), source('b')], selected: { source: 'b', node: 'Node 01' } });
  assert.equal(result.sources.length, 2);
  assert.deepEqual(result.selected, { source: 'b', node: 'Node 01' });
});

test('malformed source input never creates a dangling selection', () => {
  for (const input of [null, [], 4, 'bad', { sources: [null, {}, { id: 'x', name: 'x', origin: { kind: 'subscription', url: 'x', via: 'invalid' } }], selected: { source: 'x', node: 'Node 01' } }]) {
    assert.deepEqual(normalizeProxySources(input), { sources: [], selected: null });
  }
  const source = { id: 'a', name: 'A', origin: { kind: 'text' }, nodes: [node, node, null], updatedAt: -1 };
  const result = normalizeProxySources({ sources: [source, source], selected: { source: 'a', node: 'missing' } });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].nodes.length, 1);
  assert.equal(result.sources[0].updatedAt, null);
  assert.equal(result.selected, null);
});
