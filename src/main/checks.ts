import { t } from '../shared/i18n/index.ts';
// The self-check: pure evaluation of facts the main process gathers locally. Nothing here talks
// to the network; the only remote fact is the gate's own last egress check.
import type { CheckItem } from '../shared/ipc.ts';
import type { Profile } from '../shared/profile.ts';
import type { GateView } from './gate.ts';
import type { Identity } from './fingerprint.ts';
import type { ProbeReport } from './probe.ts';

export interface CheckFacts {
  profile: Profile;
  identity: Identity;
  gate: GateView;
  coreUp: boolean;
  expectedProxy: string;
  /** session.resolveProxy for a remote and a loopback URL */
  proxyFor: { remote: string; loopback: string };
  switches: { hostResolverRules: string; quic: boolean; ipv6: boolean };
  localDnsRefused: boolean;
  runtimeYaml: string;
  probe: ProbeReport | null;
  hostPlatform: string;
}

const IP = /(^|\s)(\d{1,3}(\.\d{1,3}){3}|[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7})(\s|$)/i;

export function evaluateChecks(f: CheckFacts): CheckItem[] {
  const item = (title: string, pass: boolean, detail: string): Omit<CheckItem, 'id'> => ({ title, pass, detail });
  const pinned = f.proxyFor.remote === f.expectedProxy && f.proxyFor.loopback === f.expectedProxy;
  const scopes = [f.probe?.main, f.probe?.worker].filter(Boolean) as NonNullable<ProbeReport['main']>[];
  const yaml = f.runtimeYaml;
  const main = f.probe?.main;
  const brands = main?.ua?.brands.map((b) => b.brand) ?? [];
  const major = main?.userAgent.match(/Chrome\/(\d+)/)?.[1];
  const uaOk =
    !!main &&
    !/Electron|cave/i.test(main.userAgent) &&
    brands.includes('Google Chrome') &&
    brands.includes('Chromium') &&
    !brands.some((b) => /electron/i.test(b)) &&
    main.ua!.brands.every((b) => b.brand.startsWith('Not') || b.version === major) &&
    main.ua!.platform === f.identity.metadata.platform &&
    main.platform === f.identity.navigatorPlatform &&
    main.userAgent === f.identity.userAgent;
  const candidates = f.probe?.webrtc ?? [];
  const leakingCandidates = candidates.filter((c) => IP.test(c.split(' ')[4] ?? ''));

  const items = [
    item(t('checkText0'), f.coreUp, f.coreUp ? t('checkText1') : t('checkText2')),
    item(t('checkText3'), pinned, pinned ? t('checkTemplate0', { proxy: f.expectedProxy }) : t('checkTemplate1', { remote: f.proxyFor.remote, loopback: f.proxyFor.loopback })),
    item(
      t('checkText4'),
      f.switches.hostResolverRules.includes('MAP * ~NOTFOUND') && f.localDnsRefused,
      f.localDnsRefused ? t('checkText5') : t('checkText6'),
    ),
    item(
      t('checkText7'),
      scopes.length === 2 && scopes.every((s) => s.timezone === f.profile.timezone),
      scopes.map((s, i) => `${i ? 'Worker' : t('checkText9')} ${s.timezone}`).join(t('checkComma')) || t('checkText10'),
    ),
    item(
      t('checkText8'),
      scopes.length === 2 && scopes.every((s) => s.languages.join(',') === f.profile.acceptLanguages.join(',')),
      scopes.map((s, i) => `${i ? 'Worker' : t('checkText9')} ${s.languages.join(', ')}`).join(t('checkSemicolon')) || t('checkText10'),
    ),
    item(t('checkText11'), pinned, pinned ? t('checkText12') : t('checkText13')),
    item(t('checkText14'), f.switches.quic, f.switches.quic ? '--disable-quic' : t('checkText15')),
    item(t('checkText16'), f.switches.ipv6 && /^ipv6: false$/m.test(yaml), f.switches.ipv6 ? t('checkText17') : t('checkText18')),
    item(
      t('checkText19'),
      f.probe?.webrtcPolicy === 'disable_non_proxied_udp' && leakingCandidates.length === 0,
      leakingCandidates.length ? t('checkTemplate2', { candidates: leakingCandidates.join(t('checkSemicolon')) }) : t('checkTemplate3', { count: candidates.length }),
    ),
    item(
      t('checkText20'),
      !/\bDIRECT\b/.test(yaml) && (f.gate.state === 'open' ? /MATCH,PROXY/.test(yaml) && /127\.0\.0\.0\/8,REJECT/.test(yaml) : /MATCH,REJECT/.test(yaml)),
      f.gate.state === 'open' ? t('checkText21') : t('checkText22'),
    ),
    item(
      t('checkText23'),
      f.gate.state === 'open',
      f.gate.egress ? t('checkTemplate4', { country: f.gate.egress.country || t('checkText24'), ip: f.gate.egress.ip, node: f.gate.egress.node, configured: f.profile.egressCountry || t('checkText25') }) : f.gate.reason,
    ),
    item(t('checkText26'), uaOk, main ? t('checkTemplate5', { ua: main.userAgent, brands: brands.join(' / '), platform: main.ua?.platform ?? '', navigator: main.platform }) : t('checkText10')),
    item(
      t('checkText27'),
      f.identity.metadata.platform === f.hostPlatform,
      f.identity.metadata.platform === f.hostPlatform
        ? `${f.hostPlatform}`
        : t('checkTemplate6', { presented: f.identity.metadata.platform, host: f.hostPlatform }),
    ),
  ];
  return items.map((it, i) => ({ id: i + 1, ...it }));
}

export function renderReport(items: CheckItem[], gate: GateView, profile: Profile, at: Date): string {
  const state = { open: t('checkText28'), checking: t('checkText29'), closed: t('checkText30') }[gate.state];
  return [
    t('checkTemplate7', { date: at.toISOString() }),
    t('checkTemplate8', { state, reason: gate.reason }),
    t('checkTemplate9', { timezone: profile.timezone, languages: profile.acceptLanguages.join(', '), country: profile.egressCountry || t('checkText25'), platform: profile.platform, bypassHostTun: String(profile.bypassHostTun) }),
    t('checkTemplate10', { exit: gate.egress ? `${gate.egress.country} ${gate.egress.ip}` : t('checkText31') }),
    t('checkTemplate11', { passed: items.filter((i) => i.pass).length, total: items.length }),
    ...items.map((i) => `${i.pass ? '✓' : '✗'} ${i.id}. ${i.title} — ${i.detail}`),
  ].join('\n');
}
