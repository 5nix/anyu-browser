import { ACCENTS } from '../../shared/appearance.ts';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Permission, CheckItem, PanelData, SearchEngine, SettingsSection, ShellState } from '../../shared/ipc.ts';
import { MAX_MONITOR_URLS, type Profile, type SubscriptionVia } from '../../shared/profile.ts';
import { t, setLocale, type LocalePreference } from '../../shared/i18n/index.ts';
import { SEARCH_PRESETS, isSearchEngine, subscriptionFetchBlock } from '../../shared/url.ts';
import { builtinUa, uaModeLabel, type UaPreference } from '../../shared/ua.ts';
import { switchText } from '../../shared/switch.ts';
import { cave } from '../bridge.ts';
import { ConditionList, GateSummary, gateStatus, regionName } from '../gate-status.tsx';
import { Icon, useCave } from '../ui/index.tsx';
import { ExternalCredentials, ExternalEndpoint, NodeList, ThemePicker, protocol, type ExternalDraft } from '../proxy-controls.tsx';
import type { DialogRequest } from '../ui/dialog.tsx';


function SettingsDialog({ request, onClose }: { request: DialogRequest | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (request && ref.current && !ref.current.open) { ref.current.returnValue = ''; ref.current.showModal(); } }, [request]);
  return <dialog id="confirm" ref={ref} onClose={() => { request?.resolve(ref.current?.returnValue === 'ok'); onClose(); }}>
    <form method="dialog"><h2 id="confirm-title">{request?.title}</h2><p id="confirm-body">{request?.body}</p>
      <div class="actions"><button value="cancel" class="btn" autoFocus>{t('set.dialog.cancel')}</button><button id="confirm-ok" value="ok" class={request?.danger ? 'btn primary danger' : 'btn primary'}>{request?.ok}</button></div>
    </form>
  </dialog>;
}

type Props = { active: boolean; state: ShellState; data: PanelData; act: (fn: () => Promise<unknown>, key?: string) => Promise<void>; busy: Set<string>; confirm: (title: string, body: string, ok: string, danger?: boolean) => Promise<boolean>; checks: CheckItem[]; runChecks: () => Promise<void> };
function OverviewSection({ active, state, data, act, confirm, checks, runChecks, busy }: Props) {
  // Pausing stops the core, which then reports no selection; the selected node is in the profile, as on the status card.
  const selectedNode = data.nodes.selected?.node ?? '';
  const { st, e, mismatch, rows, title, country } = gateStatus(state, { coreUp: checks.find(i => i.id === 1)?.pass, selectedNode, country: data.profile.egressCountry });
  const [copied, setCopied] = useState(false);
  // One panel under the four rows explains what failed and offers the fix; the same action is offered once.
  const failed = rows.filter(row => row.id !== 'switch' && row.condition === 'failed');
  const fixes = failed.map(row => row.id === 'core' ? { key: 'recheck', label: t('set.overview.recheck'), run: () => act(() => cave.restartAndCheck(), 'restart') }
    : row.id === 'exit' && !data.profile.egressCountry ? { key: 'env', label: t('set.env.title'), run: () => cave.openSettings('env') }
    : { key: 'nodes', label: t('set.conditions.changeNode'), run: () => cave.openSettings('nodes') }).filter((fix, i, all) => all.findIndex(f => f.key === fix.key) === i);
  const groups = [
    { name: t('set.conditions.network'), ids: [1, 2, 6, 10, 11], icon: 'network' },
    { name: t('set.conditions.leaks'), ids: [3, 7, 8, 9], icon: 'shield' },
    { name: t('set.conditions.identity'), ids: [4, 5, 12, 13], icon: 'fingerprint' },
  ];
  // Option B's fix for a wrong exit: nodes already seen exiting in the right country, or changing the profile to the country observed.
  const exitFix = () => {
    const wanted = data.profile.egressCountry, verified = data.nodes.nodes.filter(n => !(n.name === data.nodes.selected?.node && n.source === data.nodes.selected?.source) && n.country === wanted && n.delay.status !== 'timeout');
    const switchTo = async (n: typeof verified[number]) => { const current = data.nodes.nodes.find(x => x.name === data.nodes.selected?.node && x.source === data.nodes.selected?.source); if (current && !await confirm(t('set.nodes.switchTitle'), switchText(current, n, wanted), t('set.nodes.switch'))) return; await act(() => cave.selectNode(n.source, n.name)); };
    const useObserved = async () => { if (await confirm(t('set.conditions.useTitle', { country: country(e!.country) }), t('set.conditions.useBody', { from: wanted, to: e!.country }), t('set.conditions.useOk', { code: e!.country }))) await act(() => cave.updateProfile({ egressCountry: e!.country }), 'use-country'); };
    return <div class="condition-fix exit-fix" id="condition-fix">
      <p>{t(verified.length ? 'set.conditions.verified' : 'set.conditions.noVerified', { country: country(wanted) })}</p>
      {verified.map((n, i) => <div class="candidate"><b>{n.name}</b><small>{[protocol(n.type), n.delay.status === 'measured' ? `${n.delay.ms} ms` : ''].filter(Boolean).join(' · ')}</small><button class={i === 0 ? 'btn primary' : 'btn'} onClick={() => switchTo(n)}>{t('set.nodes.switch')}</button></div>)}
      {!verified.length && <div class="candidate"><button class="btn" onClick={() => cave.openSettings('nodes')}>{t('set.conditions.changeNode')}…</button></div>}
      {/^[A-Z]{2}$/.test(e!.country) && <p class="fix-or">{t('set.conditions.orUse', { country: country(e!.country) })}<button id="use-country" class="btn link" disabled={busy.has('use-country')} onClick={useObserved}>{t('set.conditions.useLink', { code: e!.country })}</button></p>}
    </div>;
  };
  return <section data-section="overview" class="entering" hidden={!active}>
    <h2>{t('set.overview.title')}</h2>
    <GateSummary st={st} title={title} reason={state.gate.reason} titleId="gate-title" reasonId="gate-reason" busy={busy.has('pause')} onToggle={() => act(() => st === 'paused' ? cave.resume() : cave.pause(), 'pause')} />
    <div class="setup-row">
      <Icon name="list-checks" />
      <div class="label"><b>{t('set.overview.setupTitle')}</b><small>{t('set.overview.setupHint')}</small></div>
      <button id="restart-setup" class="btn primary" disabled={busy.has('restart-setup') || !!data.profileError} onClick={() => act(() => cave.restartSetup(), 'restart-setup')}>{t('set.overview.setupButton')}</button>
    </div>
    <div class="group"><div class="check-heading"><h3>{t('set.conditions.title')}</h3><button id="restart" disabled={busy.has('restart') || st === 'paused'} onClick={() => act(() => cave.restartAndCheck(), 'restart')}>{t('set.overview.recheck')}</button></div>
      <ConditionList st={st} rows={rows} />
      {failed.length > 0 && (mismatch ? exitFix() : <div class="condition-fix" id="condition-fix"><p>{state.gate.reason}</p>{fixes.map((fix, i) => <button class={i === 0 ? 'btn primary' : 'btn'} disabled={fix.key === 'recheck' && busy.has('restart')} onClick={fix.run}>{fix.label}</button>)}</div>)}
    </div>
    <div class="group"><div class="check-heading"><h3>{t('set.overview.checks')} <span id="score">{t('set.overview.score', {passed: checks.filter(i => i.pass).length, total: checks.length})}</span></h3><button id="run-checks" disabled={busy.has('run-checks')} onClick={() => act(runChecks, 'run-checks')}>{t('set.overview.run')}</button><button id="copy" disabled={busy.has('copy')} onClick={() => act(async () => { await cave.copyReport(); setCopied(true); setTimeout(() => setCopied(false), 1500); }, 'copy')}>{copied ? t('set.overview.copied') : t('set.overview.copy')}</button></div>
      <div id="checks">{groups.map(group => { const items = checks.filter(i => group.ids.includes(i.id)); return <details class="check-group" open={items.some(i => !i.pass)}><summary><Icon name={group.icon} /><b>{group.name}</b><span class={items.some(i => !i.pass) ? 'failed-count' : ''}>{items.some(i => !i.pass) ? t('set.conditions.failed', {count: items.filter(i => !i.pass).length}) : t('set.conditions.passed', {count: items.filter(i => i.pass).length})}</span><Icon name="chevron-right" /></summary><ol class="checks">{items.map(i => <li><span class={`mark ${i.pass ? 'pass' : 'fail'}`}>{i.pass ? '✓' : '✗'}</span><span>{i.title}</span>{!i.pass && <span class="detail">{i.detail}</span>}</li>)}</ol></details>; })}</div>
    </div>
  </section>;
}

