import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Rect, ShellState, SurfaceName } from '../../shared/ipc.ts';
import { setLocale } from '../../shared/i18n/index.ts';
import { cave } from '../bridge.ts';
import { icon } from '../icons.ts';
export { List } from './list.tsx';
import { place } from './place.ts';

export function useCave(): ShellState | null {
  const [state, setState] = useState<ShellState | null>(null);
  useLayoutEffect(() => { const receive = (s: ShellState) => { setLocale(s.locale); document.documentElement.lang = s.locale === 'zh' ? 'zh-CN' : 'en'; setState(s); }; cave.on('state', receive); void cave.getState().then(receive); }, []);
  return state;
}

export function Icon({ name, className }: { name: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => { const svg = icon(name); if (className) svg.classList.add(className); ref.current?.replaceChildren(svg); }, [name, className]);
  return <span ref={ref} style="display:contents" />;
}

let surfaceViewport = { width: 0, height: 0 };
let surfaceGeneration = 0;
export function setSurfaceViewport(viewport?: { width: number; height: number }, generation = 0): void { if (viewport) surfaceViewport = viewport; surfaceGeneration = generation; }

export function Surface({ name, anchor, prefer = 'bottom', minX = 0, open = true, placement = 'anchor', label, session, measureKey, children }: { name: SurfaceName; anchor: Rect; prefer?: 'bottom' | 'bottom-right' | 'top'; minX?: number; open?: boolean; placement?: 'anchor' | 'center'; label?: string; session?: string; measureKey?: number; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(placement === 'center');
  useLayoutEffect(() => {
    const el = ref.current!;
    let live = true;
    const generation = surfaceGeneration;
    const apply = (session: string, sequence: number, bounds: Rect) => { void cave.setSurfaceBounds(session, sequence, bounds, generation).then(applied => { if (live && applied) setReady(true); }); };
    const update = () => {
      if (placement === 'center') { el.style.left = `${Math.max(8, (innerWidth - el.offsetWidth) / 2)}px`; el.style.top = `${Math.max(40, (innerHeight - el.offsetHeight) / 2)}px`; return; }
      if (name === 'suggestions') { el.style.width = `${anchor.width}px`; el.style.left = '0px'; el.style.top = '0px'; if (session && measureKey !== undefined) apply(session, measureKey, { x: anchor.x, y: anchor.y + anchor.height + 4, width: anchor.width, height: el.offsetHeight }); return; }
      const viewport = surfaceViewport;
      el.style.maxHeight = prefer === 'top' ? `${Math.max(0, anchor.y - 44)}px` : '';
      const p = place(anchor, { width: el.offsetWidth, height: el.offsetHeight }, viewport, prefer);
      const x = Math.min(Math.max(p.x, minX), Math.max(0, viewport.width - el.offsetWidth));
      const y = p.y;
      // The overlay view is exactly the card: nothing outside the card can take a press.
      el.style.left = '0px'; el.style.top = '0px';
      if (open) apply(name, -1, { x, y, width: el.offsetWidth, height: el.offsetHeight });
    };
    update();
    const observer = new ResizeObserver(update); observer.observe(el);
    addEventListener('resize', update);
    return () => { live = false; observer.disconnect(); removeEventListener('resize', update); };
  }, [anchor, prefer, minX, session, measureKey, placement, open]);
  return <div ref={ref} id={name} class={`surface ${placement === 'center' ? 'modal' : 'card'}${open && ready ? ' in' : ''}`} data-surface={name} role={label ? undefined : "dialog"} aria-modal={placement === 'center' ? true : undefined} aria-label={label} aria-labelledby={label ? undefined : "title"}>{children}</div>;
}
