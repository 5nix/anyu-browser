// External connection mode: the built-in core stays the gatekeeper and its only outbound is a
// synthetic node pointing at a local HTTP/SOCKS port of proxy software the user already runs.
// The browser never learns that port; it still talks only to the core's own local listeners.
import type { ExternalProxy } from '../shared/profile.ts';

export const EXTERNAL_NODE_NAME = 'local-proxy-port';

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

/**
 * The core node for the external endpoint, or null when it is not usable: the endpoint must be
 * loopback (a LAN address would put browser traffic on the local network in cleartext, and the
 * mode is defined for software on this machine) and the port must be a real port.
 */
export function externalProxyNode(p: ExternalProxy): Record<string, unknown> | null {
  if (!p || (p.protocol !== 'socks5' && p.protocol !== 'http')) return null;
  if (!isLoopbackHost(p.host) || !Number.isInteger(p.port) || p.port < 1 || p.port > 65535) return null;
  const node: Record<string, unknown> = {
    name: EXTERNAL_NODE_NAME,
    type: p.protocol,
    server: p.host.trim(),
    port: p.port,
    udp: false,
  };
  if (p.username) node.username = p.username;
  const secret = p['password'];
  if (secret) node['password'] = secret;
  return node;
}
