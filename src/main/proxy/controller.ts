// The core's external controller, reachable only on 127.0.0.1 and only with the per-launch secret.
import { GROUP } from './config.ts';

export interface NodeInfo { name: string; type: string; delay: number | null }

export class Controller {
  constructor(private port: number, private secret: string) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`http://127.0.0.1:${this.port}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.secret}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`core ${method} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  version = () => this.call<{ version: string }>('GET', '/version');

  /** Hot-swaps the whole runtime config (how the gate opens and closes). */
  reload = (path: string) => this.call('PUT', '/configs?force=true', { path });

  closeConnections = () => this.call('DELETE', '/connections');

  select = (name: string) => this.call('PUT', `/proxies/${GROUP}`, { name });

  async selected(): Promise<string> {
    return (await this.call<{ now: string }>('GET', `/proxies/${GROUP}`)).now;
  }

  /** The given nodes (in the subscription's order) with what the core knows about them. */
  async nodes(names: string[]): Promise<NodeInfo[]> {
    const { proxies } = await this.call<{ proxies: Record<string, { type: string; history: { delay: number }[] }> }>('GET', '/proxies');
    return names.map((name) => ({ name, type: proxies[name]?.type ?? '', delay: proxies[name]?.history.at(-1)?.delay || null }));
  }

  /** Latency of every node, measured through each node by the core. */
  async delays(url: string): Promise<Record<string, number>> {
    return this.call<Record<string, number>>('GET', `/group/${GROUP}/delay?url=${encodeURIComponent(url)}&timeout=5000`).catch(() => ({}));
  }
}
