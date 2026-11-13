import { render } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Rect, ShellState, SurfaceName, TabState } from '../shared/ipc.ts';
import { setLocale, t } from '../shared/i18n/index.ts';
import { LIGHTS_WIDTH, METRICS } from '../shared/layout.ts';
import { cave } from './bridge.ts';
import { STATUS_TITLE, status } from './gate.ts';
import { Icon } from './ui/index.tsx';
import { addressDisplay, addressSecurity } from './address-display.ts';
import { completion } from './address-completion.ts';

document.body.classList.add(cave.platform === 'darwin' ? 'mac' : 'win');
for (const [name, px] of Object.entries({ strip: METRICS.strip, tab: METRICS.tab, toolbar: METRICS.toolbar, button: METRICS.button, caption: METRICS.caption, 'side-top': METRICS.sideTop, side: METRICS.side, gap: METRICS.gap, lights: LIGHTS_WIDTH }))
  document.documentElement.style.setProperty(`--${name}`, `${px}px`);

const STATUS_ICON = { open: 'shield-check', checking: 'shield', closed: 'shield-off', paused: 'shield' };
let reported = '';
function reportAnchors() {
  const anchors: Partial<Record<SurfaceName, Rect>> = {};
  for (const el of document.querySelectorAll<HTMLElement>('[data-anchor]')) {
    const r = el.getBoundingClientRect();
    anchors[el.dataset.anchor as SurfaceName] = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  }
  const report = JSON.stringify(anchors);
  if (report === reported) return;
  reported = report;
  void cave.setAnchors(anchors);
}

