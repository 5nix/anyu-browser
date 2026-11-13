export function pinOrder<T extends { pinned: boolean }>(tabs: readonly T[], tab: T, pinned: boolean): T[] {
  const rest = tabs.filter(t => t !== tab);
  const boundary = rest.findIndex(t => !t.pinned);
  rest.splice(boundary < 0 ? rest.length : boundary, 0, tab);
  return rest;
}

export function moveOrder<T extends { pinned: boolean }>(tabs: readonly T[], tab: T, index: number): T[] {
  const rest = tabs.filter(t => t !== tab);
  const boundary = rest.findIndex(t => !t.pinned);
  const split = boundary < 0 ? rest.length : boundary;
  const position = tab.pinned ? Math.min(index, split) : Math.max(split, Math.min(index, rest.length));
  rest.splice(position, 0, tab);
  return rest;
}
