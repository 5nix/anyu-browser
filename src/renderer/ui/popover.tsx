import type { ComponentChildren } from 'preact';
import type { Rect, SurfaceName } from '../../shared/ipc.ts';
import { Surface } from './index.tsx';

/** Positioned surface; the caller owns its visibility. */
export function Popover({ anchor, children, name = 'status', prefer, minX, open = true }: { anchor: Rect; children: ComponentChildren; name?: SurfaceName; prefer?: 'bottom' | 'bottom-right' | 'top'; minX?: number; open?: boolean }) {
  return <Surface name={name} anchor={anchor} prefer={prefer} minX={minX} open={open}>{children}</Surface>;
}
