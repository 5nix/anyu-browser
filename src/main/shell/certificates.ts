import { X509Certificate, createHash } from 'node:crypto';

export function certificateKey(url: string, data: string): { host: string; fingerprint: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    const fingerprint = createHash('sha256').update(new X509Certificate(data).raw).digest('hex');
    return { host: parsed.hostname, fingerprint };
  } catch { return null; }
}

export class CertificateExceptions {
  private entries = new Map<string, Set<string>>();
  hasHost(host: string): boolean { return this.entries.has(host); }
  has(host: string, fingerprint: string): boolean { return this.entries.get(host)?.has(fingerprint) ?? false; }
  add(host: string, fingerprint: string): void {
    const fingerprints = this.entries.get(host) ?? new Set<string>();
    fingerprints.add(fingerprint);
    this.entries.set(host, fingerprints);
  }
  clearHost(host: string): void { this.entries.delete(host); }
  clear(): void { this.entries.clear(); }
}
