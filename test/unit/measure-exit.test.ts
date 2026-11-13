// Gatekeeper.measureExit, the read-only measurement setup uses to prefill the exit country. The
// Electron sessions are replaced by a stand-in that answers the trace request itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { transformSync } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fake = `
const session = { setProxy: async () => {}, closeAllConnections: async () => {}, fetch: (...a) => globalThis.__traceFetch(...a) };
export const app = { on() {}, commandLine: { appendSwitch() {} }, configureHostResolver() {} };
export const session_ = { fromPartition: () => session, defaultSession: session };
export { session_ as session };
`;
registerHooks({
  resolve: (specifier, context, next) => specifier === 'electron' ? { url: `data:text/javascript,${encodeURIComponent(fake)}`, shortCircuit: true } : next(specifier, context),
  // The main process uses parameter properties, which type stripping alone cannot run.
  load: (url, context, next) => {
    const loaded = next(url, context);
    if (!url.endsWith('.ts') || !url.includes('/src/main/')) return loaded;
    return { format: 'module', source: transformSync(String(loaded.source), { loader: 'ts', format: 'esm', sourcefile: url }).code, shortCircuit: true };
  },
});

const { Gatekeeper } = await import('../../src/main/gatekeeper.ts');
const { defaultProfile } = await import('../../src/shared/profile.ts');
const { selectedCoreName } = await import('../../src/main/proxy-sources.ts');
const { reduceGate } = await import('../../src/main/gate.ts');

const g = globalThis as unknown as { __traceFetch: (url: string) => Promise<Response> };

async function world(t: import('node:test').TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'cave-measure-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const profile = defaultProfile('en', 'UTC');
  profile.egressCountry = 'JP';
  profile.proxy.sources.push({ id: 's', name: 's', origin: { kind: 'text' }, nodes: [{ name: 'A', type: 'socks5' }, { name: 'B', type: 'socks5' }], updatedAt: null });
  profile.proxy.selected = { source: 's', node: 'A' };
  const gk = new Gatekeeper({ binary: 'none', dir, ports: { browser: 1, probe: 2, controller: 3 }, secret: 'x', profile: () => profile, saveProxy: async () => {} });
  let inCore = selectedCoreName(profile.proxy);
  Object.defineProperty(gk, 'core', { value: { running: true } });
  (gk.controller as unknown as { selected: () => Promise<string> }).selected = async () => inCore;
  // An open gate, so a change would be visible.
  let f = reduceGate(gk.facts, { type: 'core-up', hasNode: true });
  f = reduceGate(f, { type: 'check-finished', generation: f.generation, result: { ok: true, egress: { node: inCore, ip: '203.0.113.1', country: 'JP' } }, at: 1 });
  gk.facts = f;
  const changes: unknown[] = [];
  gk.on('change', (v) => changes.push(v));
  return { gk, profile, switchCore: (name: string) => { inCore = name; } };
}

test('measuring the exit returns the country and site and changes nothing about the gate', async (t) => {
  const { gk } = await world(t);
  const before = structuredClone(gk.facts);
  g.__traceFetch = async () => new Response('fl=1\nip=198.51.100.9\nloc=jp\ncolo=nrt\n');
  assert.deepEqual(await gk.measureExit(), { country: 'JP', colo: 'NRT' });
  assert.deepEqual(gk.facts, before);
  assert.equal(gk.open, true);
});

test('measuring rejects when the node changes while the request is out, and still leaves the gate alone', async (t) => {
  const { gk, profile, switchCore } = await world(t);
  const before = structuredClone(gk.facts);
  g.__traceFetch = async () => { profile.proxy.selected = { source: 's', node: 'B' }; return new Response('ip=198.51.100.9\nloc=us\ncolo=lax\n'); };
  await assert.rejects(gk.measureExit(), /Selected node changed/);
  assert.deepEqual(gk.facts, before);

  profile.proxy.selected = { source: 's', node: 'A' };
  const name = selectedCoreName(profile.proxy);
  g.__traceFetch = async () => { switchCore('other'); return new Response('ip=198.51.100.9\nloc=us\n'); };
  await assert.rejects(gk.measureExit(), /Selected node changed/);
  switchCore(name);
  assert.deepEqual(gk.facts, before);
});

test('measuring rejects an unusable trace or a stopped core', async (t) => {
  const { gk } = await world(t);
  g.__traceFetch = async () => new Response('garbage');
  await assert.rejects(gk.measureExit(), /Invalid exit trace/);
  Object.defineProperty(gk, 'core', { value: { running: false } });
  await assert.rejects(gk.measureExit(), /Core is not running/);
});
