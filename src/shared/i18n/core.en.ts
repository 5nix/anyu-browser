import type { coreZh } from './core.zh.ts';

export const coreEn: Record<keyof typeof coreZh, string> = {
  'core.paused': 'Internet access paused',
  'core.starting': 'Starting proxy core',
  'core.down': 'Proxy core is not running',
  'core.noNode': 'No nodes imported',
  'core.noCountry': 'No exit country configured',
  'core.checking': 'Checking exit country',
  'core.open': 'Exit country {country} matches the configuration',
  'core.mismatch': 'Exit country is {actual}; configuration requires {expected}',
  'core.unknown': 'Unknown',
  'core.checkFailed': 'Exit check failed: {error}',
  'core.subscriptionUrl': 'Enter a subscription URL first',
  'core.subscriptionNeedsNode': 'No node is available for proxy fetching. Choose Direct for the first subscription fetch.',
  'core.subscriptionHttp': 'Subscription fetch failed: HTTP {status}',
  'core.invalidYaml': 'Invalid YAML: {error}',
  'core.noProxies': 'No proxies list found (only Clash YAML subscriptions are supported)',
  'core.noUsableProxies': 'Subscription has no usable proxy nodes',
};
