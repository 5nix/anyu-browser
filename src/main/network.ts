import { t } from '../shared/i18n/index.ts';
// The one route out. From process start Chromium may only talk to Cave's local SOCKS port and may
// not resolve names itself, so SOCKS carries hostnames to the core, which resolves them remotely.
// If nothing listens on that port, connections fail: that is the fail-closed guarantee. This is
// the only module that sets proxies or touches the host resolver.
import { app, session, type Session } from 'electron';
import { createServer } from 'node:net';
import type { Ports } from './proxy/config.ts';
import type { SubscriptionVia } from '../shared/profile.ts';

export const TRACE_URL = process.env.CAVE_TRACE_URL || 'https://www.cloudflare.com/cdn-cgi/trace';
export const BROWSER_PARTITION = 'persist:cave';

/** Must run before app ready. */
export function pinNetwork(ports: Ports): void {
  const switches: [string, string?][] = [
    ['proxy-server', `socks5://127.0.0.1:${ports.browser}`],
    ['proxy-bypass-list', '<-loopback>'],
    ['host-resolver-rules', 'MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'],
    ['disable-quic'],
    ['disable-ipv6'],
    ['disable-background-networking'],
    ['disable-component-update'],
    ['disable-domain-reliability'],
    ['disable-breakpad'],
    ['disable-features', 'DnsOverHttpsUpgrade'],
  ];
  for (const [name, value] of switches) app.commandLine.appendSwitch(name, value);
  // WebRTC stays functional but may only use proxied paths: no host candidates, no raw UDP.
  app.on('web-contents-created', (_e, wc) => wc.setWebRTCIPHandlingPolicy(WEBRTC_POLICY));
  // No spellchecker: Hunspell (Windows/Linux) would fetch remote dictionaries in the background.
  app.on('session-created', (ses) => {
    ses.setSpellCheckerEnabled(false);
    if (process.platform !== 'darwin') ses.setSpellCheckerLanguages([]);
  });
}

export const WEBRTC_POLICY = 'disable_non_proxied_udp';

/** After ready: no built-in resolver, no DoH, and the sessions pinned to the same port. */
export async function pinSessions(ports: Ports): Promise<void> {
  app.configureHostResolver({ secureDnsMode: 'off', enableBuiltInResolver: false });
  const rules = { proxyRules: `socks5://127.0.0.1:${ports.browser}`, proxyBypassRules: '<-loopback>' };
  await Promise.all([session.defaultSession.setProxy(rules), browserSession().setProxy(rules)]);
}

export const browserSession = (): Session => session.fromPartition(BROWSER_PARTITION);

let probe: Promise<Session> | null = null;
/** The shared probe session is ready only after its proxy rules are installed. */
export async function probeSession(ports: Ports): Promise<Session> {
  if (!probe) {
    probe = (async () => {
      const ses = session.fromPartition('cave-probe', { cache: false });
      await ses.setProxy({ proxyRules: `socks5://127.0.0.1:${ports.probe}`, proxyBypassRules: '<-loopback>' });
      return ses;
    })().catch((err) => { probe = null; throw err; });
  }
  return probe;
}

/** Clear the shared pool before and after a measurement. */
export async function freshProbeSession(ports: Ports): Promise<{ session: Session; close: () => Promise<void> }> {
  const session = await probeSession(ports);
  await session.closeAllConnections();
  return { session, close: () => session.closeAllConnections() };
}

/**
 * The subscription, by the route the user picked. "direct" is the one request Cave makes outside
 * the core: a single fetch of exactly this URL from the main process over the system network, only
 * when the user asks, never through a browser session. "proxy" goes through the selected node.
 * The UA names the core, so subscription servers that pick a format by client answer in Clash YAML.
 */
export async function fetchSubscription(url: string, via: SubscriptionVia, ports: Ports): Promise<string> {
  const init = { headers: { 'User-Agent': 'clash.meta' }, signal: AbortSignal.timeout(15_000) };
  const res = via === 'direct' ? await fetch(url, init) : await (await probeSession(ports)).fetch(url, { ...init, cache: 'no-store' });
  if (!res.ok) throw new Error(t('core.subscriptionHttp', { status: res.status }));
  return res.text();
}

export async function fetchText(ses: Session, url: string): Promise<string> {
  const res = await ses.fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const AVOID = new Set([7890, 7891, 7892, 7893, 7897, 9090, 9097]);

/** Random free loopback ports, never the well-known ones host proxy clients use. */
export async function reservePorts(): Promise<Ports> {
  const taken = new Set<number>();
  const one = (): Promise<number> =>
    new Promise((resolve, reject) => {
      const s = createServer();
      s.once('error', reject);
      s.listen(0, '127.0.0.1', () => {
        const port = (s.address() as { port: number }).port;
        s.close(() => (AVOID.has(port) || taken.has(port) ? resolve(one()) : (taken.add(port), resolve(port))));
      });
    });
  return { browser: await one(), probe: await one(), controller: await one() };
}
