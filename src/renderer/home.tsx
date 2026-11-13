import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../shared/i18n/index.ts';
import { shortcutUrl } from '../shared/shortcut.ts';
import type { Shortcut } from '../shared/ipc.ts';
import { cave } from './bridge.ts';
import { Icon, useCave } from './ui/index.tsx';

function Home() {
  const state = useCave();
  const [editing, setEditing] = useState<Shortcut | 'new' | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [invalid, setInvalid] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [editing]);
  const open = (item: Shortcut | 'new') => { setName(item === 'new' ? '' : item.name); setUrl(item === 'new' ? '' : item.url); setInvalid(false); setEditing(item); };
  const shortcuts = useRef<Shortcut[]>([]);
  shortcuts.current = state?.shortcuts ?? [];
  useEffect(() => { cave.on('shortcutAction', ({ id, action }) => { const item = shortcuts.current.find(s => s.id === id); if (!item) return; if (action === 'edit') open(item); else void cave.removeShortcut(id); }); }, []);
  useEffect(() => { const close = () => { void cave.closeSurface(); }; window.addEventListener('wheel', close, { passive: true }); window.addEventListener('scroll', close, true); return () => { window.removeEventListener('wheel', close); window.removeEventListener('scroll', close, true); }; }, []);
  const save = async () => {
    const valid = shortcutUrl(url);
    if (!valid) { setInvalid(true); return; }
    await cave.saveShortcut({ ...(editing !== 'new' && editing ? { id: editing.id } : {}), name, url: valid });
    dialog.current?.close();
  };
  return <main><div class="home">
    <svg class="home-mark" viewBox="179.36 173.36 665.28 665.28" aria-hidden="true">
      <path d="M228 540C332 560 430 430 512 296C594 430 692 560 796 540Q822 560 796 590C692 614 590 530 512 470C434 530 332 614 228 590Q202 560 228 540Z" fill="currentColor" />
      <path d="M438 642a74 74 0 1 0 148 0a74 74 0 1 0 -148 0Z" fill="currentColor" />
    </svg>
    <form class="search" onSubmit={(e) => { e.preventDefault(); const value = search.current?.value.trim(); if (value) void cave.navigate(value); }}>
      <Icon name="search" /><input ref={search} aria-label={t('homeSearch')} placeholder={t('homeSearch')} />
    </form>
    {state?.setup.pending && state.gate.state !== 'open' && <p class="closed-line"><span class="dot closed" />{t('welcome.home.closed')}<button id="continue-setup" class="btn link" onClick={() => void cave.continueSetup()}>{t('welcome.home.continue')}</button></p>}
    <div class="shortcuts">{state?.shortcuts.map((item) => <div class="tile" key={item.id}>
      <button class="tile-link" onClick={(e) => { if (e.metaKey || e.ctrlKey) void cave.newTab(item.url); else void cave.navigate(item.url); }} onAuxClick={(e) => { if (e.button === 1) void cave.newTab(item.url); }}><span class="avatar">{item.favicon ? <img src={item.favicon} alt="" /> : Array.from(item.name)[0]?.toUpperCase()}</span><span class="tile-name">{item.name}</span></button>
      <button class="more icon-btn" aria-label={t('homeMore')} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); void cave.openShortcutMenu(item.id, { x: r.x, y: r.y, width: r.width, height: r.height }); }}><Icon name="ellipsis" /></button>
    </div>)}{(state?.shortcuts.length ?? 0) < 10 && <button class="tile-link add" onClick={() => open('new')}><span class="avatar"><Icon name="plus" /></span><span class="tile-name">{t('homeAdd')}</span></button>}</div>
  </div><dialog ref={dialog} onClose={() => setEditing(null)} aria-labelledby="dialog-title"><form onSubmit={(e) => { e.preventDefault(); void save(); }}><h2 id="dialog-title">{t(editing === 'new' ? 'homeAdd' : 'homeEdit')}</h2><label>{t('homeName')}<input value={name} onInput={(e) => setName(e.currentTarget.value)} /></label><label>{t('homeUrl')}<input value={url} onInput={(e) => { setUrl(e.currentTarget.value); setInvalid(false); }} aria-invalid={invalid} autoFocus /></label>{invalid && <p class="invalid">{t('homeInvalid')}</p>}<div class="actions"><button type="button" class="btn" onClick={() => dialog.current?.close()}>{t('cancel')}</button><button class="btn primary" type="submit">{t('homeSave')}</button></div></form></dialog></main>;
}
render(<Home />, document.body);
