import { t } from '../shared/i18n/index.ts';
// Owns the core process and the gate. Every operation runs through one serial queue, so the gate
// is always closed before anything that could change where traffic exits (node switch, import).
import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderRuntimeConfig, type Ports } from './proxy/config.ts';
import { Controller } from './proxy/controller.ts';
import { CoreProcess } from './proxy/process.ts';
import { extractProxies } from './proxy/subscription.ts';
import { initialGate, isOpen, needsCheck, reduceGate, viewGate, type CheckResult, type GateEvent, type GateFacts } from './gate.ts';
import { browserSession, fetchSubscription, fetchText, freshProbeSession, TRACE_URL } from './network.ts';
import { acceptExit, measureExit } from './exit-check.ts';
import { randomUUID } from 'node:crypto';
import { coreNodeName, selectedCoreName, sourceProxies, removeSource } from './proxy-sources.ts';
import type { DelayOutcome } from '../shared/ipc.ts';
import type { Profile, SubscriptionVia, ProxySourceOrigin } from '../shared/profile.ts';

const RECHECK_EVERY_MS = 5 * 60_000;
export const HEALTH_URL = process.env.CAVE_TEST_HARNESS === '1' ? 'http://trace.cave.test/cdn-cgi/trace' : 'https://cp.cloudflare.com/generate_204';

export interface GatekeeperOptions {
  binary: string;
  dir: string;
  ports: Ports;
  secret: string;
  profile: () => Profile;
  saveProxy: (patch: Partial<Profile['proxy']>) => Promise<void>;
  resolveOutboundInterface?: () => Promise<string | undefined>;
}

export class Gatekeeper extends EventEmitter {
  facts: GateFacts;
  readonly controller: Controller;
  readonly core: CoreProcess;
  private queue: Promise<unknown> = Promise.resolve();
  private backoff = 1000;
  /** node name → the egress country last seen through it */
  private countries = new Map<string, string>();
  private delayOutcomes = new Map<string, DelayOutcome>();
  private quitting = false;
  private outboundInterface: string | undefined;
  private files: { runtime: string; log: string };

  constructor(private o: GatekeeperOptions) {
    super();
    this.facts = initialGate(o.profile().egressCountry);
    this.files = {
      runtime: join(o.dir, 'runtime.yaml'),
      log: join(o.dir, 'logs', 'core.log'),
    };
    this.controller = new Controller(o.ports.controller, o.secret);
    this.core = new CoreProcess(o.binary, o.dir, this.files.runtime, this.files.log);
    this.core.on('exit', () => this.onCoreExit());
  }

  get view() {
    const view = viewGate(this.facts);
    if (!view.egress) return view;
    const selected = this.o.profile().proxy.selected;
    return { ...view, egress: { ...view.egress, node: selected && coreNodeName(selected.source, selected.node) === view.egress.node ? selected.node : view.egress.node } };
  }
  get open() {
    return isOpen(this.facts);
  }

  start(): Promise<void> {
    setInterval(() => this.reverify(), RECHECK_EVERY_MS).unref();
    return this.serial(async () => {
      await mkdir(join(this.o.dir, 'logs'), { recursive: true });
      await this.boot();
    });
  }

  async quit(): Promise<void> {
    this.quitting = true;
    await this.core.stop();
  }

  /** Stops the core: "paused" means nothing is forwarding, not just a red badge. */
  pause = () =>
    this.serial(async () => {
      await this.dispatch({ type: 'pause' });
      await this.core.stop();
    });

  resume = () =>
    this.serial(async () => {
      await this.dispatch({ type: 'resume' });
      if (!this.core.running) await this.boot();
    });

  /** Pause and re-check: restart the core from scratch, then verify the egress again. */
  restartAndCheck = () =>
    this.serial(async () => {
      await this.dispatch({ type: 'pause' });
      await this.core.stop();
      await this.dispatch({ type: 'resume' });
      await this.boot();
    });

  recheck = () => this.serial(() => this.dispatch({ type: 'recheck' }));

  setCountry = (country: string) => this.serial(() => this.dispatch({ type: 'country-changed', country }));

  /** Re-renders the runtime config (e.g. after allowPrivateNetwork changed). */
  refreshConfig = () => this.serial(() => this.writeAndReload());

  select = (source: string, node: string) => this.serial(async () => {
    if (typeof source !== 'string' || typeof node !== 'string') throw new Error('invalid node');
    const next = { ...this.o.profile().proxy, selected: { source, node } };
    const name = selectedCoreName(next);
    if (!name) throw new Error('unknown node');
    await this.dispatch({ type: 'node-changed', hasNode: false });
    await this.controller.select(name);
    this.delayOutcomes.delete(name);
    await this.dropConnections();
    await this.o.saveProxy({ selected: next.selected });
    await this.dispatch({ type: 'node-changed', hasNode: true });
  });