// Source cards and rows are derived from the same state sent by the main process.
function NodesSection({ active, state, data, act, confirm, busy }: Props) {
  const [editor, setEditor] = useState(false), [subUrl, setSubUrl] = useState(''), [subVia, setSubVia] = useState<SubscriptionVia>('direct');
  const [pasteOpen, setPasteOpen] = useState(false), [pasteText, setPasteText] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null), [name, setName] = useState('');
  const [editingSource, setEditingSource] = useState<string | null>(null), [replacement, setReplacement] = useState('');
  const nodes = data.nodes.nodes, selected = data.nodes.selected;
  const mode = data.profile.connectionMode;
  const [ext, setExt] = useState<ExternalDraft>(() => ({ ...data.profile.externalProxy, port: data.profile.externalProxy.port ? String(data.profile.externalProxy.port) : '' }));
  const setExtField = (key: keyof ExternalDraft, value: string) => setExt(prev => ({ ...prev, [key]: value }));
  const [monitors, setMonitors] = useState<string[]>(() => data.profile.monitorUrls.length ? [...data.profile.monitorUrls] : ['']);
  const infoTip = (detail: string) => <span class="info-tip" tabIndex={0} aria-label={t('set.nodes.details')} onClick={e => { e.preventDefault(); e.stopPropagation(); }}><Icon name="info" /><span class="info-pop">{detail}</span></span>;
  const connRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (connRef.current?.contains(document.activeElement)) return;
    const p = data.profile.externalProxy;
    setExt({ ...p, port: p.port ? String(p.port) : '' });
    setMonitors(data.profile.monitorUrls.length ? [...data.profile.monitorUrls] : ['']);
  }, [data.profile]);
  const saveConnection = () => act(() => cave.updateProfile({
    externalProxy: { ...ext, protocol: ext.protocol as 'socks5' | 'http', host: ext.host.trim(), port: Number(ext.port) || 0 },
  }), 'connection');
  const isSelected = (n: typeof nodes[number]) => n.source === selected?.source && n.name === selected?.node;
  const select = async (n: typeof nodes[number]) => {
    if (isSelected(n) && n.delay.status !== 'timeout') return;
    const current = nodes.find(isSelected);
    if (current && !isSelected(n) && mode !== 'external' && !await confirm(t('set.nodes.switchTitle'), switchText(current, n, data.profile.egressCountry), t('set.nodes.switch'))) return;
    // Picking a subscription node while on the local port means going back to a built-in node.
    if (mode === 'external') await act(async () => { await cave.updateProfile({ connectionMode: 'system' }); await cave.selectNode(n.source, n.name); });
    else await act(() => cave.selectNode(n.source, n.name));
  };
  const remove = async (id: string, sourceName: string) => {
    if (await confirm(t('set.nodes.removeTitle'), t('set.nodes.removeBody', { name: sourceName }), t('set.nodes.remove'), true)) await act(() => cave.removeSource(id));
  };
  const gateOpen = state.gate.state === 'open';
  const subBlock = subscriptionFetchBlock(subUrl, subVia, gateOpen);
  const subFetching = busy.has('sub-update');
  const subDisabled = subBlock !== null || subFetching;
  const subReason = !subUrl.trim() ? null
    : subFetching ? t('set.nodes.fetching')
    : subBlock === 'tooLong' ? t('set.nodes.urlTooLong')
    : subBlock === 'invalidUrl' ? t('set.nodes.urlInvalid')
    : subBlock === 'needsOpenGate' ? t('set.nodes.proxyNeedsGate')
    : null;
  useEffect(() => { if (!gateOpen && !editor && subVia === 'proxy') setSubVia('direct'); }, [gateOpen, editor, subVia]);
  useEffect(() => { if (!active) { setEditor(false); setRenaming(null); setEditingSource(null); } }, [active]);
  return <section data-section="nodes" class="entering" hidden={!active}>
    <h2>{t('set.nodes.title')}</h2>
    <div class="group"><h3>{t('set.nodes.connection')}</h3>
    <div class="card" ref={connRef}>
      <label class="row"><div class="label conn-label"><b>{t('set.nodes.modeSystem')}</b><small>{t('set.nodes.modeSystemHint')} {infoTip(t('set.nodes.modeSystemDetail'))}</small></div><input type="radio" name="connection-mode" checked={mode === 'system'} disabled={busy.has('connection')} onChange={() => act(() => cave.updateProfile({ connectionMode: 'system' }), 'connection')} /></label>
      <label class="row"><div class="label conn-label"><b>{t('set.nodes.modeIndependent')}</b><small>{t('set.nodes.modeIndependentHint')} {infoTip(t('set.nodes.modeIndependentDetail'))}</small></div><input type="radio" name="connection-mode" checked={mode === 'independent'} disabled={busy.has('connection') || cave.platform !== 'win32'} onChange={() => act(() => cave.updateProfile({ connectionMode: 'independent' }), 'connection')} /></label>
      <label class="row"><div class="label conn-label"><b>{t('set.nodes.modeExternal')}</b><small>{t('set.nodes.modeExternalHint')} {infoTip(t('set.nodes.modeExternalDetail'))}</small></div><input type="radio" name="connection-mode" checked={mode === 'external'} disabled={busy.has('connection')} onChange={() => act(() => cave.updateProfile({ connectionMode: 'external' }), 'connection')} /></label>
      {mode === 'external' && <div class="source-editor">
        <p><small>{t('set.nodes.externalActive')}</small></p>
        <ExternalEndpoint value={ext} set={setExtField} fieldClass="editor-field" />
        <ExternalCredentials value={ext} set={setExtField} fieldClass="editor-field" />
        <div class="editor-actions"><button id="save-connection" class="btn primary" disabled={busy.has('connection')} onClick={saveConnection}>{t('set.nodes.saveConnection')}</button></div>
      </div>}
      <div class="source-editor">
        <div class="editor-head"><div class="label conn-label"><b>{t('set.nodes.monitorUrl')}</b><small>{t('set.nodes.monitorUrlHint')} {infoTip(t('set.nodes.monitorUrlDetail'))}</small></div></div>
        {monitors.map((url, i) => <div class="monitor-row"><input id={i === 0 ? 'monitor-url' : undefined} value={url} onInput={e => setMonitors(prev => prev.map((u, j) => j === i ? e.currentTarget.value : u))} placeholder="https://www.cloudflare.com/cdn-cgi/trace" spellcheck={false} /><button class="icon-btn sm" aria-label={t('set.nodes.close')} onClick={() => setMonitors(prev => prev.length > 1 ? prev.filter((_, j) => j !== i) : [''])}><Icon name="x" /></button></div>)}
        <div class="editor-actions"><button class="btn" disabled={monitors.length >= MAX_MONITOR_URLS} onClick={() => setMonitors(prev => [...prev, ''])}><Icon name="plus" />{t('set.nodes.monitorAdd')}</button><button id="save-monitor" class="btn primary" disabled={busy.has('connection')} onClick={() => act(() => cave.updateProfile({ monitorUrls: [...new Set(monitors.map(u => u.trim()).filter(Boolean))] }), 'connection')}>{t('set.nodes.saveMonitor')}</button></div>
      </div>
    </div>
    </div>
    <div class="nodes-toolbar"><span></span><button id="delays" disabled={busy.has('delays') || !nodes.length} onClick={() => act(() => cave.testDelays(), 'delays')} class="btn"><Icon name="zap" />{t('set.nodes.delays')}</button><button id="add-source" onClick={() => { if (!gateOpen) setSubVia('direct'); setEditor(true); }} class="btn"><Icon name="plus" />{t('set.nodes.add')}</button></div>
    {editor && <div id="source-editor" class="source-editor">
      <div class="editor-head"><div class="label"><b>{t('set.nodes.addTitle')}</b></div><button class="icon-btn sm" aria-label={t('set.nodes.close')} onClick={() => setEditor(false)}><Icon name="x" /></button></div>
      <label class="editor-field"><span>{t('set.nodes.url')}</span><input id="sub-url" value={subUrl} onInput={e => setSubUrl(e.currentTarget.value)} placeholder="https://…" spellcheck={false} /></label>
      <label class="editor-field"><span>{t('set.nodes.method')}</span><select id="sub-via" value={subVia} onChange={e => setSubVia(e.currentTarget.value as SubscriptionVia)}><option value="direct">{t('set.nodes.direct')}</option><option value="proxy">{t('set.nodes.proxy')}</option></select></label>
      <div class="editor-actions"><button id="import-file" class="btn link" onClick={() => act(async () => { if (await cave.importSubscriptionFile()) setEditor(false); }, 'import-file')}>{t('set.nodes.file')}</button><button id="toggle-paste" class="btn link" onClick={() => setPasteOpen(!pasteOpen)}>{t('set.nodes.paste')}</button><span class="editor-fetch">{subReason && <small id="sub-fetch-reason">{subReason}</small>}<button id="sub-fetch" class="btn primary" disabled={subDisabled} onClick={() => act(async () => { await cave.addSubscription(subUrl.trim(), subVia); setSubUrl(''); setEditor(false); }, 'sub-update')}>{t('set.nodes.fetchNodes')}</button></span></div>
      {pasteOpen && <div id="paste" class="editor-paste"><textarea id="paste-text" value={pasteText} onInput={e => setPasteText(e.currentTarget.value)} rows={6} placeholder={t('set.nodes.placeholder')} spellcheck={false}></textarea><div class="end"><button id="paste-import" class="btn primary" disabled={!pasteText.trim()} onClick={() => act(async () => { await cave.importSubscriptionText(pasteText); setPasteText(''); setPasteOpen(false); setEditor(false); }, 'paste-import')}>{t('set.nodes.import')}</button></div></div>}
    </div>}
    {data.profile.proxy.sources.map(source => {
      const rows = nodes.filter(n => n.source === source.id), origin = source.origin.kind === 'subscription' ? source.origin.url : source.origin.kind === 'file' ? source.origin.filename : t('set.nodes.pasted');
      const detail = [origin, source.updatedAt === null ? '' : new Date(source.updatedAt).toLocaleString(state.locale)].filter(Boolean).join(' · ');
      return <div class="source-card" data-source={source.id} key={source.id}>
        <header><span class="source-icon"><Icon name={source.origin.kind === 'subscription' ? 'rss' : 'file'} /></span><div class="label">{renaming === source.id ? <input class="source-name" value={name} maxLength={256} onInput={e => setName(e.currentTarget.value)} /> : <b title={source.name}>{source.name}</b>}<small title={detail}>{detail}</small></div>
          {renaming === source.id ? <><button class="btn link source-save" disabled={!name.trim()} onClick={() => act(async () => { await cave.renameSource(source.id, name); setRenaming(null); })}>{t('set.nodes.saveName')}</button><button class="icon-btn sm" aria-label={t('set.nodes.close')} onClick={() => setRenaming(null)}><Icon name="x" /></button></> : <>
          <button class="btn link source-update" disabled={busy.has(source.id) || (source.origin.kind === 'subscription' && source.origin.via === 'proxy' && !gateOpen)} onClick={() => {
            if (source.origin.kind === 'subscription') void act(() => cave.updateSource(source.id), source.id);
            else if (source.origin.kind === 'file') void act(() => cave.updateSourceFile(source.id), source.id);
            else { setReplacement(''); setEditingSource(source.id); }
          }}>{t('set.nodes.update')}</button>
          <button class="icon-btn sm source-rename" aria-label={t('set.nodes.rename')} title={t('set.nodes.rename')} onClick={() => { setName(source.name); setRenaming(source.id); }}><Icon name="pencil" /></button><button class="icon-btn sm source-remove" aria-label={t('set.nodes.remove')} title={t('set.nodes.remove')} onClick={() => void remove(source.id, source.name)}><Icon name="trash-2" /></button></>}
        </header>
        <div class="source-body">{editingSource === source.id && <div class="editor-paste"><textarea value={replacement} onInput={e => setReplacement(e.currentTarget.value)} rows={6} placeholder={t('set.nodes.placeholder')} spellcheck={false}></textarea><div class="end"><button class="btn" onClick={() => setEditingSource(null)}>{t('set.dialog.cancel')}</button><button class="btn primary" disabled={!replacement.trim()} onClick={() => act(async () => { await cave.updateSourceText(source.id, replacement); setEditingSource(null); }, source.id)}>{t('set.nodes.update')}</button></div></div>}<NodeList rows={rows} locale={state.locale} isSelected={isSelected} onSelect={n => void select(n)} /></div>
      </div>;
    })}
  </section>;
}

