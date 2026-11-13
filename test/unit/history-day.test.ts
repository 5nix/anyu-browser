import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { historyDay, setLocale } from '../../src/shared/i18n/index.ts';

test('history headings follow the UI language and local calendar days', () => {
  const now = new Date(2026, 10, 13, 1);
  setLocale('zh');
  assert.equal(historyDay(new Date(2026, 10, 13), now), '今天');
  assert.equal(historyDay(new Date(2026, 10, 12, 23), now), '昨天');
  assert.equal(historyDay(new Date(2026, 10, 11), now), '2026年11月11日');
  setLocale('en');
  assert.equal(historyDay(new Date(2026, 10, 13), now), 'Today');
  assert.equal(historyDay(new Date(2026, 10, 12), now), 'Yesterday');
  assert.equal(historyDay(new Date(2026, 10, 11), now), 'November 11, 2026');
  setLocale('zh');
});
