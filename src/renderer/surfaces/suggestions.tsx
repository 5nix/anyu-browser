import type { AddressQueryResult, ShellState } from '../../shared/ipc.ts';
import { t } from '../../shared/i18n/index.ts';
import { cave } from '../bridge.ts';
import { Icon, List, Surface } from '../ui/index.tsx';

export function Suggestions({ state, open, result = null }: { state: ShellState; open: boolean; result?: (AddressQueryResult & { active: number }) | null }) {
  const address = result?.session === state.address?.session ? result : null;
  if (!address || !state.surface) return null;
  return <Surface name="suggestions" session={address.session} measureKey={address.sequence} anchor={state.surface.anchor} open={open} label={t('addressSuggestions')}>
    <List label={t('addressSuggestions')} selected={address.active} onHover={index => cave.selectAddress(address.session, address.sequence, index)} onSelect={id => cave.chooseAddress(address.session, address.sequence, id)} items={address.items.map(item => ({ id: item.id, label: item.title, content: <><span class="suggestion-icon">{item.favicon ? <img src={item.favicon} alt="" /> : <Icon name={item.kind === 'search' ? 'search' : 'globe'} />}</span><span class="suggestion-text"><span>{item.kind === 'search' ? t('addressSearchOrGo', { input: item.title }) : item.title || item.url}</span>{item.kind !== 'search' && <small>{item.url}</small>}</span></> }))} />
    {address.unavailable && <small>{t('addressUnavailable')}</small>}
  </Surface>;
}
