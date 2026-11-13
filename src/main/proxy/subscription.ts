import { t } from '../../shared/i18n/index.ts';
// Subscriptions contribute proxy server definitions and nothing else: their rules, DNS, TUN,
// ports and mode are discarded, so a subscription can never add a direct route.
import { parse } from 'yaml';

const RESERVED = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'GLOBAL', 'COMPATIBLE']);
const DIRECT_TYPES = new Set(['direct', 'dns', 'reject', 'pass']);

export class SubscriptionError extends Error {}

export function extractProxies(text: string): Record<string, unknown>[] {
  let doc: any;
  try {
    doc = parse(text);
  } catch (err: any) {
    throw new SubscriptionError(t('core.invalidYaml', { error: err.message.split('\n')[0] }));
  }
  if (!doc || !Array.isArray(doc.proxies)) throw new SubscriptionError(t('core.noProxies'));
  const seen = new Set<string>();
  const proxies = doc.proxies.filter((p: any) => {
    if (!p || typeof p !== 'object' || typeof p.name !== 'string' || typeof p.type !== 'string') return false;
    if (RESERVED.has(p.name.toUpperCase()) || DIRECT_TYPES.has(p.type.toLowerCase()) || seen.has(p.name)) return false;
    // A proxy may not chain through another named outbound; that is how DIRECT sneaks back in.
    delete p['dialer-proxy'];
    seen.add(p.name);
    return true;
  });
  if (proxies.length === 0) throw new SubscriptionError(t('core.noUsableProxies'));
  return proxies;
}