function EnvSection({ active, state, data, act, confirm, checks, runChecks, busy }: Props) {
  const values = (p: Profile) => ({ egressCountry:p.egressCountry, timezone:p.timezone, locale:p.locale, acceptLanguages:p.acceptLanguages.join(', '), platform:p.platform as string, latitude:p.geolocation ? String(p.geolocation.latitude) : '', longitude:p.geolocation ? String(p.geolocation.longitude) : '', accuracy:p.geolocation ? String(p.geolocation.accuracy) : '' });
  const [fields, setFields] = useState(() => values(data.profile));
  const [saved, setSaved] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { if (!formRef.current?.contains(document.activeElement)) setFields(values(data.profile)); }, [data.profile]);
  const saveProfile = (e: Event) => { e.preventDefault(); const num = (s: string) => s.trim() === '' ? NaN : Number(s); const lat = num(fields.latitude), lon = num(fields.longitude), acc = num(fields.accuracy); void act(async () => { await cave.updateProfile({egressCountry:fields.egressCountry.trim(), timezone:fields.timezone.trim(), locale:fields.locale.trim(), acceptLanguages:fields.acceptLanguages.split(',').map(s => s.trim()).filter(Boolean), platform: fields.platform as Profile['platform'], geolocation:[lat,lon,acc].every(Number.isFinite) ? {latitude:lat,longitude:lon,accuracy:acc} : null}); (document.activeElement as HTMLElement)?.blur(); setSaved(true); setTimeout(() => setSaved(false), 1500); }, 'save'); };
  return <section data-section="env" class="entering" hidden={!active}>
    <h2>{t('set.env.title')}</h2>
    <p class="intro">{t('set.env.intro')}</p>
    <form ref={formRef} id="profile" onSubmit={saveProfile}>
      <div class="group">
        <h3>{t('set.env.region')}</h3>
        <div class="card">
          <label class="row"><div class="label"><b>{t('set.overview.country')}</b><small>{t('set.env.countryHint')}</small></div><input name="egressCountry" value={fields.egressCountry} onInput={e => setFields({...fields, egressCountry: e.currentTarget.value})} maxLength={2} placeholder={t('set.env.countryPlaceholder')} spellcheck={false} class="short" /></label>
          <label class="row"><div class="label"><b>{t('set.env.timezone')}</b><small>{t('set.env.timezoneHint')}</small></div><input name="timezone" value={fields.timezone} onInput={e => setFields({...fields, timezone: e.currentTarget.value})} list="zones" spellcheck={false} /></label>
          <div class="row"><div class="label"><b>{t('set.env.location')}</b><small>{t('set.env.locationHint')}</small></div>
            <div class="inline"><input name="latitude" value={fields.latitude} onInput={e => setFields({...fields, latitude: e.currentTarget.value})} placeholder={t('set.env.latitude')} inputMode="decimal" class="num" /><input name="longitude" value={fields.longitude} onInput={e => setFields({...fields, longitude: e.currentTarget.value})} placeholder={t('set.env.longitude')} inputMode="decimal" class="num" /><input name="accuracy" value={fields.accuracy} onInput={e => setFields({...fields, accuracy: e.currentTarget.value})} placeholder={t('set.env.accuracy')} inputMode="decimal" class="num" /></div></div>
        </div>
      </div>
      <div class="group">
        <h3>{t('set.env.languagePlatform')}</h3>
        <div class="card">
          <label class="row"><div class="label"><b>{t('set.env.language')}</b><small>{t('set.env.languageHint')}</small></div><input name="locale" value={fields.locale} onInput={e => setFields({...fields, locale: e.currentTarget.value})} spellcheck={false} /></label>
          <label class="row"><div class="label"><b>{t('set.env.acceptLabel')}</b><small>{t('set.env.acceptHint')}</small></div><input name="acceptLanguages" value={fields.acceptLanguages} onInput={e => setFields({...fields, acceptLanguages: e.currentTarget.value})} spellcheck={false} /></label>
          <label class="row"><div class="label"><b>{t('set.env.platform')}</b><small id="platform-hint">{t('set.env.platformHint', {platform: data.hostPlatform})}</small></div>
            <select name="platform" value={fields.platform} onInput={e => setFields({...fields, platform: e.currentTarget.value})}><option value="host">{t('set.env.host')}</option><option value="macos">macOS</option><option value="windows">Windows</option></select></label>
        </div>
      </div>
      <div class="savebar"><span id="profile-msg">{saved ? t('set.env.saved') : ''}</span><button class="btn primary" type="submit" disabled={busy.has('save')}>{t('set.env.save')}</button></div>
    </form>
    <datalist id="zones">{Intl.supportedValuesOf('timeZone').map(z => <option value={z} />)}</datalist>
  </section>;
}

