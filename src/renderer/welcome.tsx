// First-run setup. The screen follows the step the main process derives from the profile and the
// gate (state.setup.step); this page only remembers what is not saved yet: drafts, and an earlier
// screen the user went back to. It fetches nothing itself.
import { render } from 'preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Theme } from '../shared/appearance.ts';
import { t } from '../shared/i18n/index.ts';
import { coreEn } from '../shared/i18n/core.en.ts';
import { coreZh } from '../shared/i18n/core.zh.ts';
import type { PanelData, SearchEngine, ShellState, TabLayout } from '../shared/ipc.ts';
import { COUNTRIES, identityPatch, proposeIdentity, type LanguageChoice, type LocationChoice } from '../shared/identity.ts';
import { EXIT_CHECK_TIMEOUT_S, PHASES, phaseOf, phasesDone, stepIndex, verifyPhase, visibleStep, type SetupStep, type VerifyPhase } from '../shared/welcome.ts';
import { isLoopbackHost } from '../main/external-proxy.ts';
import { cave } from './bridge.ts';
import { ConditionList, regionName, type GateRow } from './gate-status.tsx';
import { ExternalCredentials, ExternalEndpoint, NodeList, ThemePicker, type ExternalDraft, type NodeRow } from './proxy-controls.tsx';
import { Icon, useCave } from './ui/index.tsx';

type Screen = 'welcome' | 'path' | 'source' | 'port' | 'node' | 'verify' | 'identity' | 'personalise' | 'done';
type SourceTab = 'url' | 'file' | 'paste';
type FetchState = { status: 'idle' } | { status: 'loading'; started: number } | { status: 'error'; kind: 'status' | 'empty' | 'other'; code?: string; message: string; tab: SourceTab };
type Measure = { key: string; status: 'measuring' | 'done' | 'failed'; country: string; colo: string };

const message = (err: unknown) => String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');
const hostOf = (url: string) => { try { return new URL(url).host || url; } catch { return url; } };
const EMPTY = [coreZh, coreEn].flatMap(c => [c['core.noProxies'], c['core.noUsableProxies'], c['core.invalidYaml'].split('{')[0]]);

function Mark({ size }: { size: number }) {
  return <svg class="mark" width={size} height={size} viewBox="179.36 173.36 665.28 665.28" aria-hidden="true"><path d="M228 540C332 560 430 430 512 296C594 430 692 560 796 540Q822 560 796 590C692 614 590 530 512 470C434 530 332 614 228 590Q202 560 228 540Z" fill="currentColor" /><path d="M438 642a74 74 0 1 0 148 0a74 74 0 1 0 -148 0Z" fill="currentColor" /></svg>;
}

/** What failed and the one next step, as on the settings page's condition-fix panel. */
function Fix({ kind, icon, title, detail, children }: { kind: 'bad' | 'warn' | 'good'; icon: string; title: string; detail?: string; children?: ComponentChildren }) {
  return <div class={`fix ${kind}`} role={kind === 'good' ? 'status' : 'alert'}><div class="msg"><Icon name={icon} /><span><b>{title}</b>{detail}</span></div>{children && <div class="acts">{children}</div>}</div>;
}

function Seg<T extends string>({ name, label, value, options, onChange }: { name: string; label: string; value: T; options: [T, string, string?][]; onChange: (v: T) => void }) {
  return <div class="seg" role="radiogroup" aria-label={label}>{options.map(([v, text, icon]) => <label><input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} /><span>{icon && <Icon name={icon} />}{text}</span></label>)}</div>;
}

function Stepper({ step, done }: { step: Screen; done: boolean[] }) {
  const phase = Math.min(phaseOf(step === 'path' || step === 'source' || step === 'port' ? 'connect' : step as SetupStep), 5);
  const labels = PHASES.map(p => t(`welcome.phase.${p}`));
  return <>
    <ol class="steps" aria-label={t('welcome.steps')}>{labels.map((label, i) => { const cur = i === phase; return <li class={cur ? 'cur' : done[i] ? 'done' : ''} aria-current={cur ? 'step' : undefined}><span class="n">{!cur && done[i] ? <Icon name="check" /> : i + 1}</span>{label}</li>; })}</ol>
    <div class="steps-compact">{phase < 5 && t('welcome.stepOf', { n: phase + 1 })}<b>{phase < 5 ? labels[phase] : t('welcome.complete')}</b></div>
  </>;
}

