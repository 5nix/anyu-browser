// The shell UI's only bridge to the main process: the fixed list of calls and events in
// shared/ipc.ts, no generic fetch or IPC.
import { contextBridge, ipcRenderer } from 'electron';
import { CALLS, EVENTS, channel, type CaveCalls, type CaveEvents } from './shared/ipc.ts';

const api: Record<string, unknown> = {
  platform: process.env.CAVE_TEST_HARNESS === '1' && process.env.CAVE_TEST_WINDOWS_CHROME === '1' ? 'win32' : process.platform,
  on(event: keyof CaveEvents, listener: (data: unknown) => void) {
    if (!Object.hasOwn(EVENTS, event)) throw new Error(`no such event: ${event}`);
    ipcRenderer.on(channel(event), (_e, data) => listener(data));
  },
};
for (const name of Object.keys(CALLS) as (keyof CaveCalls)[]) api[name] = (...args: unknown[]) => ipcRenderer.invoke(channel(name), ...args);

contextBridge.exposeInMainWorld('cave', api);
