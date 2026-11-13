import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startWorld } from './harness.mjs';
import { devtoolsPort, evaluate, gateState, waitFor } from './cdp.mjs';

test('chrome layout: tabs stay above the pinned new-tab row', async (t) => {
  const w = await startWorld({ blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const shell = (expr) => evaluate(port, (u) => u.endsWith('/shell.html'), expr);
  await waitFor(() => shell("!!document.querySelector('#tabs')"));
  await shell("cave.setTabLayout('side')");
  await waitFor(() => shell("document.body.classList.contains('side')"));
  assert.equal(await shell("document.querySelector('#tablist').nextElementSibling.id"), 'new-tab');
  for (let i = 0; i < 39; i++) await shell("cave.run('tab.new')");
  await waitFor(() => shell("document.querySelector('#tabs').classList.contains('overflowing')"));
  await waitFor(() => shell("!document.querySelector('.tab.active').classList.contains('entering')"));
  const result = await shell(`(() => {
    const list = document.querySelector('#tablist'), row = document.querySelector('#new-tab').getBoundingClientRect(),
      tools = document.querySelector('#tools').getBoundingClientRect(), active = list.querySelector('.active').getBoundingClientRect(), box = list.getBoundingClientRect();
    return { scrolls: list.scrollHeight > list.clientHeight, row: row.bottom, tools: tools.top, activeTop: active.top, activeBottom: active.bottom, top: box.top, bottom: box.bottom };
  })()`);
  assert.ok(result.scrolls && result.row <= result.tools);
  assert.ok(result.activeTop >= result.top && result.activeBottom <= result.bottom);
});

test('chrome layout: sidebar width and address dismissal persist across views', async (t) => {
  const { rm } = await import('node:fs/promises');
  const { click } = await import('./cdp.mjs');
  const w = await startWorld({ blank: true, keepDir: true, extra: ['--remote-debugging-port=0'] });
  let next;
  t.after(async () => { await w.stop(); if (next) await next.stop(); await rm(w.dir, { recursive: true, force: true }); });
  const port = await devtoolsPort(w.log), chrome = u => u.endsWith('/shell.html'), home = u => u.endsWith('/home.html'), settings = u => u.endsWith('/settings.html');
  const shell = expr => evaluate(port, chrome, expr);
  await waitFor(() => shell('cave.getState()'));
  await shell("cave.setTabLayout('side')");
  await shell('cave.setSidebarWidth(320)');
  await waitFor(() => shell("getComputedStyle(document.documentElement).getPropertyValue('--side') === '320px'"));
  const width = await shell('innerWidth');
  await waitFor(() => evaluate(port, home, `innerWidth === ${width - 328}`));
  await click(port, chrome, '#address');
  await click(port, home, 'body');
  await waitFor(() => shell("document.activeElement !== document.querySelector('#address') && cave.getState().then(s => !s.surface)"));
  await click(port, chrome, '#address');
  await click(port, chrome, '#tabs');
  await waitFor(() => shell("document.activeElement !== document.querySelector('#address')"));
  await shell("cave.openSettings('privacy')");
  await waitFor(() => evaluate(port, settings, "!!document.querySelector('#clear-data')"));
  await click(port, chrome, '#address');
  await click(port, settings, '#content');
  await waitFor(() => shell("document.activeElement !== document.querySelector('#address') && cave.getState().then(s => !s.surface)"));
  await w.stop();
  next = await startWorld({ dir: w.dir, blank: true, keepDir: true, extra: ['--remote-debugging-port=0'] });
  const port2 = await devtoolsPort(next.log);
  await waitFor(() => evaluate(port2, chrome, "cave.getState().then(s => s.tabLayout === 'side' && s.sidebarWidth === 320)"));
  const width2 = await evaluate(port2, chrome, 'innerWidth');
  await waitFor(() => evaluate(port2, home, `innerWidth === ${width2 - 328}`));
});

test('Windows side chrome places navigation below the caption band', async (t) => {
  process.env.CAVE_TEST_WINDOWS_CHROME = '1';
  const w = await startWorld({ blank: true, extra: ['--remote-debugging-port=0'] });
  delete process.env.CAVE_TEST_WINDOWS_CHROME;
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log), shell = expr => evaluate(port, u => u.endsWith('/shell.html'), expr);
  await waitFor(() => shell("document.body.classList.contains('win')"));
  await shell("cave.setTabLayout('side')");
  await waitFor(() => shell("document.body.classList.contains('side')"));
  const rects = await shell(`(() => { const r = id => { const b = document.querySelector(id).getBoundingClientRect(); return { x: b.x, y: b.y, bottom: b.bottom }; }; return { nav: r('#nav'), sheet: r('#sheet'), band: r('#drag-bar') }; })()`);
  assert.equal(rects.nav.y, 44);
  assert.equal(rects.nav.x, 0);
  assert.equal(rects.sheet.y, 44);
  assert.equal(rects.band.bottom, 44);
  // Top layout: the caption band is the 40px tab strip; tabs stand on its bottom edge and the
  // + shares their centre line; the page card starts below the 50px toolbar band.
  await shell("cave.setTabLayout('top')");
  await waitFor(() => shell("document.body.classList.contains('top')"));
  await waitFor(() => shell("!document.querySelector('.tab.entering')"));
  const top = await shell(`(() => { const r = s => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, right: innerWidth - b.right, width: b.width, bottom: b.bottom, cy: b.y + b.height / 2 }; };
    return { band: r('#drag-bar'), tab: r('.tab'), add: r('#new-tab svg'), fav: r('.tab .fav svg, .tab .fav img'), sheet: r('#sheet'), field: r('#address-form'), site: r('#site-icon'), star: r('#bookmark') }; })()`);
  assert.equal(top.band.bottom, 40);
  assert.deepEqual([top.tab.x, top.tab.y, top.tab.bottom], [8, 8, 40]);
  assert.equal(top.add.cy, top.tab.cy);
  assert.equal(top.fav.cy, top.tab.cy);
  assert.equal(top.sheet.y, 85);
  assert.equal(top.star, null, 'bookmark button is hidden on about:blank');
  await waitFor(async () => (await gateState(port)) === 'open', 60000);
  await shell("cave.navigate('http://fp.cave.test/fp.html')");
  const web = await waitFor(() => shell(`(() => { const star = document.querySelector('#bookmark'); if (!star) return null; const r = s => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x, y: b.y, right: innerWidth - b.right, width: b.width, bottom: b.bottom, cy: b.y + b.height / 2 }; }; return { field: r('#address-form'), site: r('#site-icon'), star: r('#bookmark') }; })()`));
  assert.equal(web.field.width, top.field.width, 'address field width does not shift when bookmark appears');
  assert.equal(web.site.x - web.field.x, web.star.right - web.field.right, 'site icon and star are mirrored');
  assert.equal(web.site.cy, web.star.cy);
});

test('narrow address field keeps registrable domain visible while cutting subdomains first', async (t) => {
  const { withTarget } = await import('./cdp.mjs');
  const w = await startWorld({ blank: true, extra: ['--remote-debugging-port=0'] });
  t.after(() => w.stop());
  const port = await devtoolsPort(w.log);
  const chrome = (u) => u.endsWith('/shell.html');
  const shell = (expr) => evaluate(port, chrome, expr);
  await waitFor(async () => (await gateState(port)) === 'open', 60000);
  const url = 'http://sso.login.oauth.accounts.google.com.portal.subdomain.evil.test/find.html';
  await shell(`cave.navigate(${JSON.stringify(url)})`);
  await waitFor(() => evaluate(port, (u) => u === url, 'document.title'));

  const measure = () => shell(`(() => {
    const view = document.querySelector('#address-view');
    const sub = document.querySelector('#address-sub');
    const domain = document.querySelector('#address-domain');
    const rest = document.querySelector('#address-rest');
    const vr = view.getBoundingClientRect(), dr = domain.getBoundingClientRect(), sr = sub.getBoundingClientRect(), rr = rest.getBoundingClientRect();
    return {
      viewWidth: vr.width,
      subWidth: sr.width,
      subScrollWidth: sub.scrollWidth,
      domainText: domain.textContent,
      domainWidth: dr.width,
      domainScrollWidth: domain.scrollWidth,
      domainVisibleInView: dr.left >= vr.left - 0.5 && dr.right <= vr.right + 0.5,
      restText: rest.textContent,
      restWidth: rr.width,
      restScrollWidth: rest.scrollWidth,
    };
  })()`);

  // Side layout (256px sidebar): subdomains shrink first while evil.test stays completely unclipped.
  await shell("cave.setTabLayout('side')");
  await waitFor(() => shell("document.body.classList.contains('side')"));
  const side = await measure();
  assert.equal(side.domainText, 'evil.test');
  assert.ok(side.subWidth < side.subScrollWidth, 'subdomains truncate first in narrow side layout');
  assert.ok(side.domainVisibleInView && side.domainWidth >= side.domainScrollWidth - 0.5, 'registrable domain remains fully visible in side layout');
  assert.ok(side.restWidth >= side.restScrollWidth - 0.5, 'path is not truncated while subdomains still have room to shrink');

  // Narrow top layout (720px minimum window width): same behaviour.
  await shell("cave.setTabLayout('top')");
  await waitFor(() => shell("document.body.classList.contains('top')"));
  const narrowTop = await withTarget(port, chrome, async (send) => {
    await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 480, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 150));
    const res = await send('Runtime.evaluate', {
      expression: `(() => {
        const view = document.querySelector('#address-view');
        const sub = document.querySelector('#address-sub');
        const domain = document.querySelector('#address-domain');
        const vr = view.getBoundingClientRect(), dr = domain.getBoundingClientRect(), sr = sub.getBoundingClientRect();
        return { subWidth: sr.width, subScrollWidth: sub.scrollWidth, domainText: domain.textContent, domainWidth: dr.width, domainScrollWidth: domain.scrollWidth, domainVisibleInView: dr.left >= vr.left - 0.5 && dr.right <= vr.right + 0.5 };
      })()`,
      returnByValue: true,
    });
    await send('Emulation.clearDeviceMetricsOverride');
    return res.result.value;
  });
  assert.equal(narrowTop.domainText, 'evil.test');
  assert.ok(narrowTop.subWidth < narrowTop.subScrollWidth, 'subdomains truncate first in narrow top layout');
  assert.ok(narrowTop.domainVisibleInView && narrowTop.domainWidth >= narrowTop.domainScrollWidth - 0.5, 'registrable domain remains fully visible in narrow top layout');

  // When both subdomain and path overflow in narrow side layout, subdomains collapse before domain, and path clips on the right.
  const longPathUrl = 'http://accounts.google.com.evil.test/find.html?q=very_long_query_string_that_must_ellipsis_on_right';
  await shell("cave.setTabLayout('side')");
  await waitFor(() => shell("document.body.classList.contains('side')"));
  await shell(`cave.navigate(${JSON.stringify(longPathUrl)})`);
  await waitFor(() => evaluate(port, (u) => u === longPathUrl, 'document.title'));
  const bothLong = await measure();
  assert.equal(bothLong.domainText, 'evil.test');
  assert.equal(Math.round(bothLong.subWidth), 0, 'subdomains collapse completely when path also overflows');
  assert.ok(bothLong.domainVisibleInView && bothLong.domainWidth >= bothLong.domainScrollWidth - 0.5, 'registrable domain stays unclipped when path overflows');
  assert.ok(bothLong.restWidth < bothLong.restScrollWidth, 'path truncates at the right edge');
});
