import { t } from '../shared/i18n/index.ts';
// Reads, creates and saves <profile>/profile.json.
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { defaultProfile, normalizeProfile, validateProfile, ProfileError, type Profile, type ProfilePatch } from '../shared/profile.ts';

export class ProfileStore {
  /** Set when profile.json could not be read; the defaults are used and the file is left alone. */
  private errorMessage: string | ProfileError | null = null;
  get error(): string | null { return this.errorMessage === null ? null : t('profileFailed', { error: this.errorMessage instanceof ProfileError ? this.errorMessage.localized() : this.errorMessage }); }

  readonly dir: string;
  current: Profile;
  private writable: boolean;
  private constructor(dir: string, current: Profile, writable: boolean) { this.dir = dir; this.current = current; this.writable = writable; }

  get file(): string {
    return join(this.dir, 'profile.json');
  }

  static async open(dir: string): Promise<ProfileStore> {
    await mkdir(dir, { recursive: true });
    const host = Intl.DateTimeFormat().resolvedOptions();
    const fallback = defaultProfile(host.locale, host.timeZone);
    const file = join(dir, 'profile.json');
    if (!existsSync(file)) {
      const store = new ProfileStore(dir, fallback, true);
      await store.write();
      return store;
    }
    try {
      const raw = JSON.parse(await readFile(file, 'utf8'));
      const legacy = raw && typeof raw === 'object' && raw.proxy && !Array.isArray(raw.proxy.sources);
      const legacyFile = join(dir, 'subscription.yaml');
      let legacyNodes: unknown = [];
      if (legacy && existsSync(legacyFile)) legacyNodes = parse(await readFile(legacyFile, 'utf8'))?.proxies ?? [];
      const store = new ProfileStore(dir, normalizeProfile(raw, fallback, legacyNodes), true);
      if (legacy || raw.setup === undefined) await store.write();
      if (legacy) await rm(legacyFile, { force: true });
      return store;
    } catch (err: any) {
      const store = new ProfileStore(dir, fallback, false);
      store.errorMessage = err instanceof ProfileError ? err : String(err.message);
      return store;
    }
  }

  async update(patch: ProfilePatch | { proxy: Partial<Profile['proxy']> }): Promise<Profile> {
    const merged = { ...this.current, ...patch, proxy: { ...this.current.proxy, ...('proxy' in patch ? patch.proxy : {}) } };
    this.current = validateProfile(merged, this.current);
    if (this.writable) await this.write();
    return this.current;
  }

  private write(): Promise<void> {
    const temp = this.file + '.tmp';
    return writeFile(temp, JSON.stringify(this.current, null, 2) + '\n').then(() => rename(temp, this.file));
  }
}
