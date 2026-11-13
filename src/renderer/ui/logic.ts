/** Find the next enabled entry, wrapping around. Returns -1 when none are enabled. */
export function nextEnabled(disabled: readonly boolean[], current: number, step: 1 | -1): number {
  for (let n = 1; n <= disabled.length; n++) {
    const index = ((current + step * n) % disabled.length + disabled.length) % disabled.length;
    if (!disabled[index]) return index;
  }
  return -1;
}

export function typeAhead(labels: readonly string[], disabled: readonly boolean[], query: string, current: number): number {
  if (!query) return -1;
  const term = query.toLocaleLowerCase();
  for (let n = 1; n <= labels.length; n++) {
    const index = (Math.max(-1, current) + n) % labels.length;
    if (!disabled[index] && labels[index].toLocaleLowerCase().startsWith(term)) return index;
  }
  return -1;
}
