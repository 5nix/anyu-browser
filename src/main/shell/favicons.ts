import { net, type Session, type WebContents } from 'electron';
import { EventEmitter } from 'node:events';
import { FAVICON_MAX_BYTES, faviconOrigin, faviconType, type Favicons } from '../store/favicons.ts';

const PNG_PREFIX = 'data:image/png;base64,';

function webIconUrl(url: string): boolean {
  if (!faviconOrigin(url)) return false;
  const { username, password } = new URL(url);
  return !username && !password;
}

// Runs in the sandboxed chrome, whose CSP allows only data: images. SVG in an image cannot
// execute scripts or load external resources, and only the resulting PNG leaves this renderer.
async function rasterizeIcon(source: string): Promise<string | null> {
  const image = new Image();
  // Wait for the resource, then let canvas decode it synchronously. Image.decode() can
  // wait on the compositor even though a detached icon does not need to be presented.
  const loaded = await new Promise<boolean>((resolve) => {
    const done = (ok: boolean) => { clearTimeout(timeout); resolve(ok); };
    const timeout = setTimeout(() => done(false), 2500);
    image.onload = () => done(true);
    image.onerror = () => done(false);
    image.src = source;
  });
  if (!loaded) return null;
  const { naturalWidth: width, naturalHeight: height } = image;
  if (!width || !height || width > 4096 || height > 4096) return null;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const scale = 32 / Math.max(width, height);
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;
  context.drawImage(image, (32 - scaledWidth) / 2, (32 - scaledHeight) / 2, scaledWidth, scaledHeight);
  return canvas.toDataURL('image/png');
}

async function decodeIcon(chrome: WebContents, source: string): Promise<Buffer | null> {
  if (chrome.isDestroyed()) return null;
  const code = `(${rasterizeIcon.toString()})(${JSON.stringify(source)})`;
  const png: unknown = await chrome.executeJavaScript(code);
  if (typeof png !== 'string' || !png.startsWith(PNG_PREFIX)) return null;
  return Buffer.from(png.slice(PNG_PREFIX.length), 'base64');
}

function fetchIcon(ses: Session, url: string, active: () => boolean): Promise<string | null> {
  // Keep the whole chain in the page's session and validate each redirect before following it.
  return new Promise((resolve) => {
    const request = net.request({ url, session: ses, credentials: 'include', redirect: 'manual', cache: 'no-store', bypassCustomProtocolHandlers: true });
    const finish = (source: string | null) => { clearTimeout(timeout); resolve(source); };
    const stop = () => { finish(null); request.abort(); };
    const timeout = setTimeout(stop, 5000);
    let redirects = 0;

    request.on('redirect', (_status, _method, target) => {
      if (active() && redirects++ < 5 && webIconUrl(target)) request.followRedirect();
      else stop();
    });
    // ClientRequest's writable side can close before the response, so wait for its body or an error.
    request.on('error', () => finish(null));
    request.once('response', (response) => {
      response.on('error', () => finish(null));
      const type = String(response.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
      const generic = !type || type === 'application/octet-stream' || type === 'binary/octet-stream';
      if (!active() || response.statusCode < 200 || response.statusCode >= 300 ||
          !(generic || faviconType(type)) || Number(response.headers['content-length']) > FAVICON_MAX_BYTES) {
        stop();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      // Chromium sniffs raster formats when an image server sends a generic binary Content-Type.
      response.once('end', () => finish(size ? `data:${generic ? 'image/png' : type};base64,${Buffer.concat(chunks).toString('base64')}` : null));
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > FAVICON_MAX_BYTES) stop();
        else chunks.push(chunk);
      });
    });
    request.end();
  });
}

// Share requests in flight. Failed URLs can be fetched again on a later page load.
export class FaviconFetcher extends EventEmitter<{ stored: [] }> {
  private pending = new WeakMap<Session, Map<string, Promise<string | null>>>();
  private generation = 0;
  constructor(private cache: Favicons, private canBrowse: () => boolean) { super(); }
  get(page: string): string | null { return this.cache.get(page); }
  getForShortcut(page: string): string | null { return this.cache.getForShortcut(page); }
  clear(url?: string): void {
    this.generation++;
    this.pending = new WeakMap();
    this.cache.clear(url);
  }

  async load(ses: Session, page: string, urls: string[], chrome: WebContents): Promise<string | null> {
    const origin = faviconOrigin(page);
    if (!origin || !this.canBrowse()) return null;
    const generation = this.generation;
    const active = () => generation === this.generation && this.canBrowse();
    const candidates = new Set([...urls.slice(0, 16), `${origin}/favicon.ico`]);
    for (const url of candidates) {
      if (!active() || chrome.isDestroyed()) return null;
      const inline = url.length <= FAVICON_MAX_BYTES && /^data:(image\/[^;,]+)[;,]/i.exec(url);
      let source: string | null = null;
      if (inline && faviconType(inline[1])) source = url;
      else if (webIconUrl(url)) source = await this.download(ses, url, active);
      if (!source || !active()) continue;
      const data = await decodeIcon(chrome, source).catch(() => null);
      if (!active() || chrome.isDestroyed()) return null;
      if (data?.length) {
        this.cache.put(page, data);
        const icon = this.cache.get(page);
        if (icon) this.emit('stored');
        return icon;
      }
    }
    return null;
  }

  private download(ses: Session, url: string, active: () => boolean): Promise<string | null> {
    let pending = this.pending.get(ses);
    if (!pending) {
      pending = new Map();
      this.pending.set(ses, pending);
    }
    const task = pending.get(url);
    if (task) return task;
    const requests = pending;
    const download = fetchIcon(ses, url, active).catch(() => null).finally(() => requests.delete(url));
    requests.set(url, download);
    return download;
  }
}
