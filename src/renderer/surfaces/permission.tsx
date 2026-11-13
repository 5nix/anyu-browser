import { useLayoutEffect, useRef } from 'preact/hooks';
import { t } from '../../shared/i18n/index.ts';
import type { Permission, ShellState } from '../../shared/ipc.ts';
import { cave } from '../bridge.ts';
import { Icon, Surface } from '../ui/index.tsx';

const labels: Record<Permission, Parameters<typeof t>[0]> = {
  'media-camera': 'permission_camera', 'media-microphone': 'permission_microphone',
  geolocation: 'permission_location', notifications: 'permission_notifications', 'clipboard-read': 'permission_clipboard_read',
};
export function PermissionPrompt({ state, open }: { state: ShellState; open: boolean }) {
  const deny = useRef<HTMLButtonElement>(null);
  const prompt = state.permissionPrompt;
  useLayoutEffect(() => { if (open) deny.current?.focus(); }, [prompt?.id, open]);
  if (!prompt) return null;
  return <Surface name="permission" anchor={state.surface!.anchor} placement="center" open={open}>
    <h2 id="title" class="prompt-heading"><Icon name="shield" /><span>{prompt.origin}</span></h2>
    <p>{t('permission_request_body', { permissions: prompt.permissions.map(p => t(labels[p])).join(', ') })}</p>
    {prompt.error && <p role="alert">{t('permission_save_failed')}</p>}
    <div class="actions" onKeyDown={e => {
      if (!['Tab', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const buttons = Array.from(e.currentTarget.querySelectorAll('button'));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const step = e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1;
      e.preventDefault(); buttons[(index + step + buttons.length) % buttons.length]?.focus();
    }}><button ref={deny} class="btn" onClick={() => cave.respondPermission(prompt.id, 'deny')}>{t('permission_deny')}</button><button class="btn" onClick={() => cave.respondPermission(prompt.id, 'once')}>{t('permission_allow_once')}</button><button class="btn primary" onClick={() => cave.respondPermission(prompt.id, 'allow')}>{t('permission_allow')}</button></div>
  </Surface>;
}
