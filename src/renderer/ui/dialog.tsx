import { t } from '../../shared/i18n/index.ts';
import { useEffect, useRef } from 'preact/hooks';

export interface DialogRequest { title: string; body: string; ok: string; danger: boolean; resolve: (answer: boolean) => void }

export function Dialog({ request, onClose }: { request: DialogRequest | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (request && ref.current && !ref.current.open) { ref.current.returnValue = ''; ref.current.showModal(); } }, [request]);
  return <dialog id="confirm" ref={ref} onClose={() => { request?.resolve(ref.current?.returnValue === 'ok'); onClose(); }}>
    <form method="dialog"><h2 id="confirm-title">{request?.title}</h2><p id="confirm-body">{request?.body}</p>
      <div class="actions"><button value="cancel" class="btn" autoFocus>{t('cancel')}</button><button id="confirm-ok" value="ok" class={request?.danger ? 'btn primary danger' : 'btn primary'}>{request?.ok}</button></div>
    </form>
  </dialog>;
}
