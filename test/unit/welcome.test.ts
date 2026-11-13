import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfile, type Profile } from '../../src/shared/profile.ts';
import { deriveSetupStep, type SetupChoices } from '../../src/shared/welcome.ts';
import { COLO_SITES, coloForCountry } from '../../src/shared/colo.ts';
import type { GateView } from '../../src/main/gate.ts';

const choices: SetupChoices = { started: true, identityHandled: false, personaliseHandled: false, dismissed: false };
const gate: GateView = { state: 'closed', reason: '', paused: false, egress: null, checkedAt: null };
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
  const open = { ...gate, state: 'open' as const };
  assert.equal(deriveSetupStep(p, open, choices), 'identity');
  assert.equal(deriveSetupStep(p, open, { ...choices, identityHandled: true }), 'personalise');
  const done = { ...choices, identityHandled: true, personaliseHandled: true };
  assert.equal(deriveSetupStep(p, open, done), 'normal');
  assert.equal(deriveSetupStep(p, gate, done), 'verify');
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

test('colo sites have valid coordinates and timezones and must match the exit country', () => {
  for (const [code, site] of Object.entries(COLO_SITES)) {
    assert.match(code, /^[A-Z]{3}$/);
    assert.match(site.country, /^[A-Z]{2}$/);
    assert.ok(site.city && Math.abs(site.latitude) <= 90 && Math.abs(site.longitude) <= 180);
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: site.timezone }));
  }
  assert.equal(coloForCountry('nrt', 'JP')?.city, 'Tokyo');
  assert.equal(coloForCountry('NRT', 'US'), null);
  assert.equal(coloForCountry('ZZZ', 'JP'), null);
});