  importSubscription = (text: string, origin: ProxySourceOrigin, name: string) => this.serial(async () => {
    if (typeof text !== 'string' || text.length > 10_000_000 || typeof name !== 'string' || !name.trim() || name.length > 256) throw new Error('invalid source');
    const nodes = extractProxies(text);
    await this.replaceSources([...this.o.profile().proxy.sources, { id: randomUUID(), name: name.trim(), origin, nodes, updatedAt: Date.now() }]);
  });

  addSubscription = (url: string, via: SubscriptionVia) => this.serial(async () => {
    this.validateSubscription(url, via);
    if (via === 'proxy' && !this.open) throw new Error(t('core.subscriptionNeedsNode'));
    const nodes = extractProxies(await fetchSubscription(url, via, this.o.ports));
    await this.replaceSources([...this.o.profile().proxy.sources, { id: randomUUID(), name: new URL(url).host, origin: { kind: 'subscription', url, via }, nodes, updatedAt: Date.now() }]);
  });

  updateSource = (id: string) => this.serial(async () => {
    if (typeof id !== 'string') throw new Error('invalid source');
    const source = this.o.profile().proxy.sources.find(s => s.id === id);
    if (!source || source.origin.kind !== 'subscription') throw new Error('invalid source');
    this.validateSubscription(source.origin.url, source.origin.via);
    if (source.origin.via === 'proxy' && !this.open) throw new Error(t('core.subscriptionNeedsNode'));
    const nodes = extractProxies(await fetchSubscription(source.origin.url, source.origin.via, this.o.ports));
    await this.replaceSources(this.o.profile().proxy.sources.map(s => s.id === id ? { ...s, nodes, updatedAt: Date.now() } : s));
  });

  updateSourceContent = (id: string, text: string, kind: 'file' | 'text', filename?: string) => this.serial(async () => {
    if (typeof id !== 'string' || typeof text !== 'string' || text.length > 10_000_000 || (kind !== 'file' && kind !== 'text')) throw new Error('invalid source');
    const source = this.o.profile().proxy.sources.find(s => s.id === id);
    if (!source || source.origin.kind !== kind || (kind === 'file' && (typeof filename !== 'string' || !filename || filename.length > 256))) throw new Error('invalid source');
    const nodes = extractProxies(text);
    const origin: ProxySourceOrigin = kind === 'file' ? { kind: 'file', filename: filename! } : { kind: 'text' };
    await this.replaceSources(this.o.profile().proxy.sources.map(s => s.id === id ? { ...s, origin, nodes, updatedAt: Date.now() } : s));
  });

  renameSource = (id: string, name: string) => this.serial(async () => {
    if (typeof id !== 'string' || typeof name !== 'string' || !name.trim() || name.length > 256 || !this.o.profile().proxy.sources.some(s => s.id === id)) throw new Error('invalid source');
    await this.o.saveProxy({ sources: this.o.profile().proxy.sources.map(s => s.id === id ? { ...s, name: name.trim() } : s) });
    this.emit('change', this.view);
  });

  removeSource = (id: string) => this.serial(async () => {
    if (typeof id !== 'string' || !this.o.profile().proxy.sources.some(s => s.id === id)) throw new Error('invalid source');
    const next = removeSource(this.o.profile().proxy, id);
    await this.replaceSources(next.sources, next.selected);
  });

  async nodes() {
    const proxy = this.o.profile().proxy;
    const rows = proxy.sources.flatMap(source => source.nodes.map(node => ({ source: source.id, name: String(node.name), type: String(node.type), delay: this.delayOutcomes.get(coreNodeName(source.id, String(node.name))) ?? { status: 'untested' as const }, country: this.countries.get(coreNodeName(source.id, String(node.name))) ?? '' })));
    return { nodes: rows, selected: proxy.selected };
  }

  delays = () => this.serial(async () => {
    const names = (await this.proxies()).map(node => String(node.name));
    const results = await this.controller.delays(HEALTH_URL);
    for (const name of names) {
      const ms = results[name];
      const outcome: DelayOutcome = typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? { status: 'measured', ms } : { status: 'timeout' };
      this.delayOutcomes.set(name, outcome);
      if (outcome.status === 'timeout') this.countries.delete(name);
    }
    const selected = selectedCoreName(this.o.profile().proxy);
    if (selected && this.delayOutcomes.get(selected)?.status === 'timeout') await this.dispatch({ type: 'node-changed', hasNode: false });
    else this.emit('change', this.view);
  });

  private validateSubscription(url: string, via: SubscriptionVia): void {
    if (typeof url !== 'string' || url.length > 2048 || !URL.canParse(url) || !['http:', 'https:'].includes(new URL(url).protocol) || (via !== 'direct' && via !== 'proxy')) throw new Error(t('core.subscriptionUrl'));
  }

