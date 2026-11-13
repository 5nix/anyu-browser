/** FIFO requests with identical pending requests sharing one decision. */
export class PermissionQueue<T extends { wc: object; key: string }, R = boolean> {
  private items: { value: T; callbacks: ((result: R) => void)[] }[] = [];
  get head(): T | null { return this.items[0]?.value ?? null; }
  enqueue(value: T, callback: (result: R) => void): boolean {
    const existing = this.items.find(item => item.value.wc === value.wc && item.value.key === value.key);
    if (existing) { existing.callbacks.push(callback); return false; }
    this.items.push({ value, callbacks: [callback] });
    return true;
  }
  finish(value: T, allow: R): void {
    const index = this.items.findIndex(item => item.value === value);
    if (index < 0) return;
    const [item] = this.items.splice(index, 1);
    for (const callback of item.callbacks) callback(allow);
  }
  removeTab(wc: object): void {
    for (const item of [...this.items]) if (item.value.wc === wc) this.finish(item.value, false as R);
  }
  clear(): void { for (const item of [...this.items]) this.finish(item.value, false as R); }
}
