import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractProxies, SubscriptionError } from '../../src/main/proxy/subscription.ts';

const sub = `
port: 7890
mode: global
tun: { enable: true }
dns: { enable: true, enhanced-mode: fake-ip }
proxies:
  - { name: Node 1, type: ss, server: node.example.com, port: 443, cipher: aes-128-gcm, password: p }
  - { name: Node 1, type: ss, server: dup.example.com, port: 443, cipher: aes-128-gcm, password: p }
  - { name: DIRECT, type: ss, server: x.example.com, port: 1, cipher: aes-128-gcm, password: p }
  - { name: raw, type: direct }
  - { name: chained, type: trojan, server: t.example.com, port: 443, password: p, dialer-proxy: raw }
  - just a string
rules:
  - MATCH,DIRECT
`;

test('keeps only real proxies; drops DIRECT, duplicates and chaining', () => {
  const proxies = extractProxies(sub);
  assert.deepEqual(proxies.map((p) => p.name), ['Node 1', 'chained']);
  assert.equal(proxies[0].server, 'node.example.com');
  assert.equal(proxies[1]['dialer-proxy'], undefined);
});

test('rejects non-Clash input with a readable error', () => {
  assert.throws(() => extractProxies('ss://abc@host:1#name'), SubscriptionError);
  assert.throws(() => extractProxies('proxies: [ {'), /YAML/);
  assert.throws(() => extractProxies('proxies:\n  - { name: d, type: direct }\n'), /没有可用/);
});
