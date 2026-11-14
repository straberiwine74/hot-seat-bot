import { normalizeForSearch, type GameType } from './constants';

/** Cleans up a submission: trims, collapses whitespace, strips redundant lead-ins. */
export function normalizePromptText(type: GameType, raw: string, part: 'a' | 'b' = 'a'): string {
  let t = raw.replace(/\s+/g, ' ').trim();
  if (type === 'nhie') t = t.replace(/^never\s+have\s+i\s+ever[\s,.:…-]*/i, '');
  if (type === 'wyr' && part === 'a') t = t.replace(/^would\s+you\s+rather[\s,.:…-]*/i, '');
  if (type === 'wyr' && part === 'b') t = t.replace(/^or[\s,.:…-]+/i, '');
  if (type === 'nhie' || type === 'wyr') t = t.replace(/[?.!]+$/, '');
  return t.trim();
}

// Words that appear in tons of prompts and say nothing about the topic.
const STOPWORDS = new Set((
  'a an the and or but if of to in on at by for from with without about into over under than then so as ' +
  'i me my mine we us our you your yours he him his she her they them their it its this that these those ' +
  'is are was were be been being am do does did done have has had having will would could should can may might ' +
  'ever never rather what whats which who whom whose when where why how most least more less very really just ' +
  'one someone somebody something anyone anything everyone thing things time times got get getting go going ' +
  'not no yes all any some each other else own same too also only still even'
).split(' '));

function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Topic words of a prompt: accent-folded, lowercased, stopwords dropped, lightly stemmed. */
export function topicWords(s: string): Set<string> {
  const words = normalizeForSearch(s).replace(/['’]/g, '').split(/[^a-z0-9]+/);
  return new Set(words.filter((w) => w.length >= 3 && !STOPWORDS.has(w)).map(stem));
}

/** 0–1 overlap of topic words (Dice coefficient). */
export function topicOverlap(a: string, b: string): number {
  const A = topicWords(a), B = topicWords(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return (2 * shared) / (A.size + B.size);
}
