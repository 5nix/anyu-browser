import { useEffect, useState } from 'preact/hooks';
import type { Locale } from '../shared/i18n/index.ts';

export function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const time = Date.now();
      setNow(new Date(time));
      timer = setTimeout(tick, 60000 - time % 60000);
    };
    tick();
    return () => clearTimeout(timer);
  }, []);
  return now;
}

export function clockTime(now: Date, locale: Locale, timezone: string, clock24Hour: boolean, date = false): string {
  const options: Intl.DateTimeFormatOptions = { timeZone: timezone || undefined, hour: '2-digit', minute: '2-digit', hourCycle: clock24Hour ? 'h23' : 'h12' };
  if (date) Object.assign(options, { weekday: 'short', month: 'short', day: 'numeric' });
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', options).format(now);
}
