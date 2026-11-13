// A local page that reports what pages see, without touching the network. It lives in its own
// session so that web tabs have no cave:// scheme at all (nothing for a site to detect). Used once
// at startup without overrides to read the engine's platform hints, and by the self-check with
// the same overrides and session UA as the tabs.
import { BrowserWindow, protocol, session, type Session } from 'electron';

export const PROBE_URL = 'cave://probe/';

const PAGE = `<!doctype html><meta charset="utf-8"><title>probe</title><script>
async function scope() {
  const n = self.navigator;
  const ua = n.userAgentData ? { brands: n.userAgentData.brands, platform: n.userAgentData.platform,
    high: await n.userAgentData.getHighEntropyValues(['architecture','bitness','platformVersion','wow64','fullVersionList']) } : null;
  return { userAgent: n.userAgent, platform: n.platform, languages: [...n.languages],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: Intl.DateTimeFormat().resolvedOptions().locale, ua };
}
async function webrtc() {
  const pc = new RTCPeerConnection({ iceServers: [] });
  pc.createDataChannel('probe');
  const out = [];
  pc.onicecandidate = (e) => e.candidate && e.candidate.candidate && out.push(e.candidate.candidate);
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise((r) => { pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && r(); setTimeout(r, 2500); });
  pc.close();
  return out;
}
const workerSrc = URL.createObjectURL(new Blob([scope.toString() + ';scope().then(postMessage)'], { type: 'text/javascript' }));
window.report = async () => ({
  main: await scope(),
  worker: await new Promise((r) => { const w = new Worker(workerSrc); w.onmessage = (e) => r(e.data); setTimeout(() => r(null), 3000); }),
  webrtc: await webrtc(),
  speechVoices: 'speechSynthesis' in window ? speechSynthesis.getVoices().length : null,
});
</script>`;

let probeSession: Session | null = null;
export function selfCheckSession(): Session {
  if (!probeSession) {
    probeSession = session.fromPartition('cave-selfcheck', { cache: false });
    probeSession.protocol.handle('cave', () => new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  }
  return probeSession;
}

/** Call before app ready. */
export function registerProbeScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: 'cave', privileges: { standard: true, secure: true } }]);
}

export interface ScopeReport {
  userAgent: string;
  platform: string;
  languages: string[];
  timezone: string;
  locale: string;
  ua: { brands: { brand: string; version: string }[]; platform: string; high: Record<string, any> } | null;
}
export interface ProbeReport { main: ScopeReport; worker: ScopeReport | null; webrtc: string[]; webrtcPolicy: string; speechVoices: number | null }

/** Loads the probe in a hidden window; `prepare` may attach overrides first. */
export async function runProbe(prepare?: (wc: Electron.WebContents) => void): Promise<ProbeReport> {
  const win = new BrowserWindow({ show: false, webPreferences: { session: selfCheckSession(), sandbox: true, contextIsolation: true } });
  try {
    prepare?.(win.webContents);
    await win.loadURL(PROBE_URL);
    const report = await win.webContents.executeJavaScript('window.report()');
    return { ...report, webrtcPolicy: win.webContents.getWebRTCIPHandlingPolicy() } as ProbeReport;
  } finally {
    win.destroy();
  }
}