const permissionLabels: Record<Permission, Parameters<typeof t>[0]> = { 'media-camera': 'set.permissions.camera', 'media-microphone': 'set.permissions.microphone', geolocation: 'set.permissions.location', notifications: 'set.permissions.notifications', 'clipboard-read': 'set.permissions.clipboard' };

function PrivacySection({ active, state, data, act, confirm, checks, runChecks, busy }: Props) {
  const host = (() => { try { return new URL(state.site).host; } catch { return ''; } })();
  const [range, setRange] = useState('all');
  const [history, setHistory] = useState(true);
  const [siteData, setSiteData] = useState(false);
  const [cache, setCache] = useState(false);
  const [downloads, setDownloads] = useState(false);
  const clearData = () => { const now = Date.now(); const to = range === 'all' ? Number.MAX_SAFE_INTEGER : now; const from = range === 'all' ? 0 : now - (range === 'hour' ? 3600000 : 86400000); void act(() => cave.clearData({ from, to, history, siteData, cache, downloads }), 'clear-data'); };
  const clearSite = async () => { const target = state.site; if (!host) return; if (await confirm(t('set.privacy.clearTitle', {host}), t('set.privacy.clearBody', {host}), t('set.privacy.clear'))) await act(() => cave.clearSite(target), 'clear-site'); };
  const resetEnv = async () => { if (await confirm(t('set.privacy.resetTitle'), t('set.privacy.resetBody'), t('set.privacy.clearAll'), true)) await act(() => cave.resetEnvironment(), 'reset-env'); };
  return <section data-section="privacy" class="entering" hidden={!active}>
    <h2>{t('set.privacy.title')}</h2>
    <div class="group">
      <h3>{t('set.privacy.permissions')}</h3>
      <div class="card">
        <label class="row"><div class="label"><b>{t('set.privacy.local')}</b><small>{t('set.privacy.localHint')}</small></div><input type="checkbox" class="switch" id="allowPrivateNetwork" checked={data.profile.allowPrivateNetwork} onChange={e => act(() => cave.updateProfile({allowPrivateNetwork: e.currentTarget.checked}))} /></label>
        <label class="row"><div class="label"><b>{t('set.privacy.notifications')}</b><small>{t('set.privacy.restartHint')}</small></div><input type="checkbox" class="switch" id="notifications" checked={data.profile.notifications} onChange={e => act(() => cave.updateProfile({notifications: e.currentTarget.checked}))} /></label>
      </div>
    </div>
    <div class="group">
      <h3>{t('set.permissions.title')}</h3>
      <div class="card" id="site-permissions">
        {!data.permissions.length && <div class="row">{t('set.permissions.empty')}</div>}
        {data.permissions.map(p => <div class="row"><Icon name="shield-check" /><div class="label"><b>{p.origin}</b><small>{t(permissionLabels[p.permission])} · {t(p.decision === 'allow' ? 'set.permissions.allow' : 'set.permissions.deny')}</small></div><button class="icon-btn" title={t('set.permissions.remove')} aria-label={t('set.permissions.remove')} onClick={() => act(() => cave.removePermission(p.origin, p.permission))}><Icon name="trash-2" /></button></div>)}
      </div>
    </div>
    <div class="group">
      <h3>{t('set.ua.title')} <span class="hint">{t('set.ua.hint')}</span></h3>
      <div class="card" id="site-ua-list">
        {!data.uaOverrides.length && <div class="row">{t('set.ua.empty')}</div>}
        {data.uaOverrides.map(entry => <div class="row">
          <Icon name="globe" />
          <div class="label">
            <b>{entry.origin}</b>
            <small>{builtinUa(entry.origin) ? t('set.ua.builtin', { mode: uaModeLabel(builtinUa(entry.origin)!) }) : t('set.ua.defaultChromium')}</small>
          </div>
          <select aria-label={`${t('set.ua.title')} ${entry.origin}`} value={entry.mode} onChange={e => act(() => cave.setSiteUa(entry.origin, e.currentTarget.value as UaPreference))}>
            <option value="chromium">Chromium</option>
            <option value="chrome">Chrome</option>
            <option value="electron">Electron</option>
          </select>
          <button class="icon-btn" title={t('set.ua.reset')} aria-label={t('set.ua.reset')} onClick={() => act(() => cave.setSiteUa(entry.origin, 'default'))}><Icon name="trash-2" /></button>
        </div>)}
      </div>
    </div>
    <div class="group">
      <h3>{t('set.privacy.data')} <span class="hint">{t('set.privacy.dataHint')}</span></h3>
      <div class="card" id="clear-data">
        
        <label class="row">{t('clear_range')} <select value={range} onChange={e => setRange(e.currentTarget.value)}><option value="hour">{t('clear_hour')}</option><option value="day">{t('clear_day')}</option><option value="all">{t('clear_all')}</option></select></label>
        <label class="row">{t('clear_history')}<input type="checkbox" checked={history} onChange={e => setHistory(e.currentTarget.checked)} /></label>
        <label class="row">{t('clear_site_data')}<input type="checkbox" checked={siteData} onChange={e => setSiteData(e.currentTarget.checked)} /></label>
        <label class="row">{t('clear_cache')}<input type="checkbox" checked={cache} onChange={e => setCache(e.currentTarget.checked)} /></label>
        <label class="row">{t('clear_downloads')}<input type="checkbox" checked={downloads} onChange={e => setDownloads(e.currentTarget.checked)} /></label>
        <div class="row"><span>{t('clear_note')}</span><button class="btn" disabled={busy.has('clear-data') || !(history || siteData || cache || downloads)} onClick={clearData}>{t('clear_title')}</button></div>
      </div>
      <div class="card">
        <div class="row"><div class="label"><b>{t('set.privacy.current')}<span id="site-name">{host || '—'}</span></b><small>{t('set.privacy.currentHint')}</small></div><button id="clear-site" class="btn" disabled={!host || busy.has('clear-site')} onClick={clearSite}><Icon name="trash-2" />{t('set.privacy.clearSite')}</button></div>
        <div class="row"><div class="label"><b>{t('set.privacy.reset')}</b><small>{t('set.privacy.resetHint')}</small></div><button id="reset-env" disabled={busy.has('reset-env')} onClick={resetEnv} class="btn danger">{t('set.privacy.resetButton')}</button></div>
      </div>
    </div>
  </section>;
}

