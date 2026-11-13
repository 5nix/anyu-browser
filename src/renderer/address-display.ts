export { addressDisplay, registrableDomain, type AddressDisplay } from '../shared/address-display.ts';

export function addressSecurity(tab: import('../shared/ipc.ts').TabState | undefined): 'https' | 'http' | 'exception' | 'internal' | 'unknown' {
  if (!tab) return 'unknown';
  if (tab.kind !== 'web') return 'internal';
  if (!tab.url || tab.url === 'about:blank') return 'unknown';
  if (tab.url.startsWith('about:')) return 'internal';
  if (tab.loading || tab.error || tab.crashed) return 'unknown';
  if (tab.insecure) return 'exception';
  if (tab.url.startsWith('https:')) return 'https';
  if (tab.url.startsWith('http:')) return 'http';
  return 'unknown';
}
