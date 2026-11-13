import { validSession, type SessionSnapshot } from './session-snapshot.ts';

export type StartupDecision = { action: 'open' } | { action: 'restore' | 'offer'; snapshot: SessionSnapshot };

export function sessionStartup(snapshot: unknown, restore: boolean, cleanExit: boolean): StartupDecision {
  if (!validSession(snapshot)) return { action: 'open' };
  if (!cleanExit) return { action: 'offer', snapshot };
  return restore ? { action: 'restore', snapshot } : { action: 'open' };
}