function DownloadsSection({ active, state, data, act, confirm, checks, runChecks, busy }: Props) {
  return <section data-section="downloads" class="entering" hidden={!active}>
    <h2>{t('set.downloads.title')}</h2>
    <div class="card"><ul id="downloads" class="downloads">{!state.downloads.length && <li class="empty">{t('downloads_empty')}</li>}{state.downloads.map(d => <li><Icon name="file" /><span class="download-copy"><span class="name" title={d.name}>{d.name}</span><span class="state">{d.state === 'progressing' ? `${d.paused ? t('download_paused') + ' · ' : ''}${d.total ? Math.round(d.received / d.total * 100) : 0}%` : {completed:t('set.downloads.completed'), cancelled:t('set.downloads.cancelled'), interrupted:t('set.downloads.interrupted')}[d.state]}</span></span>{d.state === 'progressing' ? <><button class="icon-btn" title={d.paused ? t('download_resume') : t('download_pause')} aria-label={d.paused ? t('download_resume') : t('download_pause')} onClick={() => cave.downloadAction(d.id, d.paused ? 'resume' : 'pause')}><Icon name={d.paused ? 'play' : 'pause'} /></button><button class="icon-btn" title={t('download_cancel')} aria-label={t('download_cancel')} onClick={() => cave.downloadAction(d.id, 'cancel')}><Icon name="x" /></button></> : <>{d.state === 'completed' && <><button class="icon-btn" disabled={!d.exists} title={!d.exists ? t('download_missing') : t('download_open')} aria-label={t('download_open')} onClick={() => cave.downloadAction(d.id, 'open')}><Icon name="external-link" /></button><button class="icon-btn" disabled={!d.exists} title={t('download_reveal')} aria-label={t('download_reveal')} onClick={() => cave.downloadAction(d.id, 'reveal')}><Icon name="folder-open" /></button>{!d.exists && <small>{t('download_missing')}</small>}</>}<button class="icon-btn" title={t('download_remove')} aria-label={t('download_remove')} onClick={() => cave.downloadAction(d.id, 'remove')}><Icon name="trash-2" /></button></>}</li>)}</ul>{state.downloads.some(d => d.state !== 'progressing') && <button class="btn" onClick={() => state.downloads.filter(d => d.state !== 'progressing').forEach(d => void cave.downloadAction(d.id, 'remove'))}>{t('downloads_clear')}</button>}</div>
  </section>;
}

