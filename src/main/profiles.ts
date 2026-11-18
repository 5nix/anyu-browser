import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename, rm, cp } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { accentValue, type Accent } from '../shared/appearance.ts';
import { defaultProfile, normalizeProfile, type Profile } from '../shared/profile.ts';
import {
  DEFAULT_PROFILE_ID, MAX_PROFILES, isValidProfileId, normalizeProfilesRegistry,
  parseProfileCliArg, pickNextAccent, sanitizeProfileName,
  type CreateProfileInput, type ProfileRegistryEntry, type ProfilesRegistry, type ProfileSummary,
} from '../shared/profiles.ts';

export interface ProfileManagerOptions {
  baseDir: string;
  explicitProfileDir?: string;
  argv?: readonly string[];
  defaultName?: string;
  pid?: number;
  isPidAlive?: (pid: number) => boolean;
  spawnProcess?: (profileId: string, profileDir: string) => void;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLockPid(file: string): number | undefined {
  try {
    const pid = JSON.parse(readFileSync(file, 'utf8'))?.pid;
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export function spawnProfileProcess(
  profileId: string,
  options: { execPath?: string; argv?: readonly string[]; appEntry?: string; env?: NodeJS.ProcessEnv } = {},
): void {
  const env = { ...(options.env ?? process.env) };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CAVE_PROFILE;

  const args = (options.argv ?? process.argv.slice(1))
    .filter(arg => !arg.startsWith('--profile-id=') && !/^https?:\/\//i.test(arg));
  if (options.appEntry && args[0] !== options.appEntry) args.unshift(options.appEntry);
  args.push(`--profile-id=${profileId}`);
  const child = spawn(options.execPath ?? process.execPath, args, { env, detached: true, stdio: 'ignore' });
  child.unref();
}

export class ProfileManager {
  private readonly baseDir: string;
  private readonly registryFile: string;
  private readonly defaultName: string;
  private readonly fallback: Profile;
  private readonly pid: number;
  private readonly probePid: (pid: number) => boolean;
  private readonly spawnProcess: NonNullable<ProfileManagerOptions['spawnProcess']>;
  private registry: ProfilesRegistry;
  private activeId = DEFAULT_PROFILE_ID;
  private customDefaultDir?: string;
  private lockPid?: number;

  private constructor(options: ProfileManagerOptions) {
    this.baseDir = options.baseDir;
    this.registryFile = join(this.baseDir, 'profiles.json');
    this.defaultName = options.defaultName ?? '默认环境';
    this.registry = normalizeProfilesRegistry(undefined, this.defaultName);
    const host = Intl.DateTimeFormat().resolvedOptions();
    this.fallback = defaultProfile(host.locale, host.timeZone);
    this.pid = options.pid ?? process.pid;
    this.probePid = options.isPidAlive ?? isPidAlive;
    this.spawnProcess = options.spawnProcess ?? (id => spawnProfileProcess(id, { argv: options.argv?.slice(1) }));
  }

  static async open(options: ProfileManagerOptions): Promise<ProfileManager> {
    const manager = new ProfileManager(options);
    await mkdir(join(manager.baseDir, 'profiles'), { recursive: true });
    await manager.updateRegistry(async () => {
      const registry = manager.registry;
      if (options.explicitProfileDir) {
        const explicitDir = resolve(options.explicitProfileDir);
        const entry = registry.entries.find(({ id }) => resolve(manager.dirFor(id)) === explicitDir);
        if (entry) manager.activeId = entry.id;
        else manager.customDefaultDir = explicitDir;
      } else {
        const cliId = parseProfileCliArg(options.argv ?? process.argv);
        manager.activeId = registry.entries.find(({ id }) => id === cliId)?.id ?? registry.lastActiveId;
      }
      await mkdir(manager.currentDir, { recursive: true });
      if (manager.customDefaultDir) {
        if (!existsSync(manager.registryFile)) await manager.saveRegistry();
      } else {
        registry.lastActiveId = manager.currentId;
        await manager.saveRegistry();
      }
    });
    return manager;
  }

  get currentId(): string { return this.activeId; }
  get currentDir(): string { return this.dirFor(this.currentId); }
  get currentEntry(): ProfileRegistryEntry { return { ...this.entryFor(this.currentId) }; }

  dirFor(id: string): string {
    if (!isValidProfileId(id)) throw new Error('Invalid profile ID');
    return id === DEFAULT_PROFILE_ID
      ? this.customDefaultDir ?? join(this.baseDir, 'profile')
      : join(this.baseDir, 'profiles', id);
  }

  markCurrentRunning(pid = this.pid): void {
    writeFileSync(join(this.currentDir, '.cave-lock.json'), JSON.stringify({ pid, startedAt: Date.now() }));
    this.lockPid = pid;
  }

  releaseCurrentLock(): void {
    if (this.lockPid === undefined) return;
    const file = join(this.currentDir, '.cave-lock.json');
    if (readLockPid(file) === this.lockPid) rmSync(file, { force: true });
    this.lockPid = undefined;
  }

  isRunning(id: string): boolean {
    if (id === this.currentId) return true;
    const pid = readLockPid(join(this.dirFor(id), '.cave-lock.json'));
    return pid !== undefined && this.probePid(pid);
  }

  async list(currentProfileLive?: Profile): Promise<ProfileSummary[]> {
    const registry = await this.readRegistry();
    return Promise.all(registry.entries.map(async entry => {
      const current = entry.id === this.currentId;
      if (current && currentProfileLive) return this.summarize(entry, currentProfileLive);
      const raw = await readJson(join(this.dirFor(entry.id), 'profile.json'));
      return this.summarize(entry, normalizeProfile(raw, this.fallback));
    }));
  }

  async syncCurrentAccent(accent: Accent): Promise<void> {
    await this.updateRegistry(async () => {
      const entry = this.entryFor(this.currentId);
      if (entry.accent === accent) return;
      entry.accent = accent;
      await this.saveRegistry();
    });
  }

  async create(input: CreateProfileInput, currentProfile?: Profile): Promise<ProfileSummary> {
    return this.updateRegistry(async () => {
      this.checkCapacity();
      const name = sanitizeProfileName(input.name);
      if (!name) throw new Error('Invalid profile name');
      const accent = input.accent ? accentValue(input.accent) : pickNextAccent(this.registry.entries);
      const profile = defaultProfile(this.fallback.locale, this.fallback.timezone);
      if (input.cloneProxyFromCurrent && currentProfile) {
        profile.connectionMode = currentProfile.connectionMode;
        profile.externalProxy = structuredClone(currentProfile.externalProxy);
        profile.monitorUrls = [...currentProfile.monitorUrls];
        profile.proxy = {
          sources: structuredClone(currentProfile.proxy.sources),
          selected: currentProfile.proxy.selected ? { ...currentProfile.proxy.selected } : null,
        };
        profile.setup.started = profile.proxy.sources.length > 0 || profile.externalProxy.port > 0;
      }
      return this.addProfile(name, accent, profile);
    });
  }

  async rename(id: string, newName: string): Promise<ProfileSummary[]> {
    const name = sanitizeProfileName(newName);
    if (!name) throw new Error('Invalid profile name');
    await this.updateRegistry(async () => {
      this.entryFor(id).name = name;
      await this.saveRegistry();
    });
    return this.list();
  }

  async remove(id: string): Promise<ProfileSummary[]> {
    await this.updateRegistry(async () => {
      if (id === this.currentId) throw new Error('Cannot delete the current profile');
      if (this.isRunning(id)) throw new Error('Cannot delete a running profile');
      if (id === DEFAULT_PROFILE_ID) throw new Error('Cannot delete the default profile');
      const entry = this.entryFor(id);
      this.registry.entries = this.registry.entries.filter(candidate => candidate !== entry);
      if (this.registry.lastActiveId === id) this.registry.lastActiveId = this.currentId;
      await this.saveRegistry();
      await rm(this.dirFor(id), { recursive: true, force: true });
    });
    return this.list();
  }

  async importDirectory(sourceDir: string, customName?: string): Promise<ProfileSummary> {
    const raw = await readJson(join(sourceDir, 'profile.json'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid profile.json');
    const profile = normalizeProfile(raw, this.fallback);
    const name = sanitizeProfileName(customName) ?? sanitizeProfileName(basename(sourceDir)) ?? 'Imported';
    return this.updateRegistry(async () => {
      this.checkCapacity();
      return this.addProfile(name, pickNextAccent(this.registry.entries), profile, sourceDir);
    });
  }

  async launch(id: string): Promise<void> {
    await this.updateRegistry(async () => {
      this.entryFor(id);
      this.registry.lastActiveId = id;
      await this.saveRegistry();
    });
    if (id !== this.currentId) this.spawnProcess(id, this.dirFor(id));
  }

  private entryFor(id: string): ProfileRegistryEntry {
    if (!isValidProfileId(id)) throw new Error('Invalid profile ID');
    const entry = this.registry.entries.find(candidate => candidate.id === id);
    if (!entry) throw new Error('Profile not found');
    return entry;
  }

  private checkCapacity(): void {
    if (this.registry.entries.length >= MAX_PROFILES) throw new Error('Maximum number of profiles reached');
  }

  private summarize(entry: ProfileRegistryEntry, profile: Profile): ProfileSummary {
    return {
      ...entry,
      dir: this.dirFor(entry.id),
      current: entry.id === this.currentId,
      running: this.isRunning(entry.id),
      egressCountry: profile.egressCountry,
      timezone: profile.timezone,
      locale: profile.locale,
      connectionMode: profile.connectionMode,
      nodeCount: profile.proxy.sources.reduce((count, source) => count + source.nodes.length, 0),
      setupFinished: profile.setup.finished,
    };
  }

  private async addProfile(name: string, accent: Accent, profile: Profile, sourceDir?: string): Promise<ProfileSummary> {
    let id: string;
    do {
      id = 'prof_' + randomBytes(6).toString('hex');
    } while (this.registry.entries.some(entry => entry.id === id) || existsSync(this.dirFor(id)));

    const dir = this.dirFor(id);
    const entry = { id, name, accent, createdAt: Date.now() };
    await mkdir(dir);
    try {
      await writeFile(join(dir, 'profile.json'), JSON.stringify(profile, null, 2) + '\n', { mode: 0o600 });
      await writeFile(join(dir, 'ui.json'), JSON.stringify({ accent }));
      if (sourceDir) {
        for (const file of ['cave.sqlite', 'ui.json']) {
          try {
            await cp(join(sourceDir, file), join(dir, file), { dereference: true });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
      }
      this.registry.entries.push(entry);
      await this.saveRegistry();
    } catch (error) {
      this.registry.entries = this.registry.entries.filter(candidate => candidate !== entry);
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
    return this.summarize(entry, profile);
  }

  private async readRegistry(): Promise<ProfilesRegistry> {
    return normalizeProfilesRegistry(await readJson(this.registryFile), this.defaultName);
  }

  private async saveRegistry(): Promise<void> {
    const temp = this.registryFile + '.tmp';
    try {
      await writeFile(temp, JSON.stringify(this.registry, null, 2) + '\n');
      await rename(temp, this.registryFile);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  // Serialize the read-modify-write sequence across windows and processes.
  private async updateRegistry<T>(update: () => Promise<T>): Promise<T> {
    const lock = this.registryFile + '.lock';
    let deadline = Date.now() + 5_000;
    for (;;) {
      try {
        await mkdir(lock);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (Date.now() >= deadline) {
          await rm(lock, { recursive: true, force: true });
          deadline = Date.now() + 5_000;
          continue;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    try {
      this.registry = await this.readRegistry();
      return await update();
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
}
