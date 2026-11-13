import { test } from 'node:test';
import assert from 'node:assert/strict';
import { externalProxyNode, isLoopbackHost, EXTERNAL_NODE_NAME } from '../../src/main/external-proxy.ts';
import type { ExternalProxy } from '../../src/shared/profile.ts';

const ep = (over: Partial<ExternalProxy> = {}): ExternalProxy => ({ protocol: 'socks5', host: '127.0.0.1', port: 7890, username: '', password: '', ...over });

test('builds the synthetic node the core dials as its only outbound', () => {
  const node = externalProxyNode(ep());
  assert.deepEqual(node, { name: EXTERNAL_NODE_NAME, type: 'socks5', server: '127.0.0.1', port: 7890, udp: false });
  assert.equal(externalProxyNode(ep({ protocol: 'http' }))?.type, 'http');
});

test('auth is included only when set', () => {
  const plain = externalProxyNode(ep());
  assert.equal(plain?.username, undefined);
  assert.equal(plain?.['password'], undefined);
  const authed = externalProxyNode(ep({ username: 'u', password: 'x' }));
  assert.equal(authed?.username, 'u');
  assert.equal(authed?.['password'], 'x');
});

test('only loopback endpoints are usable', () => {
  for (const host of ['127.0.0.1', 'localhost', '::1']) assert.ok(isLoopbackHost(host), host);
  for (const host of ['192.168.1.1', '10.0.0.1', 'proxy.example.com', '0.0.0.0']) assert.equal(isLoopbackHost(host), false, host);
  assert.equal(externalProxyNode(ep({ host: '192.168.1.1' })), null);
});

test('an unset or invalid port means no node, so the gate stays closed', () => {
  assert.equal(externalProxyNode(ep({ port: 0 })), null);
  assert.equal(externalProxyNode(ep({ port: 65536 })), null);
  assert.equal(externalProxyNode(ep({ port: 7890.5 })), null);
  assert.equal(externalProxyNode(ep({ protocol: 'socks4' as ExternalProxy['protocol'] })), null);
});
