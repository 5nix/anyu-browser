import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateChecks, renderReport, type CheckFacts } from '../../src/main/checks.ts';
import { defaultProfile } from '../../src/shared/profile.ts';
import { setLocale } from '../../src/shared/i18n/index.ts';

test('self-check results and reports follow the current language', () => {
  const profile = defaultProfile('en-US', 'UTC');
  const facts = { profile, identity: { metadata: { platform: 'Mac' } }, gate: { state: 'closed', reason: 'reason', egress: null }, coreUp: false, expectedProxy: 'proxy', proxyFor: { remote: 'proxy', loopback: 'proxy' }, switches: { hostResolverRules: '', quic: false, ipv6: false }, localDnsRefused: false, runtimeYaml: '', probe: null, hostPlatform: 'Mac' } as unknown as CheckFacts;
  try {
    setLocale('zh');
    assert.equal(evaluateChecks(facts)[0].title, '代理核心在运行');
    assert.match(renderReport(evaluateChecks(facts), facts.gate, profile, new Date(0)), /^Cave 自检报告/);
    setLocale('en');
    const items = evaluateChecks(facts);
    assert.equal(items[0].title, 'Proxy core is running');
    assert.match(renderReport(items, facts.gate, profile, new Date(0)), /^Cave self-check report/);
  } finally { setLocale('zh'); }
});
