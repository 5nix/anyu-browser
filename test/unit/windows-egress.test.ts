import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectWindowsEgress, type WindowsRoute } from '../../src/main/windows-egress.ts';

const route = (patch: Partial<WindowsRoute> = {}): WindowsRoute => ({ name: 'Ethernet', index: 6, type: 6, hardware: true, connected: true, nextHop: '192.0.2.1', routeMetric: 0, interfaceMetric: 25, ...patch });

test('a low-metric host TUN and disconnected stale TAP cannot take the upstream', () => {
  assert.equal(selectWindowsEgress([
    route({ name: 'Renamed VPN', index: 61, type: 53, hardware: false, routeMetric: 0, interfaceMetric: 1 }),
    route({ name: 'Old TAP', index: 14, connected: false, hardware: false, interfaceMetric: 1 }),
    route({ name: '以太网' }),
  ]), '以太网');
});

test('active uplinks follow combined Windows route and interface metrics', () => {
  assert.equal(selectWindowsEgress([
    route({ name: 'Wi-Fi', index: 20, type: 71, routeMetric: 5, interfaceMetric: 10 }),
    route({ name: 'Ethernet', routeMetric: 1, interfaceMetric: 30 }),
  ]), 'Wi-Fi');
});

test('physical default route is preferred, with virtual Ethernet supported on VMs', () => {
  const vm = route({ name: 'Virtual Ethernet', hardware: false, interfaceMetric: 1 });
  assert.equal(selectWindowsEgress([vm, route()]), 'Ethernet');
  assert.equal(selectWindowsEgress([vm]), 'Virtual Ethernet');
});

test('missing or unusable routes fail instead of falling back to the host TUN', () => {
  for (const routes of [[], [route({ connected: false })], [route({ type: 53 })], [route({ nextHop: '0.0.0.0' })], [route({ nextHop: '::1' })], [route({ interfaceMetric: NaN })], [route({ name: '' })]]) {
    assert.throws(() => selectWindowsEgress(routes));
  }
});
