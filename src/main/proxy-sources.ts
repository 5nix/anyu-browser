import { stringify } from 'yaml';
import type { NodeSelection, ProxySources } from '../shared/profile.ts';
import { extractProxies } from './proxy/subscription.ts';

/** JSON's escaping makes this encoding injective even for adversarial source and node names. */
export const coreNodeName = (source: string, node: string): string => `cave:${JSON.stringify([source, node])}`;
export function sourceProxies(proxy: ProxySources): Record<string, unknown>[] {
  return proxy.sources.flatMap(source => {
    try {
      return extractProxies(stringify({ proxies: source.nodes })).map(node => ({ ...node, name: coreNodeName(source.id, String(node.name)) }));
    } catch { return []; }
  });
}
export function selectedCoreName(proxy: ProxySources): string {
  const selected = proxy.selected;
  if (!selected) return '';
  const name = coreNodeName(selected.source, selected.node);
  return sourceProxies(proxy).some(node => node.name === name) ? name : '';
}
export function removeSource(proxy: ProxySources, id: string): ProxySources {
  return { sources: proxy.sources.filter(source => source.id !== id), selected: proxy.selected?.source === id ? null : proxy.selected };
}
export function sameNode(a: NodeSelection | null, b: NodeSelection | null): boolean {
  return a === b || (!!a && !!b && a.source === b.source && a.node === b.node);
}
