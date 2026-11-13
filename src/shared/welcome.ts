import type { GateView } from '../main/gate.ts';
import { externalProxyNode } from '../main/external-proxy.ts';
import type { Profile } from './profile.ts';

export type { SetupChoices } from './profile.ts';
import type { SetupChoices } from './profile.ts';

export type SetupStep = 'welcome' | 'connect' | 'node' | 'verify' | 'identity' | 'personalise' | 'normal';

/** Derive the visible step anew whenever the profile, choices, or gate changes. */
export function deriveSetupStep(profile: Profile, gate: GateView, choices: SetupChoices): SetupStep {
  if (choices.dismissed) return 'normal';
  if (!choices.started) return 'welcome';
  const external = profile.connectionMode === 'external';
  const localPort = !!externalProxyNode(profile.externalProxy);
  if (external ? !localPort : profile.proxy.sources.length === 0) return 'connect';
  if ((!external && !profile.proxy.selected) || !profile.egressCountry) return 'node';
  if (gate.state !== 'open') return 'verify';
  if (!choices.identityHandled) return 'identity';
  if (!choices.personaliseHandled) return 'personalise';
  return 'normal';
}