function Welcome() {
  const state = useCave();
  const [data, setData] = useState<PanelData | null>(null);
  const refresh = () => cave.panelData().then(setData, () => {});
  useEffect(() => { if (state) void refresh(); }, [state]);
  const run = useRef(0);
  const prevStep = useRef<SetupStep | null>(null);
  const step = state?.setup.step ?? null;
  if (step && step !== 'normal' && prevStep.current === 'normal') run.current++;
  if (step) prevStep.current = step;
  if (!state || !data) return null;
  return <Setup key={run.current} state={state} data={data} refresh={refresh} />;
}

function Setup({ state, data, refresh }: { state: ShellState; data: PanelData; refresh: () => Promise<void> }) {
  const profile = data.profile;
  const gate = state.gate;
  const derived = state.setup.step;
  const external = profile.connectionMode === 'external';

  // ---- where the user is: the derived step, or an earlier one they went back to ----
  const held = useRef<SetupStep | null>(null);
  const shown = useRef<SetupStep | null>(null);
  const lastDerived = useRef<SetupStep>(derived);
  const [, redraw] = useState(0);
  const hold = (step: SetupStep | null) => { held.current = step; redraw(n => n + 1); };
  if (derived !== 'normal') {
    if (held.current && stepIndex(held.current) >= stepIndex(derived)) held.current = null;
    // A check that passes while it is on screen stays there until the user moves on.
    const passed = stepIndex(lastDerived.current) <= stepIndex('verify') && stepIndex(derived) > stepIndex('verify');
    if (!held.current && shown.current === 'verify' && passed) held.current = 'verify';
  }
  lastDerived.current = derived;
  const step = derived === 'normal' ? shown.current ?? 'welcome' : visibleStep(derived, held.current);
  shown.current = step;

  // ---- drafts: only in this page until the user commits them ----
  const [connect, setConnect] = useState<'path' | 'source' | 'port'>('path');
  const [path, setPath] = useState<'source' | 'external'>(external ? 'external' : 'source');
  const [tab, setTab] = useState<SourceTab>('url');
  const [url, setUrl] = useState('');
  const [paste, setPaste] = useState('');
  const [fetching, setFetching] = useState<FetchState>({ status: 'idle' });
  const [ext, setExt] = useState<ExternalDraft>(() => ({ ...profile.externalProxy, port: profile.externalProxy.port ? String(profile.externalProxy.port) : '' }));
  const [focusSource, setFocusSource] = useState<string | null>(null);
  const [country, setCountry] = useState(profile.egressCountry);
  const [measure, setMeasure] = useState<Measure | null>(null);
  const [identityExit, setIdentityExit] = useState<{ country: string; colo: string } | null>(null);
  const [zone, setZone] = useState<string | null>(null);
  const [languages, setLanguages] = useState<LanguageChoice | null>(null);
  const [location, setLocation] = useState<LocationChoice | null>(null);
  const [theme, setTheme] = useState<Theme>(state.theme);
  const [tabs, setTabs] = useState<TabLayout>(state.tabLayout);
  const [search, setSearch] = useState<SearchEngine>(state.searchEngine);
  const [bookmarks, setBookmarks] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [checkStarted, setCheckStarted] = useState<number | null>(null);
  const [portOpen, setPortOpen] = useState<{ reason: string; open: boolean } | null>(null);

  useEffect(() => {
    if (step !== 'welcome') return;
    setPath(external ? 'external' : 'source');
    setCountry(profile.egressCountry);
    setExt({ ...profile.externalProxy, port: profile.externalProxy.port ? String(profile.externalProxy.port) : '' });
    setTheme(state.theme);
    setTabs(state.tabLayout);
    setSearch(state.searchEngine);
  }, [step, external, profile, state.theme, state.tabLayout, state.searchEngine]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setNotice(null);
    try { await fn(); } catch (err) { setNotice(message(err)); } finally { setBusy(null); await refresh(); }
  };

  // ---- the selected source and node ----
  const sources = profile.proxy.sources;
  const selected = data.nodes.selected;
  const source = sources.find(s => s.id === focusSource) ?? sources.find(s => s.id === profile.proxy.selected?.source) ?? sources[sources.length - 1];
  const rows = data.nodes.nodes.filter(n => n.source === source?.id);
  const isSelected = (n: NodeRow) => !external && n.source === selected?.source && n.name === selected?.node;
  const extAddr = `${profile.externalProxy.host}:${profile.externalProxy.port || '—'}`;
  const nodeKey = external ? (profile.externalProxy.port ? `external\n${extAddr}` : '') : selected ? `${selected.source}\n${selected.node}` : '';

  // A node in use gets its exit measured (the gate stays as it is) to fill in the country. Once a
  // country is set the gate checks every node itself, so a second measurement would only race it.
  const measured = useRef('');
  useEffect(() => {
    if (step !== 'node' || !nodeKey || measured.current === nodeKey || profile.egressCountry) return;
    measured.current = nodeKey;
    const key = nodeKey;
    setMeasure({ key, status: 'measuring', country: '', colo: '' });
    cave.measureExit().then(r => {
      setMeasure(m => m?.key === key ? { key, status: 'done', ...r } : m);
      if (measured.current === key) setCountry(r.country);
    }, () => setMeasure(m => m?.key === key ? { ...m, status: 'failed' } : m));
  }, [step, nodeKey, profile.egressCountry]);

  // The check's own clock, from the moment the gate reports it running.
  const phase0 = verifyPhase(gate);
  useEffect(() => { if (phase0 === 'running') setCheckStarted(s => s ?? Date.now()); else setCheckStarted(null); }, [phase0]);
  useEffect(() => {
    if (fetching.status !== 'loading' && phase0 !== 'running' && measure?.status !== 'measuring') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [fetching.status, phase0, measure?.status]);
  // In external mode a failed check may mean nothing listens on the port: ask, once per failure.
  useEffect(() => {
    if (!external || (phase0 !== 'failed' && phase0 !== 'timeout') || portOpen?.reason === gate.reason) return;
    const reason = gate.reason;
    void cave.localPortOpen().then(open => setPortOpen({ reason, open }), () => {});
  }, [external, phase0, gate.reason]);
  const phase: VerifyPhase | 'port' = external && (phase0 === 'failed' || phase0 === 'timeout') && portOpen?.reason === gate.reason && !portOpen.open ? 'port' : phase0;

  // Identity follows the verified exit; the site's city is measured once for it.
  const exitCountry = gate.state === 'open' && gate.egress ? gate.egress.country : profile.egressCountry;
  useEffect(() => {
    if (step !== 'identity' || gate.state !== 'open' || identityExit?.country === exitCountry) return;
    void cave.measureExit().then(setIdentityExit, () => setIdentityExit({ country: exitCountry, colo: '' }));
  }, [step, gate.state, exitCountry]);
  const proposal = useMemo(() => proposeIdentity(exitCountry, identityExit?.country === exitCountry ? identityExit.colo : ''), [exitCountry, identityExit]);

  // Each new screen puts the keyboard on its title.
  const title = useRef<HTMLHeadingElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const screen: Screen = step === 'connect' ? connect : step as Screen;
  useEffect(() => { title.current?.focus(); }, [screen]);

  const country$ = (code: string) => regionName(state.locale, code);
  const countries = useMemo(() => {
    const list = [...new Set([...COUNTRIES, ...[country, measure?.country ?? ''].filter(c => /^[A-Z]{2}$/.test(c))])];
    return list.map(code => [code, country$(code)] as const).sort((a, b) => a[1].localeCompare(b[1], state.locale));
  }, [state.locale, country, measure?.country]);

  // ---- actions ----
  const later = () => act('later', () => cave.setSetup({ dismissed: true }));
  const start = () => act('start', async () => { if (!profile.setup.started) await cave.setSetup({ started: true }); setConnect('path'); hold('connect'); });
  const keepSource = () => act('keep-source', async () => {
    if (external) await cave.updateProfile({ connectionMode: 'system' });
    if (!selected) {
      const targetSource = source ?? sources[0];
      const first = targetSource?.nodes[0];
      if (targetSource && first) await cave.selectNode(targetSource.id, String(first.name));
    }
    hold('node');
  });
  const importSource = () => {
    const before = new Set(sources.map(s => s.id));
    const run = tab === 'url' ? () => cave.addSubscription(url.trim(), 'direct') : tab === 'paste' ? () => cave.importSubscriptionText(paste) : () => cave.importSubscriptionFile();
    setNotice(null);
    setFetching(tab === 'url' ? { status: 'loading', started: Date.now() } : { status: 'idle' });
    setBusy('import');
    void run().then(async (picked) => {
      if (picked === false) { setFetching({ status: 'idle' }); return; }
      const next = await cave.panelData();
      const added = next.profile.proxy.sources.find(s => !before.has(s.id));
      setFetching({ status: 'idle' });
      if (!added) return;
      setFocusSource(added.id);
      if (next.profile.connectionMode === 'external') await cave.updateProfile({ connectionMode: 'system' });
      const first = added.nodes[0];
      if (first) await cave.selectNode(added.id, String(first.name));
      hold('node');
    }, (err) => {
      const text = message(err), code = /HTTP (\d{3})/.exec(text)?.[1];
      setFetching({ status: 'error', kind: code ? 'status' : EMPTY.some(e => text.startsWith(e)) ? 'empty' : 'other', code, message: text, tab });
    }).finally(() => { setBusy(null); void refresh(); });
  };
  const savePort = () => act('port', async () => {
    await cave.updateProfile({ connectionMode: 'external', externalProxy: { protocol: ext.protocol === 'http' ? 'http' : 'socks5', host: ext.host.trim(), port: Number(ext.port), username: ext.username, password: ext.password } });
    hold('node');
  });
  const selectNode = (n: NodeRow) => { if (!isSelected(n)) void act('select', () => cave.selectNode(n.source, n.name)); };
  const checkExit = () => act('check', async () => {
    // The same country again after a failed check means: check again.
    if (country !== profile.egressCountry) await cave.updateProfile({ egressCountry: country });
    else if (gate.state === 'closed') await cave.restartAndCheck();
    // The check is shown, also when it already passed while the user was choosing.
    hold('verify');
  });
  const retry = () => act('retry', () => cave.restartAndCheck());
  const useIdentity = () => act('identity', async () => {
    await cave.updateProfile(identityPatch(proposal, { timezone: zone ?? proposal.timezone, languages: languages ?? (proposal.languages.length ? 'exit' : 'keep'), location: location ?? (proposal.city ? 'city' : 'deny') }, profile));
    await cave.setSetup({ identityHandled: true });
    hold(null);
  });
  const keepIdentity = () => act('identity', async () => { await cave.setSetup({ identityHandled: true }); hold(null); });
  const finishPersonalise = (apply: boolean) => act('personalise', async () => {
    if (apply) {
      if (theme !== state.theme) await cave.setTheme(theme);
      if (tabs !== state.tabLayout) await cave.setTabLayout(tabs);
      if (JSON.stringify(search) !== JSON.stringify(state.searchEngine) && !await cave.setSearchEngine(search)) throw new Error(t('set.search.failed'));
    }
    await cave.setSetup({ personaliseHandled: true });
    hold(null);
  });
  const importBookmarks = () => act('bookmarks', async () => { const r = await cave.importBookmarks(); if (r.added || r.skipped) setBookmarks(r.added); });
  const startBrowsing = () => act('finish', async () => { await cave.setSetup({ finished: true }); if (data.restartNeeded) await cave.restart(); });
  const back = () => {
    setNotice(null);
    switch (screen) {
      case 'path': hold('welcome'); break;
      case 'source': case 'port': setConnect('path'); break;
      case 'node': setConnect(external ? 'port' : 'source'); hold('connect'); break;
      case 'verify': if (phase === 'running' || phase === 'starting') void act('stop', () => cave.updateProfile({ egressCountry: '' })); else hold('node'); break;
      case 'identity': hold('node'); break;
      case 'personalise': hold('identity'); break;
      case 'done': hold('personalise'); break;
    }
  };

  // ---- screens ----
  const secs = (from: number | null) => Math.max(0, Math.floor((now - (from ?? now)) / 1000));
  let heading = '', body: ComponentChildren = null, primaryButton: ComponentChildren = null, secondary: ComponentChildren = null, backLabel = t('welcome.back'), center = false;
  const P = (label: string, onClick: () => void, enabled = true, id?: string) => <button ref={primary} id={id} class="btn primary" disabled={!enabled || busy !== null} onClick={onClick}>{label}</button>;

  switch (screen) {
    case 'path':
      heading = t('welcome.path.title');
      body = <div class="stack" role="radiogroup" aria-label={t('welcome.path.label')}>
        <label class="choice"><input type="radio" name="path" value="source" checked={path === 'source'} onChange={() => setPath('source')} /><span class="ci"><Icon name="rss" /></span><span class="lb"><b>{t('welcome.path.source')}</b></span></label>
        <label class="choice"><input type="radio" name="path" value="external" checked={path === 'external'} onChange={() => setPath('external')} /><span class="ci"><Icon name="plug" /></span><span class="lb"><b>{t('welcome.path.external')}</b><small>{t('welcome.path.externalHint')}</small></span></label>
      </div>;
      primaryButton = P(t('welcome.next'), () => setConnect(path === 'external' ? 'port' : 'source'), true, 'next');
      break;
    case 'source': {
      const loading = fetching.status === 'loading';
      const ready = tab === 'url' ? !!url.trim() && URL.canParse(url.trim()) && !loading : tab === 'file' ? true : !!paste.trim();
      heading = t('welcome.source.title');
      body = <>
        <Seg name="tab" label={t('welcome.source.label')} value={tab} onChange={v => { setTab(v); setFetching({ status: 'idle' }); }} options={[['url', t('welcome.source.url'), 'link'], ['file', t('welcome.source.file'), 'file'], ['paste', t('welcome.source.paste'), 'clipboard-paste']]} />
        {tab === 'url' && <><label class="field"><span>{t('welcome.source.urlLabel')}</span><input id="sub-url" value={url} placeholder="https://…" spellcheck={false} disabled={loading} onInput={e => { setUrl(e.currentTarget.value); setFetching({ status: 'idle' }); }} /></label>
          <p class="note"><Icon name="info" /><span>{t('welcome.source.direct')}</span></p></>}
        {tab === 'file' && <div class="drop"><Icon name="file-up" /><div class="label"><b>{t('welcome.source.fileLabel')}</b></div><button id="choose-file" class="btn" disabled={busy !== null} onClick={importSource}>{t('welcome.source.choose')}</button></div>}
        {tab === 'paste' && <label class="field"><span>{t('welcome.source.pasteLabel')}</span><textarea id="paste" rows={6} spellcheck={false} value={paste} onInput={e => { setPaste(e.currentTarget.value); setFetching({ status: 'idle' }); }} /></label>}
        {fetching.status === 'loading' && <div class="live" role="status"><span class="dot checking" /><span>{t('welcome.source.loading', { host: hostOf(url.trim()), s: secs(fetching.started) })}</span></div>}
        {fetching.status === 'error' && fetching.kind === 'status' && <Fix kind="bad" icon="circle-x" title={t('welcome.source.status', { host: hostOf(url.trim()), status: fetching.code! })} detail={t('welcome.source.statusHint')}><button class="btn primary" onClick={importSource}>{t('welcome.retry')}</button></Fix>}
        {fetching.status === 'error' && fetching.kind === 'empty' && <Fix kind="warn" icon="triangle-alert" title={t(fetching.tab === 'url' ? 'welcome.source.emptyUrl' : 'welcome.source.emptyText')} detail={t(fetching.tab === 'url' ? 'welcome.source.emptyUrlHint' : 'welcome.source.emptyTextHint')} />}
        {fetching.status === 'error' && fetching.kind === 'other' && <Fix kind="bad" icon="circle-x" title={fetching.tab === 'url' ? t('welcome.source.failed', { host: hostOf(url.trim()) }) : fetching.message} detail={fetching.tab === 'url' ? fetching.message : undefined}><button class="btn primary" onClick={importSource}>{t('welcome.retry')}</button></Fix>}
      </>;
      if (sources.length > 0) secondary = <button id="keep-source" class="btn quiet" disabled={busy !== null} onClick={keepSource}>{t('welcome.source.keep')}</button>;
      primaryButton = P(tab === 'url' ? t('welcome.source.fetch') : tab === 'file' ? t('welcome.source.choose') : t('welcome.source.import'), importSource, ready, 'import');
      break;
    }
    case 'port': {
      const port = Number(ext.port);
      heading = t('welcome.port.title');
      body = <>
        <div class="inline-fields"><ExternalEndpoint value={ext} set={(k, v) => setExt(p => ({ ...p, [k]: v }))} fieldClass="field" /></div>
        <p class="hint">{t('welcome.port.hint')}</p>
        <details class="more" open={!!(ext.username || ext.password) || undefined}><summary><Icon name="chevron-right" />{t('welcome.port.auth')}</summary><div class="inline-fields two"><ExternalCredentials value={ext} set={(k, v) => setExt(p => ({ ...p, [k]: v }))} fieldClass="field" labels={[t('welcome.port.user'), t('welcome.port.pass')]} /></div></details>
      </>;
      primaryButton = P(t('welcome.next'), savePort, Number.isInteger(port) && port >= 1 && port <= 65535 && isLoopbackHost(ext.host), 'next');
      break;
    }
    case 'node': {
      heading = external ? t('welcome.node.titleExternal') : t('welcome.node.title');
      const measuring = measure?.key === nodeKey && measure.status === 'measuring';
      const fromMeasure = measure?.key === nodeKey && measure.status === 'done' && measure.country === country;
      body = <>
        {external
          ? <div class="srcline"><Icon name="plug" /><div class="label"><b>{t('welcome.node.external')}</b><small>{`${profile.externalProxy.protocol === 'http' ? 'HTTP' : 'SOCKS5'} · ${extAddr}`}</small></div><button class="btn link" onClick={() => { setConnect('port'); hold('connect'); }}>{t('welcome.node.edit')}</button></div>
          : <><div class="listhead"><span class="src"><Icon name={source?.origin.kind === 'subscription' ? 'rss' : source?.origin.kind === 'file' ? 'file' : 'clipboard-paste'} /><b>{source?.name}</b><span>{t('welcome.node.count', { count: rows.length })}</span></span><span class="acts"><button class="btn link" onClick={() => { setConnect('source'); hold('connect'); }}>{t('welcome.node.changeSource')}</button><button id="delays" class="btn quiet" disabled={busy !== null || !rows.length} onClick={() => act('delays', () => cave.testDelays())}><Icon name="zap" />{t('welcome.node.delays')}</button></span></div>
            <NodeList rows={rows} locale={state.locale} isSelected={isSelected} onSelect={selectNode} className="nodes compact one bounded" label={t('welcome.node.list')} /></>}
        <label class="field"><span>{t('welcome.country.label')}</span>
          <select id="country" value={country} onChange={e => setCountry(e.currentTarget.value)}><option value="">{t('welcome.country.choose')}</option>{countries.map(([code, name]) => <option value={code}>{name}</option>)}</select>
          {measuring ? <small class="live"><span class="dot checking" />{t('welcome.country.measuring')}</small> : fromMeasure ? <small>{t('welcome.country.measured')}</small> : null}</label>
      </>;
      primaryButton = P(t('welcome.checkExit'), checkExit, !!country && (external || !!selected), 'check-exit');
      break;
    }
    case 'verify': {
      const e = gate.egress;
      const running = phase === 'running' || phase === 'starting' || phase === 'waiting';
      heading = running ? t('welcome.verify.running') : phase === 'ok' ? t('welcome.verify.ok') : t('welcome.verify.failed');
      const coreRow: GateRow = { id: 'core', icon: 'cpu', label: t('welcome.cond.core'), ...(phase === 'starting' ? { value: t('welcome.cond.starting'), condition: 'running' } : phase === 'core' ? { value: t('welcome.cond.stopped'), condition: 'failed' } : phase === 'paused' ? { value: t('welcome.cond.waiting'), condition: 'pending' } : { value: t('welcome.cond.running'), condition: 'ok' }) };
      const linkPending = phase === 'starting' || phase === 'core' || phase === 'paused';
      const linkRow: GateRow = external
        ? { id: 'node', icon: 'plug', label: t('welcome.cond.port'), value: phase === 'port' ? t('welcome.cond.noAnswer', { addr: extAddr }) : extAddr, condition: phase === 'port' ? 'failed' : linkPending ? 'pending' : 'ok' }
        : { id: 'node', icon: 'network', label: t('welcome.cond.node'), value: selected?.node ?? '', condition: linkPending ? 'pending' : phase === 'waiting' ? 'running' : 'ok' };
      const expected = country$(profile.egressCountry);
      const exitRow: GateRow = { id: 'exit', icon: 'map-pin', label: t('welcome.cond.exit'), ...(phase === 'running' ? { value: t('welcome.cond.checking', { s: secs(checkStarted) }), condition: 'running' }
        : phase === 'ok' ? { value: `${country$(e?.country ?? profile.egressCountry)} · ${e?.ip ?? ''}`, condition: 'ok' }
        : phase === 'timeout' ? { value: t('welcome.cond.timedOut'), condition: 'failed' }
        : phase === 'mismatch' && e ? { value: t('welcome.cond.mismatch', { actual: country$(e.country), ip: e.ip, expected }), condition: 'failed' }
        : phase === 'failed' ? { value: t('welcome.cond.set', { country: expected }), condition: 'failed' }
        : { value: t('welcome.cond.set', { country: expected }), condition: 'pending' }) };
      body = <>
        <ConditionList st={gate.state} rows={[coreRow, linkRow, exitRow]} className="condition-list conds" live />
        {phase === 'ok' && <Fix kind="good" icon="shield-check" title={t('welcome.verify.allowed', { country: country$(e?.country ?? profile.egressCountry) })} />}
        {phase === 'mismatch' && <Fix kind="bad" icon="circle-x" title={t('welcome.verify.mismatch')}><button class="btn primary" onClick={() => hold('node')}>{t('welcome.verify.otherNode')}</button>{e && /^[A-Z]{2}$/.test(e.country) && <button id="use-observed" class="btn" disabled={busy !== null} onClick={() => { setCountry(e.country); void act('use', () => cave.updateProfile({ egressCountry: e.country })); }}>{t('welcome.verify.useObserved', { country: country$(e.country) })}</button>}</Fix>}
        {phase === 'timeout' && <Fix kind="bad" icon="circle-x" title={t('welcome.verify.timeout', { s: EXIT_CHECK_TIMEOUT_S })}>{!external && <button class="btn primary" onClick={() => hold('node')}>{t('welcome.verify.otherNode')}</button>}<button class={external ? 'btn primary' : 'btn'} disabled={busy !== null} onClick={retry}>{t('welcome.retry')}</button></Fix>}
        {phase === 'core' && <Fix kind="bad" icon="circle-x" title={t('welcome.verify.core')}><button class="btn primary" disabled={busy !== null} onClick={retry}>{t('welcome.verify.restartCore')}</button></Fix>}
        {phase === 'port' && <Fix kind="bad" icon="circle-x" title={t('welcome.verify.port', { addr: extAddr })}><button class="btn primary" disabled={busy !== null} onClick={retry}>{t('welcome.retry')}</button><button class="btn" onClick={() => { setConnect('port'); hold('connect'); }}>{t('welcome.verify.changePort')}</button></Fix>}
        {phase === 'failed' && <Fix kind="bad" icon="circle-x" title={gate.reason}>{!external && <button class="btn primary" onClick={() => hold('node')}>{t('welcome.verify.otherNode')}</button>}<button class={external ? 'btn primary' : 'btn'} disabled={busy !== null} onClick={retry}>{t('welcome.retry')}</button></Fix>}
      </>;
      if (phase === 'ok') primaryButton = P(t('welcome.next'), () => hold(null), true, 'next');
      if (running) backLabel = t('welcome.verify.stopBack');
      break;
    }
    case 'identity': {
      const tz = zone ?? proposal.timezone;
      const lang = languages ?? (proposal.languages.length ? 'exit' : 'keep');
      const loc = location ?? (proposal.city ? 'city' : 'deny');
      const patch = identityPatch(proposal, { timezone: tz, languages: lang, location: loc }, profile);
      const city = proposal.city ? (state.locale === 'zh' ? proposal.city.nameZh : proposal.city.name) : '';
      const both = proposal.languages.length ? [...new Set([proposal.languages[0], profile.locale])] : [];
      heading = t('welcome.identity.title', { country: country$(exitCountry) });
      body = <>
        <div class="kv">
          <div class="r"><Icon name="clock" /><div class="label"><b>{t('welcome.identity.timezone')}</b></div><div class="val"><b id="identity-timezone">{patch.timezone}</b><small>{t('welcome.identity.was', { value: profile.timezone })}</small></div></div>
          <div class="r"><Icon name="languages" /><div class="label"><b>{t('welcome.identity.languages')}</b></div><div class="val"><b id="identity-languages">{patch.acceptLanguages!.join(', ')}</b><small>{t('welcome.identity.was', { value: profile.acceptLanguages.join(', ') })}</small></div></div>
          <div class="r"><Icon name="map-pin" /><div class="label"><b>{t('welcome.identity.location')}</b></div><div class="val"><b id="identity-location">{patch.geolocation ? t('welcome.identity.near', { city }) : t('welcome.identity.deny')}</b></div></div>
        </div>
        <details class="more"><summary><Icon name="chevron-right" />{t('welcome.identity.adjust')}</summary>
          <div class="idd">
            {proposal.timezones.length > 0 && <label class="field"><span>{t('welcome.identity.timezone')}</span><select value={tz} onChange={e => setZone(e.currentTarget.value)}>{proposal.timezones.map(z => <option value={z}>{z}</option>)}</select></label>}
            <div class="field" role="radiogroup" aria-label={t('welcome.identity.languages')}><span>{t('welcome.identity.languages')}</span>
              {proposal.languages.length > 0 && <label class="radio-row"><input type="radio" name="languages" checked={lang === 'exit'} onChange={() => setLanguages('exit')} />{proposal.languages.join(', ')}</label>}
              {both.length > 1 && <label class="radio-row"><input type="radio" name="languages" checked={lang === 'both'} onChange={() => setLanguages('both')} />{both.join(', ')}</label>}
              <label class="radio-row"><input type="radio" name="languages" checked={lang === 'keep'} onChange={() => setLanguages('keep')} />{profile.acceptLanguages.join(', ')}</label>
              <small>{t('welcome.identity.uiUnchanged')}</small></div>
            <div class="field" role="radiogroup" aria-label={t('welcome.identity.location')}><span>{t('welcome.identity.location')}</span>
              <label class="radio-row"><input type="radio" name="location" checked={loc === 'deny'} onChange={() => setLocation('deny')} />{t('welcome.identity.deny')}</label>
              {proposal.city && <label class="radio-row"><input type="radio" name="location" checked={loc === 'city'} onChange={() => setLocation('city')} />{t('welcome.identity.nearCentre', { city })}</label>}</div>
          </div></details>
      </>;
      secondary = <button id="keep-identity" class="btn quiet" disabled={busy !== null} onClick={keepIdentity}>{t('welcome.identity.keep')}</button>;
      primaryButton = P(t('welcome.identity.use'), useIdentity, gate.state === 'open', 'use-identity');
      break;
    }
    case 'personalise':
      heading = t('welcome.personalise.title');
      body = <div class="pers">
        <div class="r"><div class="label"><b>{t('welcome.personalise.appearance')}</b></div><ThemePicker value={theme} onChange={setTheme} label={t('welcome.personalise.appearance')} /></div>
        <div class="r col"><div class="label"><b>{t('welcome.personalise.tabs')}</b></div><div class="layout-pick" role="radiogroup" aria-label={t('welcome.personalise.tabs')}>
          {(['top', 'side'] as TabLayout[]).map(v => <label class="choice"><input type="radio" name="tabs" value={v} checked={tabs === v} onChange={() => setTabs(v)} /><span class={`thumb ${v}`} /><span class="lb"><b>{t(v === 'top' ? 'welcome.personalise.top' : 'welcome.personalise.side')}</b></span></label>)}</div></div>
        <div class="r"><div class="label"><b>{t('welcome.personalise.search')}</b></div><select value={search.kind} onChange={e => setSearch(e.currentTarget.value === 'custom' ? { kind: 'custom', template: search.kind === 'custom' ? search.template : '' } : { kind: 'default' })}><option value="default">{t('set.search.default')}</option><option value="custom">{t('set.search.custom')}…</option></select></div>
        {search.kind === 'custom' && <div class="r"><label class="field grow"><span>{t('welcome.personalise.template')}</span><input value={search.template} placeholder="https://…{query}" spellcheck={false} onInput={e => setSearch({ kind: 'custom', template: e.currentTarget.value })} /></label></div>}
        <div class="r"><div class="label"><b>{t('welcome.personalise.bookmarks')}</b>{bookmarks !== null && <small>{t('welcome.personalise.imported', { count: bookmarks })}</small>}</div><button id="import-bookmarks" class="btn" disabled={busy !== null} onClick={importBookmarks}><Icon name="bookmark" />{bookmarks !== null ? t('welcome.personalise.importAgain') : t('welcome.personalise.import')}</button></div>
      </div>;
      secondary = <button id="skip" class="btn quiet" disabled={busy !== null} onClick={() => finishPersonalise(false)}>{t('welcome.personalise.skip')}</button>;
      primaryButton = P(t('welcome.personalise.finish'), () => finishPersonalise(true), true, 'finish');
      break;
    case 'done':
      center = true;
      body = <div class="done-screen"><span class="badge open"><Icon name="shield-check" /></span><h1 ref={title} tabIndex={-1}>{t('welcome.done.title')}</h1><p class="fact">{t('welcome.verify.allowed', { country: country$(exitCountry) })}</p><p class="note"><Icon name="shield" /><span>{t('welcome.done.note')}</span></p></div>;
      primaryButton = P(t('welcome.done.start'), startBrowsing, gate.state === 'open', 'start-browsing');
      break;
  }

  const done = phasesDone(profile, gate);
  const bar = <header class="setup-bar"><span class="brand"><Mark size={18} /><span>Anyu</span></span><div class="grow"><Stepper step={screen} done={done} /></div>{screen !== 'done' && <button id="later" class="btn quiet later" disabled={busy !== null} onClick={later}>{t('welcome.later')}</button>}</header>;
  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (e.key !== 'Enter' || e.isComposing || target.closest('textarea, button, a, summary, select, label.choice, .seg, .theme-picker, .nodes')) return;
    if (primary.current && !primary.current.disabled) { e.preventDefault(); primary.current.click(); }
  };
  return <div class="setup" data-step={screen} onKeyDown={onKey}>
    {bar}
    {screen === 'welcome'
      ? <main class="welcome"><Mark size={56} /><h1 class="name" ref={title} tabIndex={-1}>Anyu</h1><p class="line">{t('welcome.line')}</p>
        <div class="ctl"><Seg name="lang" label={t('welcome.language')} value={state.locale} onChange={v => void cave.setLocale(v)} options={[['zh', '中文'], ['en', 'English']]} />
          <button ref={primary} id="start" class="btn primary lg" disabled={busy !== null} onClick={start}>{t('welcome.start')}<Icon name="arrow-right" /></button></div></main>
      : <>
        <main class={`a-main${center ? ' center' : ''}`}><div class="a-col">{heading && <h1 ref={title} tabIndex={-1}>{heading}</h1>}{body}{notice && <Fix kind="bad" icon="circle-x" title={notice} />}</div></main>
        <footer class="a-foot"><div class="a-col"><button id="back" class="btn" disabled={busy === 'stop'} onClick={back}><Icon name="arrow-left" />{backLabel}</button><span class="grow" />{secondary}{primaryButton}</div></footer>
      </>}
  </div>;
}

document.body.classList.add(cave.platform === 'darwin' ? 'mac' : 'winos');
render(<Welcome />, document.body);
