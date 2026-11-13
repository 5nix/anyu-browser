import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { buildRuntimeConfig, renderRuntimeConfig, GROUP } from '../../src/main/proxy/config.ts';

const input = (open: boolean, extra = {}) => ({
  ports: { browser: 41001, probe: 41002, controller: 41003 },
  secret: 's3cret',
  open,
  proxies: [{ name: 'Node 1', type: 'ss', server: 'node.example.com', port: 443, cipher: 'aes-128-gcm', password: 'x' }],
  selected: '',
  allowPrivateNetwork: false,
  ...extra,
});

const yamlOf = (open: boolean, extra = {}) => renderRuntimeConfig(input(open, extra));

test('the core is local-only, non-TUN, IPv4-only, with no fake-ip', () => {
  const c = parse(yamlOf(true));
  assert.equal(c['bind-address'], '127.0.0.1');
  assert.equal(c['allow-lan'], false);
  assert.equal(c.ipv6, false);
  assert.equal(c.tun.enable, false);
  assert.equal(c.dns.ipv6, false);
  assert.notEqual(c.dns['enhanced-mode'], 'fake-ip');
  assert.equal(c['external-controller'], '127.0.0.1:41003');
  for (const l of c.listeners) assert.equal(l.listen, '127.0.0.1');
  for (const l of c.listeners) assert.equal(l.udp, false);
  assert.equal(c.port, undefined);
  assert.equal(c['mixed-port'], undefined);
});

test('DNS is resolved through the node', () => {
  const c = parse(yamlOf(true));
  for (const ns of c.dns.nameserver) assert.match(ns, new RegExp(`#${GROUP}$`));
  assert.equal(c.dns['use-system-hosts'], false);
});

test('no rule, group or proxy ever routes DIRECT', () => {
  for (const open of [true, false]) assert.doesNotMatch(yamlOf(open), /\bDIRECT\b/);
});

test('open: purely global, private and loopback rejected, everything else through the node', () => {
  const c = parse(yamlOf(true));
  const rules: string[] = c.rules;
  assert.equal(c['rule-providers'], undefined);
  assert.ok(rules.slice(1, -1).every((r) => /,REJECT(,no-resolve)?$/.test(r)), 'only rejections between the probe rule and MATCH');
  assert.equal(rules[0], `IN-NAME,probe,${GROUP}`);
  assert.ok(rules.includes('IP-CIDR,127.0.0.0/8,REJECT,no-resolve'));
  assert.ok(rules.includes('IP-CIDR,192.168.0.0/16,REJECT,no-resolve'));
  assert.ok(rules.includes('DOMAIN,localhost,REJECT'));
  assert.equal(rules.at(-1), `MATCH,${GROUP}`);
});

test('allowPrivateNetwork lifts only the RFC 1918 rules, never loopback', () => {
  const rules: string[] = parse(yamlOf(true, { allowPrivateNetwork: true })).rules;
  assert.ok(!rules.includes('IP-CIDR,192.168.0.0/16,REJECT,no-resolve'));
  assert.ok(rules.includes('IP-CIDR,127.0.0.0/8,REJECT,no-resolve'));
});

test('closed: the browser listener can reach nothing; only the egress probe goes out', () => {
  assert.deepEqual(parse(yamlOf(false)).rules, [`IN-NAME,probe,${GROUP}`, 'MATCH,REJECT']);
});

test('pinning core upstream sockets does not change either gate policy or browser listeners', () => {
  for (const open of [false, true]) {
    const before = parse(yamlOf(open));
    const after = parse(yamlOf(open, { outboundInterface: 'Ethernet' }));
    assert.equal(after['interface-name'], 'Ethernet');
    assert.equal(before['interface-name'], undefined);
    assert.deepEqual(after.rules, before.rules);
    assert.deepEqual(after.listeners, before.listeners);
    assert.deepEqual(after['proxy-groups'], before['proxy-groups']);
    assert.doesNotMatch(yamlOf(open, { outboundInterface: 'Ethernet' }), /\bDIRECT\b/);
  }
});

test('with no subscription the group exists and can only reject', () => {
  const c = buildRuntimeConfig({ ...input(true), proxies: [] });
  const group = (c['proxy-groups'] as any[])[0];
  assert.deepEqual(group.proxies, ['REJECT']);
  assert.equal(group['empty-fallback'], 'REJECT');
});

test('the chosen node leads the group, so a reload starts on it; an unknown choice changes nothing', () => {
  const proxies = ['A', 'B', 'C'].map((name) => ({ name, type: 'ss', server: 'x.example.com', port: 443, cipher: 'aes-128-gcm', password: 'x' }));
  const members = (selected: string) => (buildRuntimeConfig({ ...input(true), proxies, selected })['proxy-groups'] as any[])[0].proxies;
  assert.deepEqual(members('B'), ['B', 'A', 'C']);
  assert.deepEqual(members('gone'), ['A', 'B', 'C']);
});
