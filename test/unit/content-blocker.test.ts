import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GestureGate,
  matchedBlockedDomain,
  shouldBlockMainFrameNavigation,
  shouldBlockPopupTarget,
  shouldBlockSubresource,
} from '../../src/shared/content-blocker.ts';

test('matches blocked ad and popunder domains by exact host or subdomain', () => {
  assert.equal(matchedBlockedDomain('https://pl30240196.effectivecpmnetwork.com/72/fd/65/a.js'), 'effectivecpmnetwork.com');
  assert.equal(matchedBlockedDomain('https://www.highrevenueformat.com/830dd/invoke.js'), 'highrevenueformat.com');
  assert.equal(matchedBlockedDomain('https://doubleclick.net/pixel'), 'doubleclick.net');
  assert.equal(matchedBlockedDomain('https://fuck-claude.app/zh/'), null);
  assert.equal(matchedBlockedDomain('https://not-effectivecpmnetwork.com/x.js'), null);
  assert.equal(matchedBlockedDomain('file:///tmp/effectivecpmnetwork.com'), null);
});

test('subresource blocking cancels third-party ad scripts without breaking mainFrame or same-site', () => {
  assert.equal(
    shouldBlockSubresource('https://pl30240196.effectivecpmnetwork.com/a.js', 'script', 'https://fuck-claude.app'),
    true,
  );
  assert.equal(
    shouldBlockSubresource('https://www.highrevenueformat.com/invoke.js', 'script', 'null'),
    true,
  );
  assert.equal(
    shouldBlockSubresource('https://www.highrevenueformat.com/invoke.js', 'mainFrame', 'https://fuck-claude.app'),
    false,
  );
  assert.equal(
    shouldBlockSubresource('https://cdn.adsterra.com/asset.js', 'script', 'https://adsterra.com'),
    false,
  );
});

test('main-frame and popup guards block ad targets and ungestured child-frame redirects', () => {
  assert.equal(
    shouldBlockPopupTarget('https://pl30240196.effectivecpmnetwork.com/pop', 'https://fuck-claude.app/'),
    true,
  );
  assert.equal(
    shouldBlockPopupTarget('https://accounts.google.com/o/oauth2/v2/auth', 'https://example.com/'),
    false,
  );
  assert.equal(
    shouldBlockMainFrameNavigation({
      url: 'https://effectivecpmnetwork.com/go',
      currentUrl: 'https://fuck-claude.app/',
      isChildFrame: false,
      hasGesture: true,
    }),
    true,
  );
  assert.equal(
    shouldBlockMainFrameNavigation({
      url: 'https://random-ad.example/landing',
      currentUrl: 'https://fuck-claude.app/',
      isChildFrame: true,
      hasGesture: false,
    }),
    true,
  );
  assert.equal(
    shouldBlockMainFrameNavigation({
      url: 'https://checkout.example/3ds-return',
      currentUrl: 'https://shop.example/pay',
      isChildFrame: true,
      hasGesture: true,
    }),
    false,
  );
});

test('GestureGate allows one popup within window and denies unsolicited or repeated popups', () => {
  let now = 1000;
  const gate = new GestureGate(5000, () => now);
  assert.equal(gate.consumePopup(), false);
  gate.mark();
  now = 2500;
  assert.equal(gate.hasRecent(), true);
  assert.equal(gate.consumePopup(), true);
  assert.equal(gate.consumePopup(), false);
  gate.mark();
  now = 9000;
  assert.equal(gate.consumePopup(), false);
  gate.mark();
  gate.reset();
  assert.equal(gate.consumePopup(), false);
});
