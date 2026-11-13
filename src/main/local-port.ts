// Whether the user's own proxy software listens at the configured local port. Only a TCP connect
// to a loopback address; nothing is sent, and no other host is ever dialled from here.
import { connect } from 'node:net';
import { externalProxyNode } from './external-proxy.ts';
import type { ExternalProxy } from '../shared/profile.ts';

export function localPortOpen(p: ExternalProxy, timeoutMs = 3000): Promise<boolean> {
  if (!externalProxyNode(p)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = connect({ host: p.host.trim(), port: p.port });
    const done = (open: boolean) => { socket.destroy(); resolve(open); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}
