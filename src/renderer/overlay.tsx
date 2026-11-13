import type * as preact from 'preact';
import { t } from '../shared/i18n/index.ts';
import { render } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { AddressQueryResult, ShellState, SurfaceName } from '../shared/ipc.ts';
import { cave } from './bridge.ts';
import { status } from './gate.ts';
import { ConditionList, GateSummary, gateStatus } from './gate-status.tsx';
import { SiteInfo } from './surfaces/site-info.tsx';
import { BookmarkEdit } from './surfaces/bookmark-edit.tsx';
import { Downloads } from './surfaces/downloads.tsx';
import { Suggestions } from './surfaces/suggestions.tsx';
import { HttpAuthPrompt } from './surfaces/http-auth.tsx';
import { PermissionPrompt } from './surfaces/permission.tsx';
import { ContextMenu } from './surfaces/context-menu.tsx';
import { Surface, useCave, setSurfaceViewport } from './ui/index.tsx';

function Status({ state, open }: { state: ShellState; open: boolean }) {
  // Pausing stops the core on purpose, and the gate view keeps no node; the selected node is in the profile.
  const [facts, setFacts] = useState<{ selectedNode?: string; country?: string }>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; cave.panelData().then(d => { if (live) setFacts({ selectedNode: d.profile.proxy.selected?.node || undefined, country: d.profile.egressCountry }); }, () => {}); return () => { live = false; }; }, [state.gate.state, state.gate.paused, state.gate.egress?.node]);
  const { st, e, conditions, rows, title } = gateStatus(state, facts);
  const toggle = () => { setBusy(true); void (st === 'paused' ? cave.resume() : cave.pause()).finally(() => setBusy(false)); };
  // When the gate is closed the first action is the fix; it replaces "open settings" when that is the fix.
  const fix = st === 'closed' ? (e || conditions.node === 'failed' ? 'nodes' : 'overview') : null;
  return <Surface name="status" anchor={state.surface!.anchor} open={open} prefer={state.tabLayout === 'side' ? 'top' : 'bottom'}>
    <GateSummary st={st} title={title} reason={state.gate.reason} titleId="title" reasonId="detail" busy={busy} onToggle={toggle} />
    <ConditionList st={st} rows={rows} />
    <p id="notice" hidden={!state.notice} title={state.notice ?? ''}>{state.notice ?? ''}</p>
    <div class="status-actions">
      {fix === 'nodes' && <button class="btn primary" onClick={() => cave.openSettings('nodes')}>{t('set.conditions.changeNode')}</button>}
      {fix === 'overview' && <button id="open-settings" class="btn primary" onClick={() => cave.openSettings('overview')}>{t('openSettings')}</button>}
      {st !== 'paused' && <button id="restart" onClick={() => cave.restartAndCheck()} disabled={st === 'checking'}>{t('set.overview.recheck')}</button>}
      {fix !== 'overview' && <button id="open-settings" onClick={() => cave.openSettings('overview')}>{t('openSettings')}</button>}
    </div>
  </Surface>;
}

function RestoreSession({ state, open }: { state: ShellState; open: boolean }) {
  return <Surface name="restoreSession" anchor={state.surface!.anchor} placement="center" open={open}>
    <h2>{t('session_offer')}</h2>
    <div class="actions"><button class="btn" onClick={() => cave.discardSession()}>{t('session_discard')}</button><button class="btn primary" onClick={() => cave.restoreSession()}>{t('session_restore')}</button></div>
  </Surface>;
}

const surfaces: Record<SurfaceName, (props: { state: ShellState; open: boolean }) => preact.ComponentChildren> = { siteInfo: SiteInfo, bookmarkEdit: BookmarkEdit, downloads: Downloads, status: Status, menu: ContextMenu, contextMenu: ContextMenu, suggestions: Suggestions, permission: PermissionPrompt, httpAuth: HttpAuthPrompt, restoreSession: RestoreSession };
function App() {
  const state = useCave();
  const [results, setResults] = useState<(AddressQueryResult & { active: number }) | null>(null);
  useLayoutEffect(() => { cave.on('addressResults', r => setResults(previous => previous?.session === r.session && previous.sequence > r.sequence ? previous : r)); }, []);
  const last = useRef<ShellState | null>(null);
  const current = useRef(state);
  current.current = state;
  if (state?.surface) last.current = state;
  useEffect(() => {
    const pointer = (e: MouseEvent) => { if (['permission', 'httpAuth', 'restoreSession'].includes(current.current?.surface?.name ?? '') && !(e.target as Element).closest('[data-surface]')) void cave.closeSurface(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && current.current?.surface?.name !== 'suggestions') void cave.closeSurface(); };
    document.addEventListener('click', pointer); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('click', pointer); document.removeEventListener('keydown', key); };
  }, []);
  if (!state) return null;
  document.body.className = status(state.gate);
  const viewport = (state.surface ?? last.current?.surface)?.viewport;
  setSurfaceViewport(viewport, (state.surface ?? last.current?.surface)?.generation);
  if (viewport) { document.documentElement.style.setProperty('--window-width', `${viewport.width}px`); document.documentElement.style.setProperty('--window-height', `${viewport.height}px`); }
  const displayed = state.surface ? state : last.current;
  const Component = displayed?.surface && surfaces[displayed.surface.name];
  return Component && displayed ? displayed.surface?.name === 'suggestions' ? <Suggestions key={`${displayed.surface?.generation}:${displayed.address?.session}`} state={displayed} open={!!state.surface} result={results} /> : <Component key={displayed.surface?.generation} state={displayed} open={!!state.surface} /> : null;
}
render(<App />, document.getElementById('app')!);
