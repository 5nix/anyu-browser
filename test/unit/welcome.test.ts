import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultProfile, type Profile } from '../../src/shared/profile.ts';
import { EXIT_CHECK_TIMEOUT_S, deriveSetupStep, phasesDone, verifyPhase, visibleStep, type SetupChoices } from '../../src/shared/welcome.ts';
import { gateReason } from '../../src/shared/gate-conditions.ts';
import { COLO_SITES, coloForCountry } from '../../src/shared/colo.ts';
import { viewGate, initialGate, reduceGate, type GateView } from '../../src/main/gate.ts';
import { setLocale } from '../../src/shared/i18n/index.ts';

const choices: SetupChoices = { started: true, identityHandled: false, personaliseHandled: false, dismissed: false, finished: false };
const gate: GateView = { state: 'closed', reason: '', paused: false, egress: null, checkedAt: null };
const open: GateView = { ...gate, state: 'open' };
const profile = (): Profile => defaultProfile('en', 'UTC');

test('setup derives each step and returns to verification if the gate closes', () => {
  const p = profile();
  assert.equal(deriveSetupStep(p, gate, { ...choices, started: false }), 'welcome');
  assert.equal(deriveSetupStep(p, gate, choices), 'connect');
  p.proxy.sources.push({ id: 's', name: 's', origin: { kind: 'text' }, nodes: [{ name: 'n', type: 'socks5' }], updatedAt: null });
  assert.equal(deriveSetupStep(p, gate, choices), 'node');
  p.proxy.selected = { source: 's', node: 'n' };
  assert.equal(deriveSetupStep(p, gate, choices), 'node');
  p.egressCountry = 'JP';
  assert.equal(deriveSetupStep(p, gate, choices), 'verify');
  assert.equal(deriveSetupStep(p, open, choices), 'identity');
  assert.equal(deriveSetupStep(p, open, { ...choices, identityHandled: true }), 'personalise');
  const handled = { ...choices, identityHandled: true, personaliseHandled: true };
  assert.equal(deriveSetupStep(p, open, handled), 'done');
  // "Start browsing" exists only while the gate is open; a closed gate sends the flow back to the check.
  assert.equal(deriveSetupStep(p, gate, handled), 'verify');
  assert.equal(deriveSetupStep(p, gate, { ...handled, finished: true }), 'normal');
  assert.equal(deriveSetupStep(p, gate, { ...choices, dismissed: true }), 'normal');
  assert.equal(deriveSetupStep(p, gate, { ...choices, dismissed: false }), 'verify');
});

test('external mode requires a usable local port and does not require a selected node', () => {
  const p = profile();
  p.connectionMode = 'external';
  p.externalProxy.port = 7890;
  p.externalProxy.host = '192.168.1.1';
  assert.equal(deriveSetupStep(p, gate, choices), 'connect');
  p.externalProxy.host = 'localhost';
  assert.equal(deriveSetupStep(p, gate, choices), 'node');
  p.egressCountry = 'JP';
  assert.equal(deriveSetupStep(p, gate, choices), 'verify');
});

test('a step the user went back to is kept only while it is behind the derived one', () => {
  assert.equal(visibleStep('verify', null), 'verify');
  assert.equal(visibleStep('verify', 'node'), 'node');
  assert.equal(visibleStep('identity', 'verify'), 'verify');
  assert.equal(visibleStep('node', 'verify'), 'node');
  assert.equal(visibleStep('connect', 'connect'), 'connect');
});

test('the step indicator ticks the check only while the gate is open', () => {
  const p = profile();
  p.setup = { ...choices };
  p.proxy.sources.push({ id: 's', name: 's', origin: { kind: 'text' }, nodes: [{ name: 'n', type: 'socks5' }], updatedAt: null });
  assert.deepEqual(phasesDone(p, gate), [true, true, false, false, false]);
  assert.deepEqual(phasesDone(p, open), [true, true, true, false, false]);
});

test('the check phase follows the gate view in both interface languages', () => {
  for (const locale of ['zh', 'en'] as const) {
    setLocale(locale);
    let f = initialGate('JP');
    assert.equal(verifyPhase(viewGate(f)), 'starting');
    f = reduceGate(f, { type: 'core-up', hasNode: true });
    assert.equal(verifyPhase(viewGate(f)), 'running');
    const egress = { node: 'n', ip: '203.0.113.7', country: 'US' };
    const mismatch = reduceGate(f, { type: 'check-finished', generation: f.generation, result: { ok: false, kind: 'mismatch', egress }, at: 1 });
    assert.equal(verifyPhase(viewGate(mismatch)), 'mismatch');
    const timeout = reduceGate(f, { type: 'check-finished', generation: f.generation, result: { ok: false, kind: 'failed', error: 'The operation was aborted due to timeout' }, at: 1 });
    assert.equal(verifyPhase(viewGate(timeout)), 'timeout');
    const failed = reduceGate(f, { type: 'check-finished', generation: f.generation, result: { ok: false, kind: 'failed', error: 'HTTP 502' }, at: 1 });
    assert.equal(verifyPhase(viewGate(failed)), 'failed');
    const ok = reduceGate(f, { type: 'check-finished', generation: f.generation, result: { ok: true, egress: { ...egress, country: 'JP' } }, at: 1 });
    assert.equal(verifyPhase(viewGate(ok)), 'ok');
    assert.equal(verifyPhase(viewGate(reduceGate(f, { type: 'core-down' }))), 'core');
    assert.equal(verifyPhase(viewGate(reduceGate(f, { type: 'pause' }))), 'paused');
    assert.equal(gateReason(viewGate(reduceGate(f, { type: 'node-changed', hasNode: false }))), 'noNode');
    assert.equal(gateReason(viewGate(reduceGate(initialGate(''), { type: 'core-up', hasNode: true }))), 'noCountry');
  }
  setLocale('zh');
});

test('the timeout shown to the user is the exit check’s own', async () => {
  const source = await readFile(new URL('../../src/main/network.ts', import.meta.url), 'utf8');
  const fetchText = source.slice(source.indexOf('export async function fetchText'));
  assert.match(fetchText.slice(0, fetchText.indexOf('\n}')), new RegExp(`AbortSignal\\.timeout\\(${EXIT_CHECK_TIMEOUT_S}_000\\)`));
});

test('colo sites have valid coordinates and timezones and must match the exit country', () => {
  assert.ok(Object.keys(COLO_SITES).length > 50);
  for (const [code, site] of Object.entries(COLO_SITES)) {
    assert.match(code, /^[A-Z]{3}$/);
    assert.match(site.country, /^[A-Z]{2}$/);
    assert.ok(site.city && site.cityZh && Math.abs(site.latitude) <= 90 && Math.abs(site.longitude) <= 180, code);
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: site.timezone }), code);
  }
  assert.equal(coloForCountry('nrt', 'JP')?.city, 'Tokyo');
  assert.equal(coloForCountry('HKG', 'HK')?.cityZh, '香港');
  assert.equal(coloForCountry('NRT', 'US'), null);
  assert.equal(coloForCountry('ZZZ', 'JP'), null);
});
