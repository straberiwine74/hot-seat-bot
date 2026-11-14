import type { GameType } from './constants';

/** Cleans up a submission: trims, collapses whitespace, strips redundant lead-ins. */
export function normalizePromptText(type: GameType, raw: string, part: 'a' | 'b' = 'a'): string {
  let t = raw.replace(/\s+/g, ' ').trim();
  if (type === 'nhie') t = t.replace(/^never\s+have\s+i\s+ever[\s,.:…-]*/i, '');
  if (type === 'wyr' && part === 'a') t = t.replace(/^would\s+you\s+rather[\s,.:…-]*/i, '');
  if (type === 'wyr' && part === 'b') t = t.replace(/^or[\s,.:…-]+/i, '');
  if (type === 'nhie' || type === 'wyr') t = t.replace(/[?.!]+$/, '');
  return t.trim();
}