type DisplayTab = { tab: TabState; leaving: boolean };
function Tabs({ state }: { state: ShellState }) {
  const list = useRef<DisplayTab[]>([]);
  const [, update] = useState(0);
  const tablist = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const pending = useRef<number[] | null>(null);
  const drag = useRef<{ id: number; pointer: number; from: number; destination: number; start: number; position: number; initialScroll: number; horizontal: boolean; moved: boolean; frame: number; nodes: HTMLElement[]; node: HTMLElement; tabs: TabState[] } | null>(null);
  const finish = (commit: boolean) => {
    const d = drag.current, el = tablist.current;
    if (!d || !el) return;
    drag.current = null;
    cancelAnimationFrame(d.frame);
    el.classList.remove('reordering'); d.node.classList.remove('dragging');
    d.nodes.forEach(n => { n.style.transform = ''; });
    if (el.hasPointerCapture(d.pointer)) el.releasePointerCapture(d.pointer);
    if (commit && d.moved && d.destination !== d.from) {
      const order = d.tabs.map(t => t.id);
      order.splice(d.destination, 0, order.splice(d.from, 1)[0]);
      pending.current = order;
      update(n => n + 1);
      void cave.moveTab(d.id, d.destination);
    }
    if (d.moved) { suppressClick.current = true; setTimeout(() => { suppressClick.current = false; }, 0); }
  };
  const paint = (scroll: boolean) => {
    const d = drag.current, el = tablist.current;
    if (!d || !el || !d.moved) return;
    const bounds = el.getBoundingClientRect();
    const edge = d.horizontal ? [bounds.left, bounds.right] : [bounds.top, bounds.bottom];
    const speed = d.position < edge[0] + 28 ? -8 : d.position > edge[1] - 28 ? 8 : 0;
    if (scroll) { if (d.horizontal) el.scrollLeft += speed; else el.scrollTop += speed; }
    const currentScroll = d.horizontal ? el.scrollLeft : el.scrollTop;
    const candidates = d.nodes.map((n, i) => ({ i, center: (d.horizontal ? bounds.left + el.clientLeft + n.offsetLeft - el.offsetLeft + n.offsetWidth / 2 - currentScroll : bounds.top + el.clientTop + n.offsetTop - el.offsetTop + n.offsetHeight / 2 - currentScroll) })).filter(x => d.tabs[x.i].pinned === d.tabs[d.from].pinned);
    d.destination = candidates.reduce((best, x) => d.position > x.center ? x.i : best, candidates[0].i);
    const size = (d.horizontal ? d.node.offsetWidth : d.node.offsetHeight) + 2;
    // The dragged tab stops at the first and last slot it may take.
    const offset = (n: HTMLElement) => d.horizontal ? n.offsetLeft : n.offsetTop;
    const first = d.nodes[candidates[0].i], last = d.nodes[candidates[candidates.length - 1].i];
    const lower = offset(first) - offset(d.node), upper = offset(last) + (d.horizontal ? last.offsetWidth - d.node.offsetWidth : last.offsetHeight - d.node.offsetHeight) - offset(d.node);
    d.nodes.forEach((n, i) => {
      const shift = i === d.from ? Math.max(lower, Math.min(upper, d.position - d.start + currentScroll - d.initialScroll)) : d.from < d.destination && i > d.from && i <= d.destination ? -size : d.from > d.destination && i >= d.destination && i < d.from ? size : 0;
      n.style.transform = d.horizontal ? `translateX(${shift}px)` : `translateY(${shift}px)`;
    });
  };
  const startDrag = (e: PointerEvent) => {
    const target = e.target as HTMLElement, node = target.closest<HTMLElement>('.tab'), el = tablist.current;
    if (drag.current || e.button !== 0 || !node || !el || target.closest('button') || node.classList.contains('leaving')) return;
    const nodes = [...el.querySelectorAll<HTMLElement>('.tab:not(.leaving)')];
    const tabs = next.filter(x => !x.leaving).map(x => x.tab), from = nodes.indexOf(node), tab = tabs[from];
    if (!tab) return;
    const horizontal = state.tabLayout === 'top', start = horizontal ? e.clientX : e.clientY;
    drag.current = { id: tab.id, pointer: e.pointerId, from, destination: from, start, position: start, initialScroll: horizontal ? el.scrollLeft : el.scrollTop, horizontal, moved: false, frame: 0, nodes, node, tabs };
    el.setPointerCapture(e.pointerId);
    void cave.activate(tab.id);
  };
  const moveDrag = (e: PointerEvent) => {
    const d = drag.current, el = tablist.current;
    if (!d || !el || d.pointer !== e.pointerId) return;
    d.position = d.horizontal ? e.clientX : e.clientY;
    if (!d.moved && Math.abs(d.position - d.start) >= 4) {
      d.moved = true; el.classList.add('reordering'); d.node.classList.add('dragging');
      const tick = () => { if (!drag.current) return; paint(true); if (drag.current) drag.current.frame = requestAnimationFrame(tick); };
      tick();
    } else if (d.moved) paint(false);
  };
  useLayoutEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && drag.current) { e.preventDefault(); finish(false); } };
    // No cancel on blur: pressing a tab activates it and focus moves to the page, which blurs this
    // document mid-press. A press that really ends elsewhere arrives as pointercancel.
    addEventListener('keydown', key);
    return () => { finish(false); removeEventListener('keydown', key); };
  }, []);
  useLayoutEffect(() => {
    const el = tablist.current;
    if (!el) return;
    const sync = () => {
      const top = state.tabLayout === 'top';
      el.parentElement?.classList.toggle('overflowing', top ? el.scrollWidth > el.clientWidth : el.scrollHeight > el.clientHeight);
      el.classList.toggle('more-above', top ? el.scrollLeft > 0 : el.scrollTop > 0);
      el.classList.toggle('more-below', top ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    };
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    const wheel = (e: WheelEvent) => { if (state.tabLayout === 'top' && el.scrollWidth > el.clientWidth) { el.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; e.preventDefault(); } };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('scroll', sync);
    sync();
    return () => { observer.disconnect(); el.removeEventListener('scroll', sync); el.removeEventListener('wheel', wheel); };
  });
  useLayoutEffect(() => {
    if (!drag.current) tablist.current?.querySelector<HTMLElement>('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [state.active, state.tabLayout]);
  const ids = state.tabs.map(t => t.id);
  if (pending.current && (pending.current.every((id, i) => ids[i] === id) || pending.current.length !== ids.length || pending.current.some(id => !ids.includes(id)))) pending.current = null;
  const ordered = pending.current ? pending.current.map(id => state.tabs.find(t => t.id === id)!) : state.tabs;
  const open = new Set(state.tabs.map((t) => t.id));
  const leaving = list.current.filter((item) => !open.has(item.tab.id)).map((item) => ({ ...item, leaving: true }));
  // Keep departing nodes at their previous positions while their exit animation runs.
  const next: DisplayTab[] = ordered.map((tab) => ({ tab, leaving: false }));
  for (const item of leaving) {
    const index = list.current.findIndex((old) => old.tab.id === item.tab.id);
    next.splice(Math.min(index, next.length), 0, item);
  }
  list.current = next;
  return <div id="tabs">
    <div id="tablist" ref={tablist} role="tablist" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={e => { if (drag.current?.pointer === e.pointerId) { moveDrag(e); paint(false); finish(true); } }} onPointerCancel={() => finish(false)} onLostPointerCapture={() => finish(false)} onClickCapture={e => { if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); } }} onContextMenuCapture={e => { if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); } }}>{next.map(({ tab, leaving }) => <Tab key={tab.id} tab={tab} active={tab.id === state.active} leaving={leaving} remove={() => {
      list.current = list.current.filter((item) => item.tab.id !== tab.id);
      update((n) => n + 1);
    }} />)}</div>
    <button id="new-tab" class="icon-btn" title={t('newTabTooltip')} onClick={() => cave.run('tab.new')}><Icon name="plus" /><span class="label">{t('newTab')}</span></button>
  </div>;
}
function Tab({ tab, active, leaving, remove }: { tab: TabState; active: boolean; leaving: boolean; remove: () => void }) {
  const [entering, setEntering] = useState(true);
  return <div data-tab-id={tab.id} class={`tab${tab.pinned ? ' pinned' : ''}${entering ? ' entering' : ''}${active ? ' active' : ''}${leaving ? ' leaving' : ''}`} role="tab" tabIndex={0} aria-selected={active} title={tab.title}
    onContextMenu={(e) => { e.preventDefault(); if (!leaving) void cave.openTabMenu(tab.id, { x: e.clientX, y: e.clientY, width: 0, height: 0 }); }}
    onKeyDown={(e) => { if (!leaving && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); const x = Math.max(0, r.x), y = Math.max(0, r.y); void cave.openTabMenu(tab.id, { x, y, width: Math.max(0, Math.min(innerWidth, r.right) - x), height: Math.max(0, Math.min(innerHeight, r.bottom) - y) }); } }}
    onAnimationEnd={(e) => { if (e.target !== e.currentTarget) return; if (leaving) remove(); else { setEntering(false); if (active) e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } }}
    onClick={() => cave.activate(tab.id)} onAuxClick={(e) => { if (e.button === 1) cave.closeTab(tab.id); }}>
    <span class="fav">{tab.kind === 'web' && tab.loading ? <Icon name="loader-circle" className="spin" /> : tab.kind === 'web' && tab.favicon ? <img src={tab.favicon} alt="" /> : <Icon name={tab.kind === 'settings' ? 'settings' : tab.kind === 'history' ? 'history' : tab.kind === 'bookmarks' ? 'bookmark' : 'globe'} />}</span>
    <span class="title">{tab.title}</span>{(tab.audible || tab.muted) && <button class="audio" title={t(tab.muted ? 'tab_unmute' : 'tab_mute')} aria-label={t(tab.muted ? 'tab_unmute' : 'tab_mute')} onClick={(e) => { e.stopPropagation(); void cave.setTabMuted(tab.id, !tab.muted); }}><Icon name={tab.muted ? 'volume-x' : 'volume-2'} /></button>}<button class="close" title={t('command_tab_close')} onClick={(e) => { e.stopPropagation(); cave.closeTab(tab.id); }}><Icon name="x" /></button>
  </div>;
}
function App() {
  const [state, setState] = useState<ShellState | null>(null);
  const previous = useRef<ShellState | null>(null);
  const address = useRef<HTMLInputElement>(null);
  const findBox = useRef<HTMLDivElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const findCount = useRef<HTMLSpanElement>(null);
  const [findText, setFindText] = useState('');
  const editing = useRef(false);
  const session = useRef<string | null>(null);
  const sequence = useRef(0);
  const queryVersion = useRef(0);
  const results = useRef<import('../shared/ipc.ts').AddressSuggestion[]>([]);
  const selected = useRef(-1);
  const draft = useRef('');
  const composing = useRef(false);
  const addressMenuOpen = useRef(false);
  const mayComplete = useRef(false);
  const query = async (text: string) => {
    const version = ++queryVersion.current;
    const token = session.current;
    if (!token) return;
    const n = ++sequence.current; results.current = []; selected.current = -1;
    const result = await cave.suggestAddress(token, n, text);
    if (version !== queryVersion.current || token !== session.current || composing.current || address.current?.value !== text) return;
    results.current = result.items; selected.current = -1; draft.current = text;
    const el = address.current;
    if (mayComplete.current && el && el.selectionStart === text.length && el.selectionEnd === text.length) {
      const completed = completion(text, result.items);
      if (completed) { el.value = completed; el.setSelectionRange(text.length, completed.length); }
    }
  };
  const [, refreshAddress] = useState(0);
  useLayoutEffect(() => {
    const receive = (s: ShellState) => {
      setLocale(s.locale); document.documentElement.lang = s.locale === 'zh' ? 'zh-CN' : 'en';
      if (!editing.current && s.focus === 'page' && previous.current?.focus !== 'page') (document.activeElement as HTMLElement | null)?.blur();
      if (addressMenuOpen.current && previous.current?.surface?.name === 'contextMenu' && s.surface?.name !== 'contextMenu' && s.focus !== 'chrome') { addressMenuOpen.current = false; editing.current = false; }
      previous.current = s;
      setState(s);
    };
    cave.on('state', receive);
    cave.on('addressResults', r => { if (r.session === session.current && r.sequence === sequence.current) { selected.current = r.active; refreshAddress(n => n + 1); } });
    cave.on('focusAddress', () => { address.current?.focus(); });
    cave.on('cancelAddressEdit', () => { addressMenuOpen.current = false; if (editing.current) address.current?.blur(); });
    cave.on('openFind', () => { if (findBox.current && findInput.current) { findBox.current.hidden = false; findInput.current.focus(); findInput.current.select(); } });
    cave.on('resetFind', () => { if (findBox.current) findBox.current.hidden = true; if (findInput.current) findInput.current.value = ''; if (findCount.current) findCount.current.textContent = ''; setFindText(''); });
    cave.on('found', (r) => { if (r.tabId === previous.current?.active && findCount.current && findInput.current?.value === r.query && !findBox.current?.hidden) findCount.current.textContent = t('findCount', { active: r.active, total: r.total }); });
    void cave.getState().then(receive);
    const pointer = (e: PointerEvent) => { if (editing.current && !(e.target as Element).closest('#address-form')) address.current?.blur(); };
    document.addEventListener('pointerdown', pointer, true);
    const observer = new ResizeObserver(reportAnchors); observer.observe(document.body);
    addEventListener('resize', reportAnchors);
    return () => { document.removeEventListener('pointerdown', pointer, true); observer.disconnect(); removeEventListener('resize', reportAnchors); };
  }, []);
  const active = state?.tabs.find((t) => t.id === state.active);
  useLayoutEffect(() => {
    if (!state) return;
    document.documentElement.style.setProperty('--side', `${state.sidebarWidth}px`);
    document.body.classList.toggle('top', state.tabLayout === 'top');
    document.body.classList.toggle('side', state.tabLayout === 'side');
    document.body.classList.toggle('covered', !!state.surface);
    document.documentElement.style.setProperty('--traffic-light-x', `${state.trafficLightPosition?.x ?? 0}px`);
    if (!editing.current && address.current) address.current.value = active?.kind === 'settings' ? '' : addressDisplay(active?.url ?? '').full;
    reportAnchors();
  });
  const closeFind = () => {
    if (findBox.current) findBox.current.hidden = true;
    if (findCount.current) findCount.current.textContent = '';
    cave.stopFind(true); void cave.focusPage();
  };
  const stepFind = (forward: boolean) => {
    if (!findInput.current?.value) return;
    if (findCount.current) findCount.current.textContent = '';
    void cave.find(findInput.current.value, forward);
  };
  const value = active?.url ?? '';
  const display = addressDisplay(value);
  const settings = active?.kind === 'settings';
  const security = addressSecurity(active);
  const indicator = { https: ['globe', 'addressHttps'], http: ['triangle-alert', 'addressInsecure'], exception: ['shield-alert', 'addressException'], internal: ['settings', 'addressInternal'], unknown: ['info', 'addressUnknown'] } as const;
  const [indicatorIcon, indicatorLabel] = indicator[security];
  const st = state && status(state.gate);
  const running = state?.downloads.filter((d) => d.state === 'progressing').length ?? 0;
  return <>
    <div id="drag-bar" class="drag" /><div id="drag-side" class="drag" /><div id="sheet" />
    {state?.tabLayout === 'side' && <div id="side-resize" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) void cave.setSidebarWidth(e.clientX); }} onDblClick={() => cave.setSidebarWidth(METRICS.side)} />}
    <nav id="nav">
      <button id="back" class="icon-btn" title={t('command_page_back')} disabled={!active?.canBack} onClick={() => cave.run('page.back')}><Icon name="arrow-left" /></button>
      <button id="forward" class="icon-btn" title={t('command_page_forward')} disabled={!active?.canForward} onClick={() => cave.run('page.forward')}><Icon name="arrow-right" /></button>
      <button id="reload" class="icon-btn" title={active?.loading ? t('stop') : t('command_page_reload')} disabled={active?.kind !== 'web'} onClick={() => cave.run(active?.loading ? 'page.stop' : 'page.reload')}><Icon name={active?.loading ? 'x' : 'rotate-cw'} /></button>
    </nav>
    <form id="address-form" data-anchor="suggestions" onSubmit={(e) => { e.preventDefault(); if (composing.current) return; if (!session.current) { const input = address.current!.value; editing.current = false; if (input.trim()) void cave.navigate(input); else void cave.focusPage(); address.current!.blur(); return; } const token = session.current; session.current = null; editing.current = false; if (selected.current >= 0 && results.current[selected.current]) void cave.chooseAddress(token, sequence.current, results.current[selected.current].id); else void cave.submitAddress(token, address.current!.value); address.current!.blur(); }}>
      <button type="button" id="site-icon" data-anchor="siteInfo" aria-label={t('siteInfo_title')} title={t(indicatorLabel)} aria-expanded={state?.surface?.name === 'siteInfo'} onClick={() => cave.toggleSurface('siteInfo')}>{!editing.current && active?.kind === 'web' && !active.loading && active.favicon ? <img src={active.favicon} alt="" /> : <Icon name={indicatorIcon} />}</button>
      <input ref={address} id="address" spellcheck={false} autocomplete="off" placeholder={t('addressPlaceholder')} class={!editing.current && (settings || value) ? 'viewing' : ''}
        role="combobox" aria-expanded={state?.surface?.name === 'suggestions'} aria-autocomplete="list"
        onContextMenu={e => { e.preventDefault(); addressMenuOpen.current = true; void cave.openAddressMenu({ x: e.clientX, y: e.clientY, width: 0, height: 0 }); }}
        onFocus={() => { const returningFromMenu = addressMenuOpen.current; addressMenuOpen.current = false; editing.current = true; refreshAddress(n => n + 1); if (!returningFromMenu) address.current?.select(); const el = address.current; void cave.beginAddress().then(start => { if (!editing.current || address.current !== el) { void cave.cancelAddress(start.session, 'none'); return; } session.current = start.session; sequence.current = 0; results.current = []; selected.current = -1; if (el && el.value !== start.initial) void query(el.value); }); }}
        onBlur={e => { if (addressMenuOpen.current) return; e.currentTarget.setSelectionRange(0, 0); editing.current = false; refreshAddress(n => n + 1); const token = session.current; session.current = null; if (token) void cave.cancelAddress(token, 'none'); }}
        onBeforeInput={e => { const input = e.currentTarget; const event = e as InputEvent; mayComplete.current = !composing.current && event.inputType === 'insertText' && input.selectionStart === input.value.length && input.selectionEnd === input.value.length; }}
        onInput={e => { if (!composing.current) void query(e.currentTarget.value); }}
        onCompositionStart={() => { composing.current = true; mayComplete.current = false; queryVersion.current++; }}
        onCompositionEnd={e => { composing.current = false; void query(e.currentTarget.value); }}
        onKeyDown={e => {
          if (composing.current || e.isComposing) return;
          if (e.key === 'Backspace' || e.key === 'Delete') { mayComplete.current = false; queryVersion.current++; }
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && results.current.length) {
            e.preventDefault(); const count = results.current.length;
            selected.current = e.key === 'ArrowDown' ? (selected.current + 2) % (count + 1) - 1 : (selected.current + count + 1) % (count + 1) - 1;
            refreshAddress(n => n + 1);
            if (session.current) void cave.selectAddress(session.current, sequence.current, selected.current);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.currentTarget.value = active?.kind === 'settings' ? '' : addressDisplay(active?.url ?? '').full; const token = session.current; session.current = null; editing.current = false; if (token) void cave.cancelAddress(token, 'page'); else void cave.focusPage(); e.currentTarget.blur();
          }
        }} />
      <span aria-live="polite" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">{selected.current >= 0 ? results.current[selected.current]?.title : ''}</span>
      <span id="address-view" aria-hidden="true"><b id="address-host">{settings ? t('caveSettings') : display.host}</b><span id="address-rest">{display.rest}</span></span>
      {state && state.zoom !== 100 && <button id="zoom-reset" type="button" title={t('zoomReset', { percent: state.zoom })} aria-label={t('zoomReset', { percent: state.zoom })} onClick={() => cave.run('zoom.reset')}>{state.zoom}%</button>}
      <button id="bookmark" type="button" class={`icon-btn${state?.bookmarked ? ' bookmarked' : ''}`} title={t('command_bookmark_toggle')} aria-label={t('command_bookmark_toggle')} data-anchor="bookmarkEdit" onClick={() => cave.run('bookmark.toggle')}><Icon name="star" /></button>
      {state?.zoomError && <span id="zoom-error" role="status">{t('zoomSaveFailed')}</span>}
    </form>
    <div id="find" ref={findBox} hidden><input id="find-input" ref={findInput} placeholder={t('findPlaceholder')} spellcheck={false}
      onKeyDown={(e) => { if (e.key === 'Enter') stepFind(!e.shiftKey); if (e.key === 'Escape') closeFind(); }}
      maxLength={4096} onInput={(e) => { setFindText(e.currentTarget.value); if (findCount.current) findCount.current.textContent = ''; if (e.currentTarget.value) cave.find(e.currentTarget.value, true); else cave.stopFind(); }} /><span id="find-count" ref={findCount} />
      <button id="find-previous" class="icon-btn" title={t('findPrevious')} aria-label={t('findPrevious')} disabled={!findText} onClick={() => stepFind(false)}><Icon name="chevron-up" /></button>
      <button id="find-next" class="icon-btn" title={t('findNext')} aria-label={t('findNext')} disabled={!findText} onClick={() => stepFind(true)}><Icon name="chevron-down" /></button>
      <button id="find-close" class="icon-btn" title={t('closeFind')} onClick={closeFind}><Icon name="x" /></button></div>
    <div id="tools">
      <button id="downloads" class="icon-btn" title={t('downloads')} aria-label={t('downloads')} data-anchor="downloads" hidden={!state?.downloads.length} onClick={() => cave.toggleSurface('downloads')}><Icon name="download" /><span id="download-count">{running || ''}</span></button>
      <button id="status" class={`icon-btn${st ? ` ${st}` : ''}${state?.surface?.name === 'status' ? ' on' : ''}`} title={st && state ? state.gate.egress?.node ? `${STATUS_TITLE[st]} · ${state.gate.egress.node}` : STATUS_TITLE[st] : t('networkStatus')} data-anchor="status" onClick={() => cave.toggleSurface('status')}><span class="status-icon">{st && <Icon name={STATUS_ICON[st]} />}<span class="dot" /></span>{state?.tabLayout === 'side' && !state.gate.paused && state.gate.state !== 'closed' && state.gate.egress?.country && <span class="country">{state.gate.egress.country}</span>}</button>
      <button id="menu-button" class="icon-btn" title={t('menu')} aria-label={t('menu')} data-anchor="menu" onClick={() => cave.toggleSurface('menu')}><Icon name="ellipsis" /></button>
    </div>
    {state && <Tabs state={state} />}
  </>;
}
render(<App />, document.body);
