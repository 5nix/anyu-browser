export const ZOOM_STEPS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300] as const;

export function isZoom(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && (ZOOM_STEPS as readonly number[]).includes(value);
}

export function zoomStep(value: number, direction: 1 | -1): number {
  if (!isZoom(value)) return 100;
  const index = ZOOM_STEPS.indexOf(value as typeof ZOOM_STEPS[number]);
  return ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, index + direction))];
}

export function zoomOrigin(url: string): string | null {
  try { const parsed = new URL(url); return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin !== 'null' ? parsed.origin : null; }
  catch { return null; }
}
