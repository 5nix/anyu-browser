import { zh } from './zh.ts';
import { en } from './en.ts';

export type Locale = 'zh' | 'en';
export type LocalePreference = Locale | 'system';
export type TranslationKey = keyof typeof zh;
let locale: Locale = 'zh';

export function setLocale(value: Locale): void { locale = value; }
export function systemLocale(tag: string): Locale { return /^zh/i.test(tag) ? 'zh' : 'en'; }
export function t(key: TranslationKey, params: Record<string, string | number> = {}): string {
  return (locale === 'zh' ? zh : en)[key].replace(/\{([^{}]+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match);
}

export function historyDay(date: Date, now = new Date()): string {
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const difference = (day(now) - day(date)) / 86400000;
  if (difference === 0) return t('history_today');
  if (difference === 1) return t('history_yesterday');
  return date.toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}
