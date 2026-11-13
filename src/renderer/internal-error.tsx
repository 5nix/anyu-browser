import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t, type TranslationKey } from '../shared/i18n/index.ts';
import { cave } from './bridge.ts';
import { useCave } from './ui/index.tsx';

const explanations: Record<number, TranslationKey> = {
  [-105]: 'error_dns', [-137]: 'error_dns', [-102]: 'error_refused',
  [-101]: 'error_reset', [-7]: 'error_timeout', [-118]: 'error_timeout',
  [-106]: 'error_offline', [-310]: 'error_redirects',
};

function Recovery() {
  const recovery = useCave()?.recovery;
  const [advanced, setAdvanced] = useState(false);
  const advancedButton = useRef<HTMLButtonElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  useEffect(() => { setAdvanced(false); retry.current?.focus(); }, [recovery?.tabId, recovery?.generation]);
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && advanced) { setAdvanced(false); advancedButton.current?.focus(); } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [advanced]);
  if (!recovery) return null;
  const { tabId, generation, kind, code, displayUrl, canRetry, canContinue } = recovery;
  return <main><div class="recovery">
    <h1>{t(kind === 'crash' ? 'error_crashed' : kind === 'gate' ? 'error_gate' : kind === 'certificate' ? 'error_certificate' : 'error_title')}</h1>
    {kind !== 'crash' && <p>{t(kind === 'gate' ? 'error_gate_detail' : kind === 'certificate' ? (code === -201 ? 'error_cert_expired' : code === -200 ? 'error_cert_host' : code === -202 ? 'error_cert_issuer' : 'error_cert_generic') : explanations[code ?? 0] ?? 'error_generic')}</p>}
    {displayUrl && <p class="url">{displayUrl}</p>}
    {code !== null && <p class="code">{code}</p>}
    <div class="actions">{kind === 'certificate' ? <button ref={retry} class="btn primary" onClick={() => void cave.backFromError(tabId, generation)}>{t('error_back')}</button> : <button ref={retry} class="btn primary" disabled={!canRetry} onClick={() => void cave.retryTab(tabId, generation)}>{t(kind === 'crash' ? 'error_reload' : 'error_retry')}</button>}
      {kind === 'certificate' && <button ref={advancedButton} class="btn" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>{t('error_advanced')}</button>}
      {kind === 'gate' && <button class="btn" onClick={() => void cave.recoveryStatus(tabId, generation)}>{t('error_status')}</button>}</div>
    {kind === 'certificate' && advanced && <div class="advanced"><p>{t('error_risk')}</p><button class="btn" disabled={!canContinue} onClick={() => void cave.continueCertificate(tabId, generation)}>{t('error_continue', { host: (() => { try { return new URL(displayUrl).hostname; } catch { return ''; } })() })}</button></div>}
  </div></main>;
}
render(<Recovery />, document.body);
