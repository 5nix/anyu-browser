/** Cloudflare sites with a known city and IANA time zone. Unknown sites are never guessed. */
export interface ColoSite {
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export const COLO_SITES: Readonly<Record<string, ColoSite>> = {
  NRT: { city: 'Tokyo', country: 'JP', latitude: 35.6762, longitude: 139.6503, timezone: 'Asia/Tokyo' },
  HKG: { city: 'Hong Kong', country: 'HK', latitude: 22.3193, longitude: 114.1694, timezone: 'Asia/Hong_Kong' },
  SIN: { city: 'Singapore', country: 'SG', latitude: 1.3521, longitude: 103.8198, timezone: 'Asia/Singapore' },
  LHR: { city: 'London', country: 'GB', latitude: 51.5072, longitude: -0.1276, timezone: 'Europe/London' },
  FRA: { city: 'Frankfurt', country: 'DE', latitude: 50.1109, longitude: 8.6821, timezone: 'Europe/Berlin' },
  SJC: { city: 'San Jose', country: 'US', latitude: 37.3382, longitude: -121.8863, timezone: 'America/Los_Angeles' },
};

export function coloForCountry(code: string, country: string): ColoSite | null {
  const site = COLO_SITES[code.toUpperCase()];
  return site && site.country === country.toUpperCase() ? site : null;
}
