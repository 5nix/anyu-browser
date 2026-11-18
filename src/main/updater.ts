import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  GITHUB_RELEASES_API,
  compareVersions,
  isAllowedGithubReleaseUrl,
  normalizeVersion,
  parseVersion,
  pickLatestRelease,
  type UpdateRelease,
} from '../shared/updates.ts';

export type UpdateError =
  | { kind: 'rateLimit'; status: number }
  | { kind: 'http'; status: number }
  | { kind: 'timeout' }
  | { kind: 'network' }
  | { kind: 'invalid' };

export type UpdateStatus = 'idle' | 'checking' | 'latest' | 'available' | 'error';

export interface UpdateState {
  currentVersion: string;
  autoCheck: boolean;
  status: UpdateStatus;
  checkedAt: number | null;
  via: 'proxy' | 'direct' | null;
  available: UpdateRelease | null;
  error: UpdateError | null;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface UpdateCheckerOptions {
  currentVersion: string;
  cacheFile: string;
  autoCheck: boolean;
  isGateOpen: () => boolean;
  proxyFetch: FetchLike;
  directFetch?: FetchLike;
  onChange: (state: UpdateState) => void;
  apiUrl?: string;
  cacheTtlMs?: number;
  startupGraceMs?: number;
  requestTimeoutMs?: number;
  now?: () => number;
  disableAutoSchedule?: boolean;
}

interface CachedUpdateFile {
  version: 1;
  currentVersion: string;
  checkedAt: number;
  via: 'proxy' | 'direct';
  available: UpdateRelease | null;
}

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_STARTUP_GRACE_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;

export class UpdateChecker {
  private readonly opts: UpdateCheckerOptions;
  private currentState: UpdateState;
  private inFlight: Promise<UpdateState> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private startupAttempted = false;
  private disposed = false;
  private controller: AbortController | null = null;

  constructor(opts: UpdateCheckerOptions) {
    this.opts = opts;
    this.currentState = {
      currentVersion: opts.currentVersion,
      autoCheck: opts.autoCheck,
      status: 'idle',
      checkedAt: null,
      via: null,
      available: null,
      error: null,
    };
  }

  get state(): UpdateState {
    return this.currentState;
  }

  private emit(next: Partial<UpdateState>): UpdateState {
    this.currentState = { ...this.currentState, ...next };
    if (!this.disposed) this.opts.onChange(this.currentState);
    return this.currentState;
  }

  private get cacheTtlMs(): number {
    return this.opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  private get startupGraceMs(): number {
    return this.opts.startupGraceMs ?? DEFAULT_STARTUP_GRACE_MS;
  }

  private get requestTimeoutMs(): number {
    return this.opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private clearStartupTimer(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
  }

  private async readFreshCache(): Promise<CachedUpdateFile | null> {
    try {
      const raw = await readFile(this.opts.cacheFile, 'utf8');
      const data = JSON.parse(raw) as Partial<CachedUpdateFile>;
      if (data.version !== 1) return null;
      if (data.currentVersion !== this.opts.currentVersion) return null;
      if (typeof data.checkedAt !== 'number' || !Number.isFinite(data.checkedAt)) return null;
      if (this.now() - data.checkedAt >= this.cacheTtlMs || this.now() < data.checkedAt) return null;
      if (data.via !== 'proxy' && data.via !== 'direct') return null;
      if (data.available !== null) {
        if (!data.available || typeof data.available !== 'object') return null;
        if (typeof data.available.version !== 'string' || typeof data.available.tag !== 'string') return null;
        if (!parseVersion(data.available.version) || !isAllowedGithubReleaseUrl(data.available.url)) return null;
        if (compareVersions(data.available.version, this.opts.currentVersion) <= 0) return null;
      }
      return {
        version: 1,
        currentVersion: data.currentVersion,
        checkedAt: data.checkedAt,
        via: data.via,
        available: data.available,
      };
    } catch {
      return null;
    }
  }

  private async writeCache(entry: CachedUpdateFile): Promise<void> {
    try {
      await mkdir(dirname(this.opts.cacheFile), { recursive: true });
      await writeFile(this.opts.cacheFile, JSON.stringify(entry), 'utf8');
    } catch {
      // Cache persistence is best-effort and must never fail an update check.
    }
  }

  async scheduleAutoCheck(): Promise<void> {
    if (this.disposed || this.opts.disableAutoSchedule || !this.currentState.autoCheck) return;
    if (this.startupAttempted) return;
    const cached = await this.readFreshCache();
    if (this.disposed || !this.currentState.autoCheck) return;
    if (cached) {
      this.startupAttempted = true;
      this.emit({
        status: cached.available ? 'available' : 'latest',
        checkedAt: cached.checkedAt,
        via: cached.via,
        available: cached.available,
        error: null,
      });
      return;
    }
    if (this.startupAttempted || this.startupTimer) return;
    const delay = this.opts.isGateOpen() ? Math.min(500, this.startupGraceMs) : this.startupGraceMs;
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      if (this.disposed || !this.currentState.autoCheck || this.startupAttempted) return;
      this.startupAttempted = true;
      void this.checkNow();
    }, delay);
  }

