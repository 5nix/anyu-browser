// Collects what a page (or worker) can see. Shared by the window, workers and service worker.
async function collect() {
  const nav = self.navigator;
  const out = {
    userAgent: nav.userAgent,
    platform: nav.platform,
    language: nav.language,
    languages: [...nav.languages],
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    intlLocale: Intl.DateTimeFormat().resolvedOptions().locale,
    offset: new Date(2026, 0, 1).getTimezoneOffset(),
    webdriver: nav.webdriver,
  };
  if (nav.userAgentData) {
    out.uaData = {
      brands: nav.userAgentData.brands,
      mobile: nav.userAgentData.mobile,
      platform: nav.userAgentData.platform,
      high: await nav.userAgentData.getHighEntropyValues(['architecture', 'bitness', 'model', 'platformVersion', 'fullVersionList', 'wow64', 'formFactors']),
    };
  }
  return out;
}