  private async replaceSources(sources: Profile['proxy']['sources'], selected = this.o.profile().proxy.selected): Promise<void> {
    await this.dispatch({ type: 'node-changed', hasNode: false });
    this.countries.clear();
    const before = new Map(sourceProxies(this.o.profile().proxy).map(node => [String(node.name), JSON.stringify(node)]));
    const next = { sources, selected };
    const after = new Map(sourceProxies(next).map(node => [String(node.name), JSON.stringify(node)]));
    for (const name of this.delayOutcomes.keys()) if (!after.has(name) || before.get(name) !== after.get(name)) this.delayOutcomes.delete(name);
    if (!selectedCoreName(next)) next.selected = null;
    await this.o.saveProxy(next);
    try { await this.writeAndReload(); } catch (error) { await this.core.stop(); throw error; }
    const current = selectedCoreName(this.o.profile().proxy);
    await this.dispatch({ type: 'node-changed', hasNode: !!current && this.delayOutcomes.get(current)?.status !== 'timeout' });
  }

  runtimeConfig = () => readFile(this.files.runtime, 'utf8').catch(() => '');

  // ---- internals ----

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async proxies(): Promise<Record<string, unknown>[]> {
    return sourceProxies(this.o.profile().proxy);
  }

  private async writeConfig(): Promise<void> {
    await writeFile(
      this.files.runtime,
      renderRuntimeConfig({
        ports: this.o.ports,
        secret: this.o.secret,
        open: isOpen(this.facts),
        proxies: await this.proxies(),
        selected: selectedCoreName(this.o.profile().proxy),
        allowPrivateNetwork: this.o.profile().allowPrivateNetwork,
        outboundInterface: this.outboundInterface,
      }),
    );
  }

  private async writeAndReload(): Promise<void> {
    await this.writeConfig();
    if (!this.core.running) return;
    await this.controller.reload(this.files.runtime);
  }

  private async dispatch(e: GateEvent): Promise<void> {
    const wasOpen = isOpen(this.facts);
    this.facts = reduceGate(this.facts, e);
    const nowOpen = isOpen(this.facts);
    if (nowOpen !== wasOpen) {
      try {
        await this.writeAndReload();
        if (!nowOpen) await this.dropConnections();
      } catch (err) {
        // If applying the gate is uncertain, stop forwarding instead of leaving old rules active.
        await this.core.stop();
        this.facts = reduceGate(this.facts, { type: 'core-down' });
        this.emit('change', this.view);
        throw err;
      }
    }
    this.emit('change', this.view);
    if (needsCheck(this.facts)) void this.serial(() => this.check());
  }

  private async dropConnections(): Promise<void> {
    await browserSession().closeAllConnections();
    if (this.core.running) await this.controller.closeConnections().catch(() => undefined);
  }

  private async boot(): Promise<void> {
    try {
      // Resolve again after a core restart; a stale interface must not select a host TUN.
      this.outboundInterface = await this.o.resolveOutboundInterface?.();
      await this.writeConfig();
      await this.core.start(this.controller);
    } catch (err: any) {
      this.emit('error', err.message);
      await this.dispatch({ type: 'core-down' });
      return;
    }
    this.backoff = 1000;
    await this.dispatch({ type: 'core-up', hasNode: !!selectedCoreName(this.o.profile().proxy) && this.delayOutcomes.get(selectedCoreName(this.o.profile().proxy))?.status !== 'timeout' });
  }

  private onCoreExit(): void {
    if (this.quitting || this.facts.paused) return;
    this.facts = reduceGate(this.facts, { type: 'core-down' });
    this.emit('change', this.view);
    void this.serial(async () => {
      await this.dropConnections();
      await new Promise((r) => setTimeout(r, this.backoff));
      this.backoff = Math.min(this.backoff * 2, 30_000);
      if (!this.core.running && !this.facts.paused && !this.quitting) await this.boot();
    });
  }


  private async check(): Promise<void> {
    if (!needsCheck(this.facts)) return;
    await this.dispatch({ type: 'check-started' });
    const generation = this.facts.generation;
    void this.probe().then((result) => this.serial(() => this.finishCheck(generation, result)));
  }

  /** Periodic verification that keeps the gate open while the egress still matches. */
  private reverify(): void {
    if (!this.open) return;
    const generation = this.facts.generation;
    void this.probe().then((result) => this.serial(() => this.finishCheck(generation, result)));
  }

  private async finishCheck(generation: number, result: CheckResult): Promise<void> {
    if (generation !== this.facts.generation || !this.core.running) return;
    if ('egress' in result && (result.egress.node !== selectedCoreName(this.o.profile().proxy) || await this.controller.selected().catch(() => '') !== result.egress.node)) result = { ok: false, kind: 'failed', error: 'Selected node changed' };
    if ('egress' in result) acceptExit(generation, this.facts.generation, result.egress, this.countries);
    await this.dispatch({ type: 'check-finished', generation, result, at: Date.now() });
  }

  /** One request, through the selected node, to read the egress country. */
  private async probe(): Promise<CheckResult> {
    try {
      const egress = await measureExit({
        selected: () => this.controller.selected(),
        createSession: () => freshProbeSession(this.o.ports),
        fetchTrace: ({ session }) => fetchText(session, TRACE_URL),
      });
      return egress.country === this.facts.country ? { ok: true, egress } : { ok: false, kind: 'mismatch', egress };
    } catch (err: any) {
      return { ok: false, kind: 'failed', error: err.message };
    }
  }
}
