import { useLayoutEffect, useRef } from 'preact/hooks';
import { t } from '../../shared/i18n/index.ts';
import type { ShellState } from '../../shared/ipc.ts';
import { cave } from '../bridge.ts';
import { Icon, Surface } from '../ui/index.tsx';

export function HttpAuthPrompt({ state, open }: { state: ShellState; open: boolean }) {
  const username = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const prompt = state.httpAuthPrompt;
  useLayoutEffect(() => {
    const user = username.current, secret = password.current;
    if (open) { if (user) user.value = ''; if (secret) secret.value = ''; user?.focus(); }
    return () => { if (user) user.value = ''; if (secret) secret.value = ''; };
  }, [prompt?.id, open]);
  if (!prompt) return null;
  return <Surface name="httpAuth" anchor={state.surface!.anchor} placement="center" open={open}>
    <h2 id="title" class="prompt-heading"><Icon name="shield" /><span>{prompt.origin}</span></h2>
    <p>{t('auth_title')}</p>
    {prompt.realm && <p>{t('auth_realm', { realm: prompt.realm })}</p>}
    {prompt.origin.startsWith('http:') && <p class="auth-warning"><Icon name="triangle-alert" />{t('auth_insecure')}</p>}
    {prompt.error && <p role="alert">{t('auth_invalid')}</p>}
    <form onSubmit={e => { e.preventDefault(); void cave.respondHttpAuth(prompt.id, { username: username.current!.value, password: password.current!.value }); }} onKeyDown={e => {
      if (e.key !== 'Tab') return;
      const controls = Array.from(e.currentTarget.querySelectorAll('input, button')) as HTMLElement[];
      const index = controls.indexOf(document.activeElement as HTMLElement);
      e.preventDefault(); controls[(index + (e.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
    }}>
      <label>{t('auth_username')}<input ref={username} autoComplete="off" /></label>
      <label>{t('auth_password')}<input ref={password} type="password" autoComplete="off" /></label>
      <div class="actions"><button type="button" class="btn" onClick={() => cave.respondHttpAuth(prompt.id, null)}>{t('auth_cancel')}</button><button class="btn primary" type="submit">{t('auth_submit')}</button></div>
    </form>
  </Surface>;
}
