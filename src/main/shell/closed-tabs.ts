export type ClosedTab = { url: string; title: string; pinned: boolean; position: number };

export class ClosedTabs {
  private items: ClosedTab[] = [];
  get available(): boolean { return this.items.length > 0; }
  push(tab: ClosedTab): void { this.items.push(tab); if (this.items.length > 25) this.items.shift(); }
  pop(): ClosedTab | undefined { return this.items.pop(); }
  clear(): void { this.items = []; }
}
