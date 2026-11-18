import { useState } from 'preact/hooks';
import type { ShellState } from '../../shared/ipc.ts';
import { MAX_PROFILE_NAME_LENGTH } from '../../shared/profiles.ts';
import { t } from '../../shared/i18n/index.ts';
import { cave } from '../bridge.ts';
import { Icon, Surface } from '../ui/index.tsx';

export function Profiles({ state, open }: { state: ShellState; open: boolean }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [cloneProxyFromCurrent, setCloneProxyFromCurrent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setCreating(false);
    setName('');
    setCloneProxyFromCurrent(true);
    setError(null);
  };

  const handleCreate = async (e: Event) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await cave.createProfile({ name: trimmed, cloneProxyFromCurrent });
      await cave.launchProfile(created.id);
      await cave.closeSurface();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };

  return <Surface name="profiles" anchor={state.surface!.anchor} open={open} prefer={state.tabLayout === 'side' ? 'top' : 'bottom'}>
    <div class="profiles-heading">
      <h2 id="title">{t('profiles_title')}</h2>
      <p class="profiles-hint">{t('profiles_isolatedHint')}</p>
    </div>
    <ul class="profiles-list">
      {state.profiles.map(p => <li key={p.id} class={`profile-item${p.current ? ' current' : ''}`}>
        <span class={`profile-swatch ${p.accent}`} />
        <div class="profile-meta">
          <div class="profile-name-row">
            <b title={p.name}>{p.name}</b>
            {p.current ? <span class="profile-badge current">{t('profiles_current')}</span> : p.running ? <span class="profile-badge running">{t('profiles_running')}</span> : null}
          </div>
          <small>{p.egressCountry ? `${t('egress', { country: p.egressCountry })} · ${p.timezone}` : `${t('profiles_unconfigured')} · ${p.timezone}`}</small>
        </div>
        {!p.current && <div class="profile-item-actions">
          <button class="btn" onClick={() => { void cave.launchProfile(p.id); void cave.closeSurface(); }}>{t('profiles_openSideBySide')}</button>
          <button class="btn primary" onClick={() => void cave.switchProfile(p.id)}>{t('profiles_switch')}</button>
        </div>}
      </li>)}
    </ul>
    {creating && <form class="profiles-create" onSubmit={e => void handleCreate(e)}>
      <input
        autoFocus
        value={name}
        maxLength={MAX_PROFILE_NAME_LENGTH}
        placeholder={t('set.profiles.namePlaceholder')}
        disabled={busy}
        onInput={e => setName(e.currentTarget.value)}
      />
      <label class="profiles-clone">
        <input type="checkbox" checked={cloneProxyFromCurrent} disabled={busy} onChange={e => setCloneProxyFromCurrent(e.currentTarget.checked)} />
        <span>{t('set.profiles.cloneProxy')}</span>
      </label>
      {error && <p class="profiles-error" role="alert">{error}</p>}
      <div class="profiles-create-actions">
        <button type="button" class="btn" disabled={busy} onClick={resetForm}>{t('cancel')}</button>
        <button type="submit" class="btn primary" disabled={busy || !name.trim()}>{t('set.profiles.createAndLaunch')}</button>
      </div>
    </form>}
    <div class="profiles-actions">
      <button class="btn" onClick={() => { if (creating) resetForm(); else setCreating(true); }}><Icon name="plus" />{t('profiles_new')}</button>
      <button id="manage-profiles" class="btn" onClick={() => { void cave.openSettings('env'); void cave.closeSurface(); }}><Icon name="sliders" />{t('profiles_manage')}</button>
    </div>
  </Surface>;
}
