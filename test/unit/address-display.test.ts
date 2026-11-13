import { test } from 'node:test';
import { deepStrictEqual } from 'node:assert';
import { addressDisplay, registrableDomain } from '../../src/shared/address-display.ts';
import { addressSecurity } from '../../src/renderer/address-display.ts';

test('registrable domain handles plain hosts, subdomains, multi-part suffixes, IPs, localhost, and IDNs', () => {
  deepStrictEqual(registrableDomain('google.com'), 'google.com');
  deepStrictEqual(registrableDomain('www.google.com'), 'google.com');
  deepStrictEqual(registrableDomain('a.b.c.d.example.com'), 'example.com');
  deepStrictEqual(registrableDomain('accounts.google.com.evil.example'), 'evil.example');
  deepStrictEqual(registrableDomain('example.co.uk'), 'example.co.uk');
  deepStrictEqual(registrableDomain('a.b.example.co.uk'), 'example.co.uk');
  deepStrictEqual(registrableDomain('192.168.1.1'), '192.168.1.1');
  deepStrictEqual(registrableDomain('[::1]'), '[::1]');
  deepStrictEqual(registrableDomain('localhost'), 'localhost');
  deepStrictEqual(registrableDomain('intranet'), 'intranet');
  deepStrictEqual(registrableDomain('xn--fsqu00a.xn--fiqs8s'), 'xn--fsqu00a.xn--fiqs8s');
  deepStrictEqual(registrableDomain('sub.xn--fsqu00a.example.co.uk'), 'example.co.uk');
});

test('address display splits URL into subdomain, registrable domain, and rest', () => {
  deepStrictEqual(addressDisplay('https://example.com/path?a=1'), {
    full: 'https://example.com/path?a=1',
    host: 'example.com',
    sub: '',
    domain: 'example.com',
    rest: '/path?a=1',
  });
  deepStrictEqual(addressDisplay('https://www.google.com/hauihdaihsu'), {
    full: 'https://www.google.com/hauihdaihsu',
    host: 'google.com',
    sub: '',
    domain: 'google.com',
    rest: '/hauihdaihsu',
  });
  // www.com has no subdomain, so www. is the registrable label and is preserved.
  deepStrictEqual(addressDisplay('https://www.com/x'), {
    full: 'https://www.com/x',
    host: 'www.com',
    sub: '',
    domain: 'www.com',
    rest: '/x',
  });
  deepStrictEqual(addressDisplay('https://a.b.c.example.com/page'), {
    full: 'https://a.b.c.example.com/page',
    host: 'a.b.c.example.com',
    sub: 'a.b.c.',
    domain: 'example.com',
    rest: '/page',
  });
  deepStrictEqual(addressDisplay('https://accounts.google.com.evil.example/login'), {
    full: 'https://accounts.google.com.evil.example/login',
    host: 'accounts.google.com.evil.example',
    sub: 'accounts.google.com.',
    domain: 'evil.example',
    rest: '/login',
  });
  deepStrictEqual(addressDisplay('https://shop.example.co.uk/orders/42'), {
    full: 'https://shop.example.co.uk/orders/42',
    host: 'shop.example.co.uk',
    sub: 'shop.',
    domain: 'example.co.uk',
    rest: '/orders/42',
  });
  deepStrictEqual(addressDisplay('http://192.168.1.10/status'), {
    full: 'http://192.168.1.10/status',
    host: '192.168.1.10',
    sub: '',
    domain: '192.168.1.10',
    rest: '/status',
  });
  deepStrictEqual(addressDisplay('http://[::1]/'), {
    full: 'http://[::1]/',
    host: '[::1]',
    sub: '',
    domain: '[::1]',
    rest: '',
  });
  deepStrictEqual(addressDisplay('http://localhost:8080/api'), {
    full: 'http://localhost:8080/api',
    host: 'localhost:8080',
    sub: '',
    domain: 'localhost:8080',
    rest: '/api',
  });
  deepStrictEqual(addressDisplay('https://user:pass@例子.example.com:8443/a?q=1#x'), {
    full: 'https://xn--fsqu00a.example.com:8443/a?q=1#x',
    host: 'xn--fsqu00a.example.com:8443',
    sub: 'xn--fsqu00a.',
    domain: 'example.com:8443',
    rest: '/a?q=1#x',
  });
  deepStrictEqual(addressDisplay('https://www.例子.中国/页面'), {
    full: 'https://www.xn--fsqu00a.xn--fiqs8s/%E9%A1%B5%E9%9D%A2',
    host: 'xn--fsqu00a.xn--fiqs8s',
    sub: '',
    domain: 'xn--fsqu00a.xn--fiqs8s',
    rest: '/%E9%A1%B5%E9%9D%A2',
  });
  deepStrictEqual(addressDisplay('about:blank'), {
    full: '',
    host: '',
    sub: '',
    domain: '',
    rest: '',
  });
  deepStrictEqual(addressDisplay('about:version'), {
    full: 'about:version',
    host: 'about:version',
    sub: '',
    domain: 'about:version',
    rest: '',
  });
});

test('security indicator reflects observable state', () => {
  const tab = { id: 1, kind: 'web' as const, title: '', favicon: null, url: 'https://example.com/', loading: false, canBack: false, canForward: false, audible: false, pinned: false, muted: false, crashed: false, insecure: false, error: null };
  for (const [patch, expected] of [[{}, 'https'], [{ insecure: true }, 'exception'], [{ url: 'http://example.com' }, 'http'], [{ kind: 'settings' }, 'internal'], [{ loading: true }, 'unknown'], [{ crashed: true }, 'unknown'], [{ url: 'about:blank' }, 'unknown']] as const) {
    deepStrictEqual(addressSecurity({ ...tab, ...patch }), expected);
  }
});