  notifyGateOpen(): void {
    if (this.disposed || this.opts.disableAutoSchedule || !this.currentState.autoCheck) return;
    if (this.startupAttempted) return;
    if (!this.startupTimer) return;
    this.clearStartupTimer();
    this.startupAttempted = true;
    void this.checkNow();
  }

  setAutoCheck(enabled: boolean): void {
    const next = Boolean(enabled);
    if (next === this.currentState.autoCheck) return;
    this.emit({ autoCheck: next });
    if (!next) {
      this.clearStartupTimer();
      return;
    }
    if (this.currentState.status === 'idle' && !this.inFlight) {
      void this.scheduleAutoCheck();
    }
  }

  async checkNow(): Promise<UpdateState> {
    if (this.disposed) return this.currentState;
    if (this.inFlight) return this.inFlight;
    this.clearStartupTimer();
    this.startupAttempted = true;
    const run = this.performCheck();
    this.inFlight = run;
    try {
      return await run;
    } finally {
      if (this.inFlight === run) this.inFlight = null;
    }
  }

  private async performCheck(): Promise<UpdateState> {
    const via: 'proxy' | 'direct' = this.opts.isGateOpen() ? 'proxy' : 'direct';
    const fetcher = via === 'proxy' ? this.opts.proxyFetch : (this.opts.directFetch ?? fetch);
    const previousAvailable = this.currentState.available;
    const previousCheckedAt = this.currentState.checkedAt;
    const previousVia = this.currentState.via;

    this.emit({ status: 'checking', error: null });

    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(new Error('timeout')), this.requestTimeoutMs);

    try {
      const response = await fetcher(this.opts.apiUrl ?? GITHUB_RELEASES_API, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `Anyu/${normalizeVersion(this.opts.currentVersion) ?? this.opts.currentVersion}`,
        },
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!response.ok) {
        const error: UpdateError = (response.status === 403 || response.status === 429)
          ? { kind: 'rateLimit', status: response.status }
          : { kind: 'http', status: response.status };
        return this.emit({
          status: 'error',
          checkedAt: previousCheckedAt,
          via: previousVia,
          available: previousAvailable,
          error,
        });
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return this.emit({
          status: 'error',
          checkedAt: previousCheckedAt,
          via: previousVia,
          available: previousAvailable,
          error: { kind: 'invalid' },
        });
      }
      if (!Array.isArray(payload)) {
        return this.emit({
          status: 'error',
          checkedAt: previousCheckedAt,
          via: previousVia,
          available: previousAvailable,
          error: { kind: 'invalid' },
        });
      }

      const available = pickLatestRelease(payload, this.opts.currentVersion);
      const checkedAt = this.now();
      await this.writeCache({
        version: 1,
        currentVersion: this.opts.currentVersion,
        checkedAt,
        via,
        available,
      });
      return this.emit({
        status: available ? 'available' : 'latest',
        checkedAt,
        via,
        available,
        error: null,
      });
    } catch (err) {
      const aborted = controller.signal.aborted || (err instanceof Error && err.name === 'AbortError');
      return this.emit({
        status: 'error',
        checkedAt: previousCheckedAt,
        via: previousVia,
        available: previousAvailable,
        error: aborted ? { kind: 'timeout' } : { kind: 'network' },
      });
    } finally {
      clearTimeout(timer);
      if (this.controller === controller) this.controller = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearStartupTimer();
    this.controller?.abort();
    this.controller = null;
  }
}
