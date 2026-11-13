import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startWorld, PROFILE } from './harness.mjs';
import { devtoolsPort, evaluate, waitFor } from './cdp.mjs';

for (const [name, profile, expected] of [
  ['allowed', PROFILE, '外网已放行 · QM'],
  ['mismatch', { ...PROFILE, egressCountry: 'QN' }, '外网已关闭'],
]) test(`status redesign: ${name}`, async t => {
  const w = await startWorld({ profile, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = expr => evaluate(port, u => u.endsWith('/shell.html'), expr);
  const settings = expr => evaluate(port, u => u.endsWith('/settings.html'), expr);
  await waitFor(async () => ((g) => g.state === (name === 'allowed' ? 'open' : 'closed') && !!g.egress)((await shell('cave.getState()')).gate), 60000);
  await shell("cave.openSettings('overview')");
  assert.equal(await waitFor(() => settings(`document.querySelector('#gate-title')?.textContent === ${JSON.stringify(expected)} && document.querySelector('#gate-title').textContent`)), expected);
  // Pausing is the switch at the right end of the summary; checking again sits beside the conditions heading.
  assert.equal(await settings("document.querySelector('.overview-summary > #pause.switch[role=switch]')?.checked"), true);
  assert.equal(await settings("document.querySelector('.check-heading > #restart') !== null"), true);
  if (name === 'mismatch') {
    // The row only states the condition; the explanation and the fix are one panel under the four rows.
    assert.match(await settings("document.querySelector('[data-condition=exit]').textContent"), /出口国家.*实际是/);
    assert.equal(await settings("document.querySelector('[data-condition=exit]').classList.contains('failed')"), true);
    assert.equal(await settings("document.querySelectorAll('.condition-row button').length"), 0);
    assert.equal(await settings("document.querySelector('.condition-list + #condition-fix') !== null"), true);
    assert.match(await settings("document.querySelector('#condition-fix').textContent"), /更换节点/);
    assert.equal(await settings("document.querySelector('#use-country').textContent"), '把环境配置改成 QM');
  }
});

test('status card: paused shows the stopped core and the selected node, not unknown', async t => {
  const w = await startWorld({ extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = expr => evaluate(port, u => u.endsWith('/shell.html'), expr);
  const overlay = expr => evaluate(port, u => u.endsWith('/overlay.html'), expr);
  await waitFor(async () => (await shell('cave.getState()')).gate.state === 'open', 60000);
  await shell('cave.pause()');
  await waitFor(async () => (await shell('cave.getState()')).gate.paused);
  await shell("cave.toggleSurface('status')");
  const rows = await waitFor(async () => { const r = await overlay("[...document.querySelectorAll('#status .condition-row small')].map(b => b.textContent)"); return r?.[2] === 'Test Node' && r; });
  assert.deepEqual(rows, ['已暂停', '暂停时停止', 'Test Node', '暂停时不核对']);
  // The card is the settings page's summary and rows: the switch is off, the rows carry no buttons, and checking again waits for resume.
  assert.deepEqual(await overlay("({ on: document.querySelector('#status .overview-summary > #pause.switch').checked, rowButtons: document.querySelectorAll('#status .condition-row button').length, restart: !!document.querySelector('#status #restart'), settings: !!document.querySelector('#status #open-settings') })"), { on: false, rowButtons: 0, restart: false, settings: true });
});
