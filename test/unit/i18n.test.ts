import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zh } from '../../src/shared/i18n/zh.ts';
import { en } from '../../src/shared/i18n/en.ts';
import { setLocale, systemLocale, t } from '../../src/shared/i18n/index.ts';

test('translation dictionaries have matching keys and placeholders', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
    const params = (s: string) => [...s.matchAll(/\{([^{}]+)\}/g)].map(m => m[1]).sort();
    assert.deepEqual(params(en[key]), params(zh[key]), key);
  }
});
test('locale selection and interpolation', () => {
  assert.equal(systemLocale('zh-Hant-TW'), 'zh');
  assert.equal(systemLocale('en-US'), 'en');
  setLocale('zh'); assert.equal(t('clearSiteTitle', { host: 'example.com' }), '清除 example.com 的网站数据？');
  setLocale('en'); assert.equal(t('clearSiteTitle', { host: 'example.com' }), 'Clear site data for example.com?');
  assert.equal(t('clearSiteTitle'), 'Clear site data for {host}?');
  setLocale('zh');
});

test('core translations have matching keys and placeholders', async () => {
  const { coreZh } = await import('../../src/shared/i18n/core.zh.ts');
  const { coreEn } = await import('../../src/shared/i18n/core.en.ts');
  assert.deepEqual(Object.keys(coreEn).sort(), Object.keys(coreZh).sort());
  for (const key of Object.keys(coreZh) as (keyof typeof coreZh)[]) {
    const params = (s: string) => [...s.matchAll(/\{([^{}]+)\}/g)].map(m => m[1]).sort();
    assert.deepEqual(params(coreEn[key]), params(coreZh[key]), key);
  }
});

test('gate view follows locale changes without changing its facts', async () => {
  const { initialGate, viewGate } = await import('../../src/main/gate.ts');
  const facts = { ...initialGate('QM'), core: 'up' as const, hasNode: true, check: { status: 'done' as const, result: { ok: true as const, egress: { node: 'n', ip: '1.2.3.4', country: 'QM' } } } };
  try {
    setLocale('zh'); assert.equal(viewGate(facts).reason, '出口 QM 与配置一致');
    setLocale('en'); assert.equal(viewGate(facts).reason, 'Exit country QM matches the configuration');
    setLocale('zh'); assert.equal(viewGate(facts).reason, '出口 QM 与配置一致');
  } finally { setLocale('zh'); }
});
