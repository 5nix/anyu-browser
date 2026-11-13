/** The gate state is a snapshot at failure time, not a diagnosis of the failure. */
export function failureKind(gateState: string): 'network' | 'gate' {
  return gateState === 'open' ? 'network' : 'gate';
}

/** A recovery page may show the destination, but never its credentials, query or fragment. */
export function displayFailureUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return '';
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

/** Chromium reserves this range for certificate validation errors. */
export function certificateFailure(code: number): boolean {
  return code <= -200 && code > -220;
}
