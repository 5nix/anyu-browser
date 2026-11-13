export const ACCENTS = ['teal', 'blue', 'indigo', 'violet', 'berry', 'ochre', 'moss'] as const;
export type Accent = typeof ACCENTS[number];
export type Theme = 'system' | 'light' | 'dark';
export function accentValue(value: unknown): Accent { return ACCENTS.includes(value as Accent) ? value as Accent : 'teal'; }
export function themeValue(value: unknown): Theme { return value === 'light' || value === 'dark' ? value : 'system'; }
