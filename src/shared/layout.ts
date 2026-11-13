// The window's geometry and frame colours, in one place. The main process places the page view
// with pageBounds() and the window buttons with trafficLights(); the chrome page turns METRICS
// into CSS variables (--strip, --tab, --toolbar, --button, --caption, --side, --gap, --lights)
// and draws around the same hole, so the two cannot drift apart.
import type { Rect, TabLayout } from './ipc.ts';

export const METRICS = {
  /** Tab strip height (top layout); on Windows/Linux the caption buttons share this band. */
  strip: 40,
  setupBand: 52,
  /** Tab height (top layout); tabs sit on the strip's bottom edge and join the toolbar below. */
  tab: 32,
  /** Toolbar height (top layout). */
  toolbar: 45,
  /** Round toolbar button (top layout). */
  button: 32,
  /** Windows/Linux caption-button band above the page card (side layout). */
  caption: 44,
  /** Navigation row height (side layout). */
  sideTop: 48,
  /** Sidebar width (side layout). */
  side: 256,
  /** Gap around the page card. */
  gap: 8,
  /** Corner radius of the page card. */
  radius: 10,
  /** macOS window buttons: 14px circles at a 23px pitch (measured on macOS 27). */
  light: 14,
  lightPitch: 23,
} as const;

/** Width of the three macOS window buttons, first edge to last edge. */
export const LIGHTS_WIDTH = METRICS.light + 2 * METRICS.lightPitch;

/** Height of the Windows/Linux caption-button band in this layout. */
export const captionHeight = (layout: TabLayout): number => layout === 'top' ? METRICS.strip : METRICS.caption;

/**
 * Top-left of the macOS close button. Top layout: the red light's centre is the back button's
 * centre (x) and the tab's centre (y). Side layout: centred in the navigation row.
 */
export function trafficLights(layout: TabLayout): { x: number; y: number } {
  const { gap, button, strip, tab, light, sideTop } = METRICS;
  return layout === 'top'
    ? { x: gap + button / 2 - light / 2, y: strip - tab / 2 - light / 2 }
    : { x: 14, y: (sideTop - light) / 2 };
}

export function sidebarWidth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(200, Math.min(420, Math.round(value))) : METRICS.side;
}

/** Window background and caption-button colour per theme; style.css repeats them as --frame and --text. */
export const FRAME = {
  light: { frame: '#e5e6e8', symbol: '#1b1c1e' },
  dark: { frame: '#121213', symbol: '#ececed' },
} as const;

/** Where the page (the active tab or the settings page) sits in a window of this content size. */
export function pageBounds(layout: TabLayout, width: number, height: number, mac: boolean, sidebar: number = METRICS.side): Rect {
  const { strip, toolbar, gap, caption } = METRICS;
  // Side layout: the page is a rounded card beside the sidebar; on Windows/Linux it starts
  // below the caption-button band.
  const box = layout === 'side' ? { left: sidebarWidth(sidebar), top: mac ? gap : caption, inset: gap } : { left: gap, top: strip + toolbar, inset: gap };
  return { x: box.left, y: box.top, width: Math.max(0, width - box.left - box.inset), height: Math.max(0, height - box.top - box.inset) };
}

/** Setup reserves the title band for native window controls and dragging. */
export function setupPageBounds(width: number, height: number): Rect {
  return { x: 0, y: METRICS.setupBand, width: Math.max(0, width), height: Math.max(0, height - METRICS.setupBand) };
}
