// Bulk-loads prompts from a CSV straight into the deck (approved, no review).
// Usage: npm run import -- seed/my-prompts.csv
//
// CSV columns (header row required):
//   type,text,option_b,category,adult,credit_name
//   type        truth | dare | nhie | wyr
//   text        the prompt (WYR: option A; NHIE: just the ending)
//   option_b    WYR option B (blank for other games)
//   category    general | funny | deep | embarrassing | flirty | wild   (blank = general)
//   adult       yes / no   (blank = no)
//   credit_name optional name to show as "Submitted by …"
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
import { CATEGORY_VALUES, type GameType } from '../src/constants';
import { normalizePromptText } from '../src/text';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run import -- path/to/prompts.csv');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL in .dev.vars');
  process.exit(1);
}

/** Small RFC-4180 CSV parser (handles quotes, escaped quotes, commas and newlines in fields). */
function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  const s = input.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const TYPES = new Set(['truth', 'dare', 'nhie', 'wyr']);
const [header, ...data] = parseCsv(readFileSync(file, 'utf8'));
const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
const idx = { type: col('type'), text: col('text'), option_b: col('option_b'), category: col('category'), adult: col('adult'), credit: col('credit_name') };
if (idx.type < 0 || idx.text < 0) {
  console.error('CSV needs at least "type" and "text" columns.');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
let added = 0, dupes = 0;
const errors: string[] = [];

for (const [n, r] of data.entries()) {
  const line = n + 2;
  const get = (k: keyof typeof idx) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '');
  const type = get('type').toLowerCase() as GameType;
  if (!TYPES.has(type)) { errors.push(`line ${line}: bad type "${get('type')}"`); continue; }
  const text = normalizePromptText(type, get('text'), 'a');
  const optionB = type === 'wyr' ? normalizePromptText('wyr', get('option_b'), 'b') : null;
  if (!text || (type === 'wyr' && !optionB)) { errors.push(`line ${line}: missing text${type === 'wyr' ? '/option_b' : ''}`); continue; }
  const category = (get('category') || 'general').toLowerCase();
  if (!CATEGORY_VALUES.has(category)) { errors.push(`line ${line}: unknown category "${category}"`); continue; }
  const adult = /^(y|yes|true|1)$/i.test(get('adult'));
  const credit = get('credit');

  const rows = await sql`
    INSERT INTO prompts (type, text, option_b, is_adult, category, status, submitted_by, submitted_by_name, show_credit, reviewed_at)
    VALUES (${type}, ${text}, ${optionB}, ${adult}, ${category}, 'approved', 'import', ${credit || null}, ${!!credit}, NOW())
    ON CONFLICT DO NOTHING
    RETURNING id`;
  if (rows.length) added++; else dupes++;
}

console.log(`✅ Added ${added} prompts. Skipped ${dupes} duplicates.`);
if (errors.length) console.log(`⚠️  ${errors.length} rows skipped:\n  ${errors.join('\n  ')}`);
