import { nativeImage, type Session } from 'electron';
import { FAVICON_MAX_BYTES, faviconOrigin, faviconType, type Favicons } from '../store/favicons.ts';

// Requests use the exact browsing session, including its proxy and cookies. A URL is tried at most
// once per session; redirects are rejected so every requested URL has passed validation.
export class FaviconFetcher {
  private attempts = new WeakMap<Session, Map<string, { generation: number; task: Promise<Buffer | null> }>>();
  private generation = 0;
  constructor(private cache: Favicons, private canBrowse: () => boolean) {}
  get(page: string): string | null { return this.cache.get(page); }
  clear(url?: string): void { this.generation++; this.cache.clear(url); }
  async load(ses: Session, page: string, urls: string[]): Promise<string | null> {
    if (!faviconOrigin(page) || !this.canBrowse()) return null;
    const generation = this.generation;
    let attempts = this.attempts.get(ses); if (!attempts) { attempts = new Map(); this.attempts.set(ses, attempts); }
    for (const url of urls.slice(0, 16)) {
      if (!faviconOrigin(url) || !this.canBrowse()) continue;
      let attempt = attempts.get(url);
      if (!attempt) { attempt = { generation, task: this.fetch(ses, url) }; attempts.set(url, attempt); }
      if (attempt.generation !== generation) continue;
      const data = await attempt.task;
      if (generation !== this.generation || !this.canBrowse()) return null;
      if (data) { this.cache.put(page, data); return this.cache.get(page); }
    }
    return null;
  }
  private async fetch(ses: Session, url: string): Promise<Buffer | null> {
    try {
      const response = await ses.fetch(url, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!response.ok || !faviconType(response.headers.get('content-type') || '') || Number(response.headers.get('content-length') || 0) > FAVICON_MAX_BYTES || !response.body) return null;
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > FAVICON_MAX_BYTES) { await reader.cancel(); return null; } chunks.push(value); }
      const image = nativeImage.createFromBuffer(Buffer.concat(chunks)); if (image.isEmpty()) return null;
      const dimensions = image.getSize(); if (!dimensions.width || !dimensions.height || dimensions.width > 4096 || dimensions.height > 4096) return null;
      const png = image.resize({ width: 32, height: 32, quality: 'best' }).toPNG(); return png.length <= FAVICON_MAX_BYTES ? png : null;
    } catch { return null; }
  }
}
