import { test } from 'node:test';
import { deepStrictEqual } from 'node:assert';
import { addressDisplay } from '../../src/renderer/address-display.ts';
test('address display strips credentials and preserves URL parts', () => {
  deepStrictEqual(addressDisplay('https://user:pass@例子.example.com:8443/a?q=1#x'), { full: 'https://xn--fsqu00a.example.com:8443/a?q=1#x', host: 'xn--fsqu00a.example.com:8443', rest: '/a?q=1#x' });
  deepStrictEqual(addressDisplay('http://[::1]/'), { full: 'http://[::1]/', host: '[::1]', rest: '' });
  deepStrictEqual(addressDisplay('about:blank'), { full: '', host: '', rest: '' });
});
import { addressSecurity } from '../../src/renderer/address-display.ts';
test('security indicator reflects observable state', () => {
  const tab = { id: 1, kind: 'web' as const, title: '', favicon: null, url: 'https://example.com/', loading: false, canBack: false, canForward: false, audible: false, pinned: false, muted: false, crashed: false, insecure: false, error: null };
  for (const [patch, expected] of [[{}, 'https'], [{ insecure: true }, 'exception'], [{ url: 'http://example.com' }, 'http'], [{ kind: 'settings' }, 'internal'], [{ loading: true }, 'unknown'], [{ crashed: true }, 'unknown'], [{ url: 'about:blank' }, 'unknown']] as const) {
    deepStrictEqual(addressSecurity({ ...tab, ...patch }), expected);
  }
});
