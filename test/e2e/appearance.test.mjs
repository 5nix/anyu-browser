import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { startWorld } from './harness.mjs';
import { devtoolsPort, evaluate, waitFor } from './cdp.mjs';

test('appearance settings synchronize and survive restart', async t => {
  const first = await startWorld({ blank: true, keepDir: true, extra: ['--remote-debugging-port=0'] });
  let second;
  t.after(async () => { await first.stop(); if (second) await second.stop(); const { rm } = await import('node:fs/promises'); await rm(first.dir, { recursive: true, force: true }); });
  const shell = u => u.endsWith('/shell.html');
  const settings = u => u.endsWith('/settings.html');
  const check = async port => {
    for (const target of [shell, settings]) await waitFor(() => evaluate(port, target, "document.documentElement.dataset.accent === 'violet' && matchMedia('(prefers-color-scheme: dark)').matches"));
  };
  const port = await devtoolsPort(first.log);
  await waitFor(() => evaluate(port, settings, "!!document.querySelector('input[name=accent]')"));
  await evaluate(port, shell, "cave.openSettings('appearance')");
  await evaluate(port, settings, "document.querySelector('input[name=accent][value=violet]').click(); document.querySelector('input[name=theme][value=dark]').click()");
  await check(port);
  await first.stop();
  second = await startWorld({ dir: first.dir, blank: true, extra: ['--remote-debugging-port=0'] });
  const port2 = await devtoolsPort(second.log);
  await check(port2);
  assert.deepEqual(await evaluate(port2, shell, "cave.getState().then(s => [s.accent, s.theme])"), ['violet', 'dark']);
});
