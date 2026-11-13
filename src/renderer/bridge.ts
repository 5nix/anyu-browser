// The typed handle every shell page uses to reach the main process (see shared/ipc.ts).
import type { CaveApi } from '../shared/ipc.ts';

export const cave = (globalThis as unknown as { cave: CaveApi }).cave;

// All shell-owned documents import this bridge and receive the shared appearance.
const applyAccent = (state: import('../shared/ipc.ts').ShellState) => { document.documentElement.dataset.accent = state.accent; };
cave.on('state', applyAccent);
void cave.getState().then(applyAccent);
