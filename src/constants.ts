export const BOT_NAME = 'The Hot Seat';

export type GameType = 'truth' | 'dare' | 'nhie' | 'wyr';
export type PlayGame = GameType | 'tod';
export type Rating = 'clean' | 'mix' | 'adult';
export type AdultDefault = 'mix' | 'adult';

export const GAMES: Record<GameType, { label: string; emoji: string; color: number }> = {
  truth: { label: 'Truth', emoji: '🤔', color: 0x3b82f6 },
  dare: { label: 'Dare', emoji: '😈', color: 0xef4444 },
  nhie: { label: 'Never Have I Ever', emoji: '🙊', color: 0xa855f7 },
  wyr: { label: 'Would You Rather', emoji: '⚖️', color: 0xf59e0b },
};

export const GAME_CHOICES = [
  { name: 'Truth', value: 'truth' },
  { name: 'Dare', value: 'dare' },
  { name: 'Never Have I Ever', value: 'nhie' },
  { name: 'Would You Rather', value: 'wyr' },
];

// Edit this list to change categories. Max 25 (Discord choice limit).
// `value` is stored in the database — don't rename a value once prompts use it.
export const CATEGORIES = [
  { name: 'General', value: 'general' },
  { name: 'Funny', value: 'funny' },
  { name: 'Deep', value: 'deep' },
  { name: 'Embarrassing', value: 'embarrassing' },
  { name: 'Flirty', value: 'flirty' },
  { name: 'Wild', value: 'wild' },
];

export const CATEGORY_VALUES = new Set(CATEGORIES.map((c) => c.value));

export function categoryName(value: string | null | undefined): string {
  return CATEGORIES.find((c) => c.value === value)?.name ?? 'General';
}

export const RATING_CHOICES = [
  { name: 'Clean only', value: 'clean' },
  { name: 'Mixed (clean + 18+)', value: 'mix' },
  { name: '18+ only', value: 'adult' },
];

// Accent folding for search — must match hs_norm() in db/schema.sql.
export const NORM_FROM = 'àáâãäåāèéêëēìíîïòóôõöøùúûüýÿçñ';
export const NORM_TO = 'aaaaaaaeeeeeiiiioooooouuuuyycn';
export function normalizeForSearch(s: string): string {
  let out = '';
  for (const ch of s.toLowerCase()) {
    const i = NORM_FROM.indexOf(ch);
    out += i >= 0 ? NORM_TO[i] : ch;
  }
  return out;
}

export const SEARCH_PAGE_SIZE = 20;
export const SIMILAR_MIN_SCORE = 0.5; // share of topic words in common (0–1)

export const MAX_PROMPT_LENGTH = 300;
export const MAX_WYR_OPTION_LENGTH = 150;
export const MAX_PENDING_PER_USER = 25;

export const COLOR_OK = 0x22c55e;
export const COLOR_BAD = 0xef4444;
export const COLOR_PENDING = 0xf59e0b;
export const COLOR_INFO = 0x5865f2;
