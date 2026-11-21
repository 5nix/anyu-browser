import type { ComponentChildren } from 'preact';
import type { Accent } from '../shared/appearance.ts';

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** A CJK name gives its first character; any other name the first letters of its first two words, or its first character. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = Array.from(words[0] ?? '')[0] ?? '';
  if (CJK.test(first)) return first;
  const second = Array.from(words[1] ?? '')[0];
  return (second && /[\p{L}\p{N}]/u.test(second) && /\p{L}/u.test(first) ? first + second : first).toUpperCase();
}

export function Avatar({ name, accent, big, children }: { name: string; accent?: Accent; big?: boolean; children?: ComponentChildren }) {
  const text = initials(name);
  return <span class={`avatar ${accent ?? 'teal'}${big ? ' big' : ''}${CJK.test(text) ? '' : ' latin'}`} aria-hidden="true">{text}{children}</span>;
}
