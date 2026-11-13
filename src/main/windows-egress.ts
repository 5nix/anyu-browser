// Optional independent egress: resolve an uplink from Windows routes, never adapter
// names. The default mode never calls this and continues to use the system route/TUN.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { isIP } from 'node:net';
import { t } from '../shared/i18n/index.ts';

export interface WindowsRoute {
  name: string;
  index: number;
  type: number;
  hardware: boolean;
  connected: boolean;
  nextHop: string;
  routeMetric: number;
  interfaceMetric: number;
}

export function selectWindowsEgress(routes: WindowsRoute[]): string {
  const eligible = routes.filter(r =>
    r.connected && [6, 71, 243, 244].includes(r.type) &&
    typeof r.name === 'string' && r.name.trim().length > 0 &&
    Number.isInteger(r.index) && r.index > 0 &&
    Number.isFinite(r.routeMetric) && r.routeMetric >= 0 &&
    Number.isFinite(r.interfaceMetric) && r.interfaceMetric >= 0 &&
    isIP(r.nextHop) === 4 && !/^(0|127)\./.test(r.nextHop),
  );
  // Prefer a real uplink when present. Virtual Ethernet with a gateway remains
  // usable on VMs; tunnel/loopback interfaces and disconnected stale routes do not.
  eligible.sort((a, b) => Number(b.hardware) - Number(a.hardware) ||
    (a.routeMetric + a.interfaceMetric) - (b.routeMetric + b.interfaceMetric) || a.index - b.index);
  if (!eligible.length) throw new Error(t('core.noWindowsUplink'));
  return eligible[0].name;
}

const query = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$adapters = @(Get-NetAdapter)
$interfaces = @(Get-NetIPInterface -AddressFamily IPv4)
$routes = @(foreach ($route in Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0') {
  $adapter = $adapters | Where-Object { $_.InterfaceIndex -eq $route.InterfaceIndex } | Select-Object -First 1
  $ip = $interfaces | Where-Object { $_.InterfaceIndex -eq $route.InterfaceIndex } | Select-Object -First 1
  if ($null -ne $adapter -and $null -ne $ip) {
    [pscustomobject]@{
      name = [string]$adapter.Name; index = [int]$route.InterfaceIndex
      type = [int]$adapter.InterfaceType; hardware = [bool]$adapter.HardwareInterface
      connected = ($adapter.Status -eq 'Up' -and $ip.ConnectionState -eq 'Connected')
      nextHop = [string]$route.NextHop; routeMetric = [int]$route.RouteMetric
      interfaceMetric = [int]$ip.InterfaceMetric
    }
  }
})
ConvertTo-Json -InputObject $routes -Compress
`;

export async function resolveWindowsEgress(): Promise<string> {
  try {
    const binary = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const { stdout } = await promisify(execFile)(binary, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(query, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024, encoding: 'utf8' });
    const routes = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
    if (!Array.isArray(routes)) throw new Error('Invalid route response');
    return selectWindowsEgress(routes);
  } catch (cause) {
    throw new Error(t('core.noWindowsUplink'), { cause });
  }
}
