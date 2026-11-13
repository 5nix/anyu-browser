import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './harness.mjs';
import { click as cdpClick, evaluate, gateState, waitFor, withTarget } from './cdp.mjs';

const settingsTarget = (u) => u.endsWith('/settings.html');

test('sources can be added, renamed and removed without losing selection or opening the gate', { timeout: 120000 }, async (t) => {
  const { w, port, shell, settings } = await launch(t, { blank: true, open: true });
  const click = async (selector) => {
    await settings(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center' })`);
    await cdpClick(port, settingsTarget, selector);
  };
  const input = async (selector, text) => {
    await click(selector);
    await withTarget(port, settingsTarget, (send) => send('Input.insertText', { text }));
  };
  const addText = async (text) => {
    await click('#add-source');
    await click('#toggle-paste');
    await input('#paste-text', text);
    await click('#paste-import');
    await waitFor(() => settings("!document.querySelector('#source-editor')"));
  };
  await shell("cave.openSettings('nodes')");
  await waitFor(() => settings("document.querySelector('[data-section=nodes]:not([hidden]) .source-card')"));
  await addText('proxies:\n  - { name: Offline, type: socks5, server: 127.0.0.1, port: 1 }\n');
  await waitFor(() => settings("document.querySelectorAll('.source-card').length === 2"));
  const sources = await settings('cave.panelData().then(d => d.profile.proxy.sources.map(s => s.id))');
  const card = (id) => `[data-source="${id}"]`;
  await click(`${card(sources[1])} .source-rename`);
  await click(`${card(sources[1])} .source-name`);
  await settings(`document.querySelector(${JSON.stringify(card(sources[1]) + ' .source-name')}).select()`);
  await withTarget(port, settingsTarget, (send) => send('Input.insertText', { text: 'Fixture offline' }));
  await click(`${card(sources[1])} .source-save`);
  await waitFor(() => settings(`document.querySelector(${JSON.stringify(card(sources[1]) + ' .label b')})?.textContent === 'Fixture offline'`));
  await click('#delays');
  await waitFor(async () => {
    const statuses = await settings('cave.panelData().then(d => d.nodes.nodes.map(n => n.delay.status))');
    return statuses.includes('measured') && statuses.includes('timeout');
  }, 30000);
  await addText(`proxies:\n  - { name: Untested, type: socks5, server: 127.0.0.1, port: ${w.socks.port} }\n`);
  const statuses = await settings('cave.panelData().then(d => d.nodes.nodes.map(n => n.delay.status))');
  assert.ok(['untested', 'measured', 'timeout'].every((s) => statuses.includes(s)));
  const third = await settings('cave.panelData().then(d => d.profile.proxy.sources.at(-1).id)');
  await click(`${card(third)} .source-remove`);
  await waitFor(() => settings("document.querySelector('#confirm').open"));
  await click('#confirm-ok');
  await waitFor(() => settings("document.querySelectorAll('.source-card').length === 2"));
  assert.deepEqual(await settings('cave.panelData().then(d => d.nodes.selected)'), { source: sources[0], node: 'Test Node' });
  await waitFor(async () => (await gateState(port)) === 'open', 60000);
  await click(`${card(sources[0])} .source-remove`);
  await waitFor(() => settings("document.querySelector('#confirm').open"));
  await click('#confirm-ok');
  // The gate closes first; the selection is cleared after it.
  await waitFor(async () => (await gateState(port)) === 'closed');
  await waitFor(() => settings('cave.panelData().then(d => d.nodes.selected === null)'));
});

test('add subscription defaults to direct when gate is closed, validates URLs, and explains disabled states', { timeout: 120000 }, async (t) => {
  const { w, port, shell, settings } = await launch(t, { blank: true });
  const click = async (selector) => {
    await settings(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center' })`);
    await cdpClick(port, settingsTarget, selector);
  };
  const setUrl = (value) => settings(`(() => { const el = document.querySelector('#sub-url'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const chooseVia = (value) => settings(`(() => { const el = document.querySelector('#sub-via'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);

  await waitFor(() => shell('!!window.cave'));
  await shell('cave.pause()');
  await waitFor(async () => (await gateState(port)) === 'closed');
  await shell("cave.openSettings('nodes')");
  await waitFor(() => settings("document.querySelector('#add-source')"));
  await click('#add-source');
  await waitFor(() => settings("document.querySelector('#sub-fetch')"));

  assert.equal(await settings("document.querySelector('#sub-via').value"), 'direct');
  assert.equal(await settings("document.querySelector('#sub-fetch').disabled"), true);
  assert.equal(await settings("document.querySelector('#sub-fetch-reason')"), null);

  await setUrl('example.com/sub.yaml');
  await waitFor(() => settings("document.querySelector('#sub-fetch-reason')"));
  assert.equal(await settings("document.querySelector('#sub-fetch').disabled"), true);
  assert.match(await settings("document.querySelector('#sub-fetch-reason').textContent"), /http:\/\/|https:\/\//);

  const subUrl = `http://127.0.0.1:${w.fixture.port}/sub.yaml`;
  await setUrl(`  ${subUrl}  `);
  await waitFor(() => settings("!document.querySelector('#sub-fetch').disabled"));
  assert.equal(await settings("document.querySelector('#sub-fetch-reason')"), null);

  await chooseVia('proxy');
  await waitFor(() => settings("document.querySelector('#sub-fetch').disabled && !!document.querySelector('#sub-fetch-reason')"));
  assert.match(await settings("document.querySelector('#sub-fetch-reason').textContent"), /直连/);
  await settings("cave.setLocale('en')");
  await waitFor(() => settings("document.querySelector('#sub-fetch-reason')?.textContent.includes('Direct')"));
  await settings("cave.setLocale('zh')");
  await waitFor(() => settings("document.querySelector('#sub-fetch-reason')?.textContent.includes('直连')"));

  // Reopening while the gate is closed defaults back to direct so the user is not stuck on proxy.
  await click('#source-editor .editor-head button');
  await waitFor(() => settings("!document.querySelector('#source-editor')"));
  await click('#add-source');
  await waitFor(() => settings("document.querySelector('#sub-via')?.value === 'direct'"));
  assert.equal(await settings("document.querySelector('#sub-fetch').disabled"), false);

  w.fixture.server.subscription = `proxies:\n  - { name: Direct Sub Node, type: socks5, server: 127.0.0.1, port: ${w.socks.port}, udp: false }\n`;
  await click('#sub-fetch');
  await waitFor(() => settings("!document.querySelector('#source-editor')"));
  assert.ok(await settings("cave.panelData().then(d => d.nodes.nodes.some(n => n.name === 'Direct Sub Node'))"));
});

