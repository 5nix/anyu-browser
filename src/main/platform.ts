// Window chrome and menu decisions live here; the overlay supplies its own live geometry to CSS.
import type { TabLayout } from '../shared/ipc.ts';
import { captionHeight, trafficLights } from '../shared/layout.ts';

export const mac = process.platform === 'darwin';
export const trafficLightPosition = (layout: TabLayout) => trafficLights(layout);

export function titleBar(frame: string, symbol: string, layout: TabLayout): Electron.BaseWindowConstructorOptions {
  return mac
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: trafficLightPosition(layout) }
    : { titleBarStyle: 'hidden', titleBarOverlay: { color: frame, symbolColor: symbol, height: captionHeight(layout) } };
}