function AppearanceSection({ active, state, data, act, confirm, checks, runChecks, busy }: Props) {
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => { const media = matchMedia('(prefers-color-scheme: dark)'); const change = () => setDark(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  const [kind, setKind] = useState<SearchEngine['kind']>(state.searchEngine.kind);
  const [template, setTemplate] = useState(state.searchEngine.kind === 'custom' ? state.searchEngine.template : '');
  const [error, setError] = useState<'invalid' | 'failed' | null>(null);
  const form = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);
  const latest = useRef(state.searchEngine);
  latest.current = state.searchEngine;
  const sync = (engine: SearchEngine) => {
    setKind(engine.kind);
    setTemplate(engine.kind === 'custom' ? engine.template : '');
  };
  useEffect(() => {
    if (!dirty.current && !form.current?.contains(document.activeElement)) sync(state.searchEngine);
  }, [state.searchEngine]);
  const save = async (engine: SearchEngine) => {
    if (!isSearchEngine(engine)) { setError('invalid'); dirty.current = true; return; }
    try {
      if (!await cave.setSearchEngine(engine)) throw new Error();
      dirty.current = false; setError(null);
    } catch { dirty.current = true; setError('failed'); }
  };
  return <section data-section="appearance" class="entering" hidden={!active}>
    <h2>{t('set.appearance.title')}</h2>
    <div class="group">
      <h3>{t('set.appearance.colors')}</h3>
      <div class="card">
        <div class="row"><div class="label"><b>{t('set.appearance.mode')}</b><small>{state.theme === 'system' ? t('set.appearance.following', { mode: t(dark ? 'set.appearance.dark' : 'set.appearance.light') }) : t(state.theme === 'dark' ? 'set.appearance.alwaysDark' : 'set.appearance.alwaysLight')}</small></div><ThemePicker value={state.theme} onChange={mode => cave.setTheme(mode)} label={t('set.appearance.mode')} /></div>
        <div class="row"><div class="label"><b>{t('set.appearance.accent')}</b><small>{t('set.appearance.currentAccent', { name: t(`set.accent.${state.accent}`) })}{state.accent === 'teal' ? t('set.appearance.defaultAccent') : ''}</small></div><div class="accent-picker" role="radiogroup" aria-label={t('set.appearance.accent')}>{ACCENTS.map(accent => <label class={`swatch ${accent}`} title={t(`set.accent.${accent}`)}><input type="radio" name="accent" value={accent} aria-label={t(`set.accent.${accent}`)} checked={state.accent === accent} onChange={() => cave.setAccent(accent)} /><span /></label>)}</div></div>
      </div>
    </div>
    <div class="group">
      <h3>{t('set.appearance.tabs')}</h3>
      <div class="card" id="tab-layout">
        <label class="row"><span><Icon name="panel-top" /></span><div class="label"><b>{t('set.appearance.top')}</b><small>{t('set.appearance.topHint')}</small></div><input type="radio" name="tabLayout" value="top" checked={state.tabLayout === 'top'} onChange={() => cave.setTabLayout('top')} /></label>
        <label class="row"><span><Icon name="panel-left" /></span><div class="label"><b>{t('set.appearance.side')}</b><small>{t('set.appearance.sideHint')}</small></div><input type="radio" name="tabLayout" value="side" checked={state.tabLayout === 'side'} onChange={() => cave.setTabLayout('side')} /></label>
      </div>
      <div class="card"><label class="row"><span class="label"><b>{t('set.restoreSession')}</b></span><input id="restore-session" type="checkbox" class="switch" checked={state.restoreSession} onChange={e => cave.setRestoreSession(e.currentTarget.checked)} /></label></div>
    </div>
    <div class="group"><h3>{t('set.appearance.language')}</h3><div class="card"><label class="row"><div class="label"><b>{t('set.appearance.language')}</b></div><select id="ui-locale" value={state.localePreference} onChange={e => cave.setLocale(e.currentTarget.value as LocalePreference)}><option value="system">{t('set.appearance.system')}</option><option value="zh">{t('set.appearance.chinese')}</option><option value="en">English</option></select></label></div></div>
    <div class="group" ref={form} onFocusOut={() => {
      setTimeout(() => { if (!form.current?.contains(document.activeElement) && !dirty.current) sync(latest.current); }, 0);
    }}>
      <h3>{t('set.search.title')}</h3><div class="card">
        <label class="row"><span class="label"><b>{t('set.search.title')}</b></span><select value={kind} onChange={e => {
          const next = e.currentTarget.value as SearchEngine['kind']; setKind(next); setError(null);
          if (next === 'custom') dirty.current = true;
          else void save({ kind: next });
        }}>{SEARCH_PRESETS.map(p => <option value={p.id}>{p.label}</option>)}<option value="custom">{t('set.search.custom')}</option></select></label>
        {kind === 'custom' && <form onSubmit={e => { e.preventDefault(); void save({ kind: 'custom', template }); }}>
          <label class="row"><span class="label"><b>{t('set.search.template')}</b></span><input value={template} onInput={e => { dirty.current = true; setTemplate(e.currentTarget.value); setError(null); }} /></label>
          <div class="row"><button class="btn" type="submit">{t('set.env.save')}</button></div>
        </form>}
        {error && <p class="search-error" role="alert">{error === 'invalid' ? t('set.search.invalid', { query: '{query}' }) : t('set.search.failed')}</p>}
      </div>
    </div>
  </section>;
}

function AdvancedSection({ active, state, data, act, confirm, checks, runChecks, busy }: Props) {
  return <section data-section="advanced" class="entering" hidden={!active}>
    <h2>{t('set.advanced.title')}</h2>
    <div class="card">
      <div class="row"><div class="label"><b>{t('set.advanced.folder')}</b><small id="profile-dir">{data.profileDir}</small></div><button id="reveal" onClick={() => cave.revealProfile()} class="btn"><Icon name="folder-open" />{t('set.advanced.open')}</button></div>
    </div>
  </section>;
}

const sections: Record<SettingsSection, typeof OverviewSection> = {overview: OverviewSection, nodes: NodesSection, env: EnvSection, privacy: PrivacySection, downloads: DownloadsSection, appearance: AppearanceSection, advanced: AdvancedSection};

export function SettingsView() {
  const state = useCave();
  const [data, setData] = useState<PanelData | null>(null), [checks, setChecks] = useState<CheckItem[]>([]);
  const [section, setSection] = useState<SettingsSection>('overview'), [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const contentRef = useRef<HTMLElement>(null);
  const refresh = async () => setData(await cave.panelData());
  const runChecks = async () => setChecks(await cave.runChecks());
  const act = async (fn: () => Promise<unknown>, key?: string) => { if (key) setBusy(prev => new Set(prev).add(key)); try { await fn(); setNotice(null); } catch (err: any) { setNotice(String(err.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); } finally { if (key) setBusy(prev => { const next = new Set(prev); next.delete(key); return next; }); await refresh(); } };
  const confirm = (title: string, body: string, ok: string, danger = false) => new Promise<boolean>(resolve => setDialog({title, body, ok, danger, resolve}));
  useEffect(() => { cave.on('section', setSection); void refresh(); void runChecks(); }, []);
  useEffect(() => { if (state) void refresh(); }, [state]);
  useEffect(() => { if (state) void runChecks(); }, [state?.gate.state, state?.locale]);
  useEffect(() => { setNotice(state?.notice ?? null); }, [state?.notice]);
  useEffect(() => { contentRef.current?.scrollTo(0, 0); void refresh(); }, [section]);
  if (!state || !data) return null;
  setLocale(state.locale);
  document.documentElement.lang = state.locale === 'zh' ? 'zh-CN' : 'en';
  const nav: [SettingsSection, string, string][] = [['overview','shield-check',t('set.overview.title')], ['nodes','network',t('set.nodes.title')], ['env','fingerprint',t('set.env.title')], ['privacy','database',t('set.privacy.title')], ['downloads','download',t('set.downloads.title')], ['appearance','palette',t('set.appearance.title')], ['advanced','wrench',t('set.advanced.title')]];
  return <><nav id="nav" aria-label={t('set.nav.label')}><h1>{t('set.nav.settings')}</h1>{nav.map(([id, icon, label]) => <a data-section={id} tabindex={0} role="button" aria-current={section === id ? 'page' : undefined} class={section === id ? 'current' : ''} onClick={() => setSection(id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSection(id); } }}><Icon name={icon} />{label}</a>)}</nav><main ref={contentRef} id="content"><div id="restart-banner" class="banner" hidden={!data.restartNeeded}><Icon name="triangle-alert" /><span>{t('set.restart.banner')}</span><button id="restart-app" class="btn" onClick={() => cave.restart()}>{t('set.restart.now')}</button></div><p id="notice" class="banner" hidden={!notice}>{notice ?? ''}</p>{Object.entries(sections).map(([id, Component]) => <Component active={section === id} state={state} data={data} act={act} confirm={confirm} checks={checks} runChecks={runChecks} busy={busy} />)}</main><SettingsDialog request={dialog} onClose={() => setDialog(null)} /></>;
}
