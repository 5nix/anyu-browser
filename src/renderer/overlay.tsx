import type * as preact from 'preact';
import { t } from '../shared/i18n/index.ts';
import { render } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { AddressQueryResult, ShellState, SurfaceName } from '../shared/ipc.ts';
import { cave } from './bridge.ts';
import { status } from './gate.ts';
import { gateReason } from '../shared/gate-conditions.ts';
import { clockTime, useMinute } from './clock.ts';
import { ConditionList, gateStatus } from './gate-status.tsx';
import { SiteInfo } from './surfaces/site-info.tsx';
import { BookmarkEdit } from './surfaces/bookmark-edit.tsx';
import { Downloads } from './surfaces/downloads.tsx';
import { Suggestions } from './surfaces/suggestions.tsx';
import { HttpAuthPrompt } from './surfaces/http-auth.tsx';
import { PermissionPrompt } from './surfaces/permission.tsx';
import { Profiles } from './surfaces/profiles.tsx';
import { ContextMenu } from './surfaces/context-menu.tsx';
import { Icon, Surface, useCave, setSurfaceViewport } from './ui/index.tsx';

function Status({ state, open }: { state: ShellState; open: boolean }) {
  // Pausing stops the core on purpose, and the gate view keeps no node; the selected node is in the profile.
  const [facts, setFacts] = useState<{ selectedNode?: string; country?: string }>({});
  const [busy, setBusy] = useState(false);
  const now = useMinute();
  useEffect(() => { let live = true; cave.panelData().then(d => { if (live) setFacts({ selectedNode: d.profile.proxy.selected?.node || undefined, country: d.profile.egressCountry }); }, () => {}); return () => { live = false; }; }, [state.gate.state, state.gate.paused, state.gate.egress?.node]);
  const { st, rows, title } = gateStatus(state, facts);
  const reason = gateReason(state.gate);
  const failed = reason === 'checkFailed' || reason === 'mismatch';
  const phase = st === 'checking' ? 'checking' : st === 'open' ? 'open' : failed ? 'failed' : 'unchecked';
  const cardRows = rows.map(row => row.id === 'node' && st !== 'open' ? { ...row, condition: 'unknown' as const } : row.id === 'exit' && st === 'checking' ? { ...row, condition: 'running' as const } : row.id === 'exit' && failed && !state.gate.egress ? { ...row, value: t('statusCard.failed'), condition: 'failed' as const } : row);
  const toggle = () => { setBusy(true); void (st === 'paused' ? cave.resume() : cave.pause()).finally(() => setBusy(false)); };
  return <Surface name="status" anchor={state.surface!.anchor} open={open} prefer={state.tabLayout === 'side' ? 'top' : 'bottom'}>
    <div class={`status-heading ${phase}`}>
      <span class="overview-badge"><Icon name={st === 'checking' ? 'loader-circle' : st === 'open' ? 'lock-open' : 'lock'} className={st === 'checking' ? 'spin' : undefined} /></span>
      <div class="label"><b id="title">{st === 'closed' ? t('statusCard.blocked') : title}</b><div class="status-reason" id="detail"><span>{state.gate.reason}</span>{st !== 'open' && st !== 'paused' && <button id="restart" class="btn primary" disabled={st === 'checking'} onClick={() => cave.restartAndCheck()}><Icon name={st === 'checking' ? 'loader-circle' : 'refresh-cw'} className={st === 'checking' ? 'spin' : undefined} />{t(st === 'checking' ? 'statusCard.checking' : failed ? 'statusCard.recheck' : 'welcome.checkExit')}</button>}</div></div>
    </div>
    <ConditionList st={st} rows={cardRows} switchControl={{ busy, toggle }} />
    <div class="status-clock"><span>{clockTime(now, state.locale, state.timezone, state.clock24Hour, true)}</span><span>{state.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}</span></div>
    <p id="notice" hidden={!state.notice} title={state.notice ?? ''}>{state.notice ?? ''}</p>
    <div class="status-actions"><button class="btn" onClick={() => cave.openSettings('nodes')}><Icon name="swap" />{t('set.conditions.changeNode')}</button><button id="open-settings" class="btn" onClick={() => cave.openSettings('overview')}><Icon name="sliders" />{t('openSettings')}</button></div>
  </Surface>;
}

function RestoreSession({ state, open }: { state: ShellState; open: boolean }) {
  return <Surface name="restoreSession" anchor={state.surface!.anchor} placement="center" open={open}>
    <h2>{t('session_offer')}</h2>
    <div class="actions"><button class="btn" onClick={() => cave.discardSession()}>{t('session_discard')}</button><button class="btn primary" onClick={() => cave.restoreSession()}>{t('session_restore')}</button></div>
  </Surface>;
}

const surfaces: Record<SurfaceName, (props: { state: ShellState; open: boolean }) => preact.ComponentChildren> = { siteInfo: SiteInfo, bookmarkEdit: BookmarkEdit, downloads: Downloads, status: Status, profiles: Profiles, menu: ContextMenu, contextMenu: ContextMenu, suggestions: Suggestions, permission: PermissionPrompt, httpAuth: HttpAuthPrompt, restoreSession: RestoreSession };
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
