// The identity a site sees, proposed offline from the measured exit: time zone and languages from
// Intl, a city only from the bundled Cloudflare site table and only when it lies in that country.
import { coloForCountry } from './colo.ts';
import type { Profile, ProfilePatch } from './profile.ts';

/** ISO 3166-1 alpha-2 regions offered as exit countries. */
export const COUNTRIES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(' ');

/** Countries spanning several zones: the zone most of their people live in. */
const MOST_POPULOUS_ZONE: Record<string, string> = {
  AR: 'America/Argentina/Buenos_Aires', AU: 'Australia/Sydney', BR: 'America/Sao_Paulo', CA: 'America/Toronto', CD: 'Africa/Kinshasa',
  CL: 'America/Santiago', CN: 'Asia/Shanghai', DE: 'Europe/Berlin', EC: 'America/Guayaquil', ES: 'Europe/Madrid', GL: 'America/Nuuk',
  ID: 'Asia/Jakarta', KZ: 'Asia/Almaty', MN: 'Asia/Ulaanbaatar', MX: 'America/Mexico_City', MY: 'Asia/Kuala_Lumpur',
  NZ: 'Pacific/Auckland', PT: 'Europe/Lisbon', RU: 'Europe/Moscow', UA: 'Europe/Kyiv', US: 'America/New_York', UZ: 'Asia/Tashkent',
};

/** Accuracy reported with a city-centre location, in metres. */
export const CITY_ACCURACY = 5000;

export interface IdentityProposal {
  /** Zones of the exit country, for the picker; may be empty for regions Intl does not know. */
  timezones: string[];
  /** '' when nothing can be proposed: the current zone stays. */
  timezone: string;
  /** e.g. ['ja-JP', 'ja']; empty when the region has no known language. */
  languages: string[];
  /** Only when the measured site lies in the measured country; coordinates rounded to one decimal. */
  city: { name: string; nameZh: string; latitude: number; longitude: number } | null;
}

export type LanguageChoice = 'exit' | 'both' | 'keep';
export type LocationChoice = 'deny' | 'city';

const validZone = (zone: string): boolean => { try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; } };

export function zonesOf(country: string): string[] {
  try {
    const locale = new Intl.Locale(`und-${country}`) as Intl.Locale & { getTimeZones?: () => string[] | undefined; timeZones?: string[] };
    return (locale.getTimeZones?.() ?? locale.timeZones ?? []).filter(validZone);
  } catch { return []; }
}

export function languagesOf(country: string): string[] {
  if (!COUNTRIES.includes(country)) return [];
  try {
    const max = new Intl.Locale(`und-${country}`).maximize();
    if (!max.language || max.language === 'und' || max.region !== country) return [];
    return [`${max.language}-${country}`, max.language];
  } catch { return []; }
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function proposeIdentity(country: string, colo: string): IdentityProposal {
  const code = country.toUpperCase();
  const site = /^[A-Z]{2}$/.test(code) ? coloForCountry(colo, code) : null;
  const timezones = /^[A-Z]{2}$/.test(code) ? zonesOf(code) : [];
  const populous = MOST_POPULOUS_ZONE[code];
  const timezone = site && validZone(site.timezone) ? site.timezone
    : populous && validZone(populous) ? populous
    : timezones[0] ?? '';
  return {
    timezones: timezone && !timezones.includes(timezone) ? [timezone, ...timezones] : timezones,
    timezone,
    languages: /^[A-Z]{2}$/.test(code) ? languagesOf(code) : [],
    city: site ? { name: site.city, nameZh: site.cityZh, latitude: round1(site.latitude), longitude: round1(site.longitude) } : null,
  };
}

/** Exactly the four identity fields, as the user chose them. */
export function identityPatch(p: IdentityProposal, choice: { timezone: string; languages: LanguageChoice; location: LocationChoice }, current: Pick<Profile, 'timezone' | 'locale' | 'acceptLanguages'>): Pick<ProfilePatch, 'timezone' | 'locale' | 'acceptLanguages' | 'geolocation'> {
  const languages = choice.languages === 'keep' || !p.languages.length ? null
    : choice.languages === 'both' ? [...new Set([p.languages[0], current.locale])] : p.languages;
  return {
    timezone: choice.timezone || p.timezone || current.timezone,
    locale: languages ? languages[0] : current.locale,
    acceptLanguages: languages ?? current.acceptLanguages,
    geolocation: choice.location === 'city' && p.city ? { latitude: p.city.latitude, longitude: p.city.longitude, accuracy: CITY_ACCURACY } : null,
  };
}
