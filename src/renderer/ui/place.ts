import type { Rect } from '../../shared/ipc.ts';

type Size = { width: number; height: number };
type Side = 'bottom' | 'top' | 'right' | 'left' | 'bottom-right';

/** Prefer the requested side, then flip or move to a side with room. */
export function place(anchor: Rect, size: Size, viewport: Size, prefer: Side = 'bottom'): { x: number; y: number } {
  const margin = 8, gap = 4;
  const clamp = (n: number, max: number) => Math.max(margin, Math.min(n, Math.max(margin, max - margin)));
  if (prefer === 'bottom-right' && anchor.width === 0 && anchor.height === 0) {
    const x = anchor.x + size.width <= viewport.width ? anchor.x : anchor.x - size.width;
    const y = anchor.y + size.height <= viewport.height ? anchor.y : anchor.y - size.height;
    return { x: Math.max(0, Math.min(x, viewport.width - size.width)), y: Math.max(0, Math.min(y, viewport.height - size.height)) };
  }
  const candidates: Record<Side, { x: number; y: number }> = {
    'bottom-right': { x: anchor.x + anchor.width + gap, y: anchor.y + anchor.height + gap },
    bottom: { x: anchor.x + anchor.width - size.width, y: anchor.y + anchor.height + gap },
    top: { x: anchor.x + anchor.width - size.width, y: anchor.y - size.height - gap },
    right: { x: anchor.x + anchor.width + gap, y: anchor.y },
    left: { x: anchor.x - size.width - gap, y: anchor.y },
  };
  const opposite: Record<Side, Side> = { 'bottom-right': 'top', bottom: 'top', top: 'bottom', left: 'right', right: 'left' };
  const sides: Side[] = [prefer, opposite[prefer], ...(['bottom', 'top', 'right', 'left'] as Side[]).filter((s) => s !== prefer && s !== opposite[prefer])];
  for (const side of sides) {
    const p = candidates[side];
    const x = side === 'top' || side === 'bottom' || side === 'bottom-right' ? clamp(p.x, viewport.width - size.width) : p.x;
    const y = side === 'left' || side === 'right' ? clamp(p.y, viewport.height - size.height) : p.y;
    if (x >= margin && y >= margin && x + size.width <= viewport.width - margin && y + size.height <= viewport.height - margin) return { x, y };
  }
  const p = candidates[prefer];
  return { x: clamp(p.x, viewport.width - size.width), y: clamp(p.y, viewport.height - size.height) };
}
