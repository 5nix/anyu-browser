import { test } from 'node:test';
import assert from 'node:assert/strict';
import { switchText } from '../../src/shared/switch.ts';

const row = (name: string, country = '') => ({ source: 's', name, type: 'vless', delay: { status: 'untested' as const }, country });

test('switch confirmation names both nodes and says connections drop', () => {
  const t = switchText(row('A', 'QM'), row('B'), 'QM');
  assert.match(t, /从「A」切换到「B」/);
  assert.match(t, /连接都会断开，出口 IP 会改变/);
  assert.match(t, /重新核对出口国家（「B」还没有核对过）/);
});

test('switch confirmation flags a known country change and a mismatch with the profile', () => {
  const t = switchText(row('Node A', 'QM'), row('Node B', 'QN'), 'QM');
  assert.match(t, /⚠ 出口国家会从 QM 变成 QN/);
  assert.match(t, /⚠ 它和配置的 QM 不符，外网会保持关闭/);
  const same = switchText(row('Node A1', 'QM'), row('Node A2', 'QM'), 'QM');
  assert.match(same, /出口国家：QM（上次核对）/);
  assert.doesNotMatch(same, /⚠/);
});

test('switch confirmation follows the selected language', async () => {
  const { setLocale } = await import('../../src/shared/i18n/index.ts');
  setLocale('en');
  try { assert.match(switchText(row('A', 'QM'), row('B', 'QN'), 'QM'), /Switch from .*A.* to .*B/); }
  finally { setLocale('zh'); }
});
