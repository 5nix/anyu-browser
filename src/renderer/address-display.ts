export function addressDisplay(value: string): { full: string; host: string; rest: string } {
  if (!value || value === 'about:blank') return { full: '', host: '', rest: '' };
  try {
    const url = new URL(value);
    url.username = ''; url.password = '';
    const full = url.href;
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      const rest = `${url.pathname}${url.search}${url.hash}`;
      return { full, host: url.host, rest: rest === '/' ? '' : rest };
    }
    return { full, host: full, rest: '' };
  } catch { return { full: value, host: value, rest: '' }; }
}

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
