// First-run setup, derived: the step on screen follows from the profile, the choices the user made
// and the live gate, never from a stored position.
import type { GateView } from '../main/gate.ts';
import { externalProxyNode } from '../main/external-proxy.ts';
import { gateReason } from './gate-conditions.ts';
import type { Profile, SetupChoices } from './profile.ts';

export type { SetupChoices } from './profile.ts';

export type SetupStep = 'welcome' | 'connect' | 'node' | 'verify' | 'identity' | 'personalise' | 'done' | 'normal';
export const SETUP_STEPS: readonly SetupStep[] = ['welcome', 'connect', 'node', 'verify', 'identity', 'personalise', 'done'];
export const stepIndex = (step: SetupStep): number => step === 'normal' ? SETUP_STEPS.length : SETUP_STEPS.indexOf(step);

/** The exit check's own timeout (network.ts, fetchText), shown to the user when it runs out. */
export const EXIT_CHECK_TIMEOUT_S = 15;

export function hasConnection(profile: Profile): boolean {
  return profile.connectionMode === 'external' ? !!externalProxyNode(profile.externalProxy) : profile.proxy.sources.length > 0;
}

/** Derive the visible step anew whenever the profile, choices, or gate changes. */
export function deriveSetupStep(profile: Profile, gate: GateView, choices: SetupChoices = profile.setup): SetupStep {
  if (choices.finished || choices.dismissed) return 'normal';
  if (!choices.started) return 'welcome';
  if (!hasConnection(profile)) return 'connect';
  if ((profile.connectionMode !== 'external' && !profile.proxy.selected) || !profile.egressCountry) return 'node';
  if (gate.state !== 'open') return 'verify';
  if (!choices.identityHandled) return 'identity';
  if (!choices.personaliseHandled) return 'personalise';
  return 'done';
}

/** The five labels of the step indicator and which one a step belongs to. */
export const PHASES = ['welcome', 'connect', 'verify', 'identity', 'personalise'] as const;
export function phaseOf(step: SetupStep): number {
  return { welcome: 0, connect: 1, node: 2, verify: 2, identity: 3, personalise: 4, done: 5, normal: 5 }[step];
}
/** A phase is ticked by the state it stands for, not by having been passed: "verify" only while the gate is open. */
export function phasesDone(profile: Profile, gate: GateView): boolean[] {
  const c = profile.setup;
  return [c.started, hasConnection(profile), gate.state === 'open', c.identityHandled, c.personaliseHandled];
}

/**
 * The screen the page shows: the derived step, unless the user went back to an earlier one (held
 * only in the page) or is still reading a passed check. A hold is dropped as soon as the derived
 * step falls back to it or behind it.
 */
export function visibleStep(derived: SetupStep, held: SetupStep | null): SetupStep {
  return held && stepIndex(held) < stepIndex(derived) ? held : derived;
}

export type VerifyPhase = 'starting' | 'waiting' | 'running' | 'ok' | 'mismatch' | 'timeout' | 'core' | 'paused' | 'failed';
const TIMEOUT = /aborted due to timeout|timed? ?out|TimeoutError/i;

/** What the exit check is doing now, from the gate's own view. */
export function verifyPhase(gate: GateView): VerifyPhase {
  switch (gateReason(gate)) {
    case 'open': return 'ok';
    case 'starting': return 'starting';
    case 'checking': return 'running';
    case 'down': return 'core';
    case 'paused': return 'paused';
    case 'mismatch': return 'mismatch';
    case 'noNode': case 'noExternal': case 'noCountry': return 'waiting';
    case 'checkFailed': return TIMEOUT.test(gate.reason) ? 'timeout' : 'failed';
    default: return 'failed';
  }
}
