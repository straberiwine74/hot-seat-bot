import { neon } from '@neondatabase/serverless';
import type { Env } from './env';
import { ownerIds } from './env';
import type { AdultDefault, GameType } from './constants';
import { topicOverlap } from './text';

/** Tagged-template SQL function (Neon's HTTP driver; a pg adapter is used in tests). */
export type Sql = (strings: TemplateStringsArray, ...values: any[]) => Promise<any[]>;

export function getSql(env: Env): Sql {
  return neon(env.DATABASE_URL) as unknown as Sql;
}

export interface Prompt {
  id: number;
  type: GameType;
  text: string;
  option_b: string | null;
  is_adult: boolean;
  category: string;
  status: 'pending' | 'approved' | 'rejected' | 'removed';
  submitted_by: string | null;
  submitted_by_name: string | null;
  show_credit: boolean;
  source_guild_id: string | null;
  review_message_id: string | null;
  reviewed_by: string | null;
  times_played: number;
}

export interface GuildSettings {
  guild_id: string;
  adult_enabled: boolean;
  adult_channel_ids: string[];
  adult_default: AdultDefault;
  admin_role_id: string | null;
  show_voters: boolean;
  guild_nsfw_level: number | null;
  guild_nsfw_checked_at: string | null;
  tier: string;
  premium_until: string | null;
}

// ── Guild settings ───────────────────────────────────────────
export async function getGuildSettings(sql: Sql, guildId: string): Promise<GuildSettings> {
  const rows = await sql`SELECT * FROM guild_settings WHERE guild_id = ${guildId}`;
  return (
    (rows[0] as GuildSettings) ?? {
      guild_id: guildId,
      adult_enabled: false,
      adult_channel_ids: [],
      adult_default: 'mix',
      admin_role_id: null,
      show_voters: true,
      guild_nsfw_level: null,
      guild_nsfw_checked_at: null,
      tier: 'free',
      premium_until: null,
    }
  );
}

export async function touchGuild(sql: Sql, guildId: string): Promise<void> {
  await sql`INSERT INTO guild_settings (guild_id) VALUES (${guildId})
            ON CONFLICT (guild_id) DO UPDATE SET last_active_at = NOW()`;
}

/** `mode` null = keep the server's current default. */
export async function setAdultEnabled(sql: Sql, guildId: string, enabled: boolean, mode: AdultDefault | null): Promise<void> {
  await sql`INSERT INTO guild_settings (guild_id, adult_enabled, adult_default)
            VALUES (${guildId}, ${enabled}, COALESCE(${mode}::text, 'mix'))
            ON CONFLICT (guild_id) DO UPDATE SET adult_enabled = EXCLUDED.adult_enabled,
              adult_default = COALESCE(${mode}::text, guild_settings.adult_default), updated_at = NOW()`;
}

export async function setAdultChannels(sql: Sql, guildId: string, channelIds: string[]): Promise<void> {
  await sql`INSERT INTO guild_settings (guild_id, adult_channel_ids) VALUES (${guildId}, ${channelIds}::text[])
            ON CONFLICT (guild_id) DO UPDATE SET adult_channel_ids = EXCLUDED.adult_channel_ids, updated_at = NOW()`;
}

export async function setAdminRole(sql: Sql, guildId: string, roleId: string | null): Promise<void> {
  await sql`INSERT INTO guild_settings (guild_id, admin_role_id) VALUES (${guildId}, ${roleId})
            ON CONFLICT (guild_id) DO UPDATE SET admin_role_id = EXCLUDED.admin_role_id, updated_at = NOW()`;
}

export async function setShowVoters(sql: Sql, guildId: string, show: boolean): Promise<void> {
  await sql`INSERT INTO guild_settings (guild_id, show_voters) VALUES (${guildId}, ${show})
            ON CONFLICT (guild_id) DO UPDATE SET show_voters = EXCLUDED.show_voters, updated_at = NOW()`;
}

export async function setGuildNsfwLevel(sql: Sql, guildId: string, level: number): Promise<void> {
  await sql`INSERT INTO guild_settings (guild_id, guild_nsfw_level, guild_nsfw_checked_at) VALUES (${guildId}, ${level}, NOW())
            ON CONFLICT (guild_id) DO UPDATE SET guild_nsfw_level = EXCLUDED.guild_nsfw_level,
                                                 guild_nsfw_checked_at = NOW()`;
}

export async function countApproved(sql: Sql, type: GameType, category: string | null, adult: boolean): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM prompts
    WHERE status = 'approved' AND type = ${type} AND is_adult = ${adult}
      AND (${category}::text IS NULL OR category = ${category}::text)`;
  return rows[0]?.n ?? 0;
}

// ── Picking prompts (with per-server no-repeat memory) ───────
async function pickUnseen(
  sql: Sql,
  guildId: string,
  type: GameType,
  category: string | null,
  adult: boolean | null,
): Promise<Prompt | null> {
  const rows = await sql`
    SELECT * FROM prompts p
    WHERE p.status = 'approved'
      AND p.type = ${type}
      AND (${category}::text IS NULL OR p.category = ${category}::text)
      AND (${adult}::boolean IS NULL OR p.is_adult = ${adult}::boolean)
      AND NOT EXISTS (SELECT 1 FROM guild_seen s WHERE s.guild_id = ${guildId} AND s.prompt_id = p.id)
    ORDER BY random()
    LIMIT 1`;
  return (rows[0] as Prompt) ?? null;
}

/**
 * Picks a random approved prompt this server hasn't seen. When the server has seen
 * everything matching the filters, that slice of its memory is reset and the deck reshuffles.
 * `adult`: false = clean only, true = 18+ only, null = mixed.
 */
export async function pickPrompt(
  sql: Sql,
  guildId: string,
  type: GameType,
  category: string | null,
  adult: boolean | null,
): Promise<Prompt | null> {
  const first = await pickUnseen(sql, guildId, type, category, adult);
  if (first) return first;
  const reset = await sql`
    DELETE FROM guild_seen s USING prompts p
    WHERE s.prompt_id = p.id
      AND s.guild_id = ${guildId}
      AND p.type = ${type}
      AND (${category}::text IS NULL OR p.category = ${category}::text)
      AND (${adult}::boolean IS NULL OR p.is_adult = ${adult}::boolean)
    RETURNING s.prompt_id`;
  if (reset.length === 0) return null; // pool is truly empty
  return pickUnseen(sql, guildId, type, category, adult);
}

export async function markSeen(sql: Sql, guildId: string, promptId: number): Promise<void> {
  await sql`INSERT INTO guild_seen (guild_id, prompt_id) VALUES (${guildId}, ${promptId}) ON CONFLICT DO NOTHING`;
  await sql`UPDATE prompts SET times_played = times_played + 1 WHERE id = ${promptId}`;
  await touchGuild(sql, guildId);
}

// ── Prompts CRUD ─────────────────────────────────────────────
export async function getPrompt(sql: Sql, id: number): Promise<Prompt | null> {
  const rows = await sql`SELECT * FROM prompts WHERE id = ${id}`;
  return (rows[0] as Prompt) ?? null;
}

export interface NewPrompt {
  type: GameType;
  text: string;
  option_b: string | null;
  is_adult: boolean;
  category: string;
  status: 'pending' | 'approved';
  submitted_by: string;
  submitted_by_name: string;
  show_credit: boolean;
  source_guild_id: string | null;
}

/** Returns the new prompt, or null if it's a duplicate of a live prompt. */
export async function insertPrompt(sql: Sql, p: NewPrompt): Promise<Prompt | null> {
  try {
    const rows = await sql`
      INSERT INTO prompts (type, text, option_b, is_adult, category, status,
                           submitted_by, submitted_by_name, show_credit, source_guild_id,
                           reviewed_at)
      VALUES (${p.type}, ${p.text}, ${p.option_b}, ${p.is_adult}, ${p.category}, ${p.status},
              ${p.submitted_by}, ${p.submitted_by_name}, ${p.show_credit}, ${p.source_guild_id},
              ${p.status === 'approved' ? new Date().toISOString() : null})
      RETURNING *`;
    return rows[0] as Prompt;
  } catch (e: any) {
    if (e?.code === '23505') return null; // unique violation = duplicate
    throw e;
  }
}

export async function setReviewMessage(sql: Sql, id: number, messageId: string): Promise<void> {
  await sql`UPDATE prompts SET review_message_id = ${messageId} WHERE id = ${id}`;
}

/** Moves a prompt to a new status only if it's currently in one of `from`. Returns the updated row or null. */
export async function transitionPrompt(
  sql: Sql,
  id: number,
  from: string[],
  to: Prompt['status'],
  reviewerId: string,
): Promise<Prompt | null> {
  try {
    const rows = await sql`
      UPDATE prompts SET status = ${to}, reviewed_by = ${reviewerId}, reviewed_at = NOW()
      WHERE id = ${id} AND status = ANY(${from}::text[])
      RETURNING *`;
    return (rows[0] as Prompt) ?? null;
  } catch (e: any) {
    if (e?.code === '23505') return null; // restoring would create a duplicate
    throw e;
  }
}

export async function editAndApprove(
  sql: Sql,
  id: number,
  fields: { text: string; option_b: string | null; category: string; is_adult: boolean },
  reviewerId: string,
): Promise<Prompt | null> {
  try {
    const rows = await sql`
      UPDATE prompts SET text = ${fields.text}, option_b = ${fields.option_b}, category = ${fields.category},
             is_adult = ${fields.is_adult}, status = 'approved', reviewed_by = ${reviewerId}, reviewed_at = NOW()
      WHERE id = ${id} AND status = 'pending'
      RETURNING *`;
    return (rows[0] as Prompt) ?? null;
  } catch (e: any) {
    if (e?.code === '23505') return null;
    throw e;
  }
}

export async function countPending(sql: Sql, userId: string): Promise<number> {
  const rows = await sql`SELECT COUNT(*)::int AS n FROM prompts WHERE submitted_by = ${userId} AND status = 'pending'`;
  return rows[0]?.n ?? 0;
}

// ── Search & similar prompts ─────────────────────────────────
export type SearchStatus = Prompt['status'] | 'all';

/** Case/accent-insensitive "contains any of these terms" search across prompt text (and WYR option B). */
export async function searchPrompts(
  sql: Sql,
  normalizedTerms: string[],
  type: GameType | null,
  status: SearchStatus,
  limit: number,
  offset: number,
): Promise<{ rows: Prompt[]; total: number }> {
  const patterns = normalizedTerms.map((t) => '%' + t.replace(/[\\%_]/g, (c) => '\\' + c) + '%');
  const st = status === 'all' ? null : status;
  const rows = await sql`
    SELECT * FROM prompts
    WHERE hs_norm(text || ' ' || COALESCE(option_b, '')) LIKE ANY(${patterns}::text[])
      AND (${type}::text IS NULL OR type = ${type}::text)
      AND (${st}::text IS NULL OR status = ${st}::text)
    ORDER BY id
    LIMIT ${limit} OFFSET ${offset}`;
  const count = await sql`
    SELECT COUNT(*)::int AS n FROM prompts
    WHERE hs_norm(text || ' ' || COALESCE(option_b, '')) LIKE ANY(${patterns}::text[])
      AND (${type}::text IS NULL OR type = ${type}::text)
      AND (${st}::text IS NULL OR status = ${st}::text)`;
  return { rows: rows as Prompt[], total: count[0]?.n ?? 0 };
}

/**
 * Live prompts (any game) about the same thing as `p` — shown on review cards.
 * Step 1: Postgres trigram similarity pulls the 50 closest-worded candidates.
 * Step 2: re-rank by shared topic words, so boilerplate like "Have you ever…" doesn't count.
 */
export async function findSimilar(
  sql: Sql,
  p: Pick<Prompt, 'id' | 'text' | 'option_b'>,
  minScore: number,
  limit = 3,
): Promise<Array<Prompt & { score: number }>> {
  const doc = p.text + ' ' + (p.option_b ?? '');
  const candidates = (await sql`
    SELECT p.* FROM prompts p
    WHERE p.id <> ${p.id} AND p.status IN ('approved', 'pending')
    ORDER BY similarity(hs_norm(p.text || ' ' || COALESCE(p.option_b, '')), hs_norm(${doc})) DESC
    LIMIT 50`) as Prompt[];
  return candidates
    .map((c) => ({ ...c, score: topicOverlap(doc, c.text + ' ' + (c.option_b ?? '')) }))
    .filter((c) => c.score >= minScore)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

// ── Trusted submitters ───────────────────────────────────────
export async function isTrusted(sql: Sql, env: Env, userId: string): Promise<boolean> {
  if (ownerIds(env).includes(userId)) return true;
  const rows = await sql`SELECT 1 FROM trusted_users WHERE user_id = ${userId}`;
  return rows.length > 0;
}

export async function trustUser(sql: Sql, userId: string, userName: string, addedBy: string): Promise<void> {
  await sql`INSERT INTO trusted_users (user_id, user_name, added_by) VALUES (${userId}, ${userName}, ${addedBy})
            ON CONFLICT (user_id) DO UPDATE SET user_name = EXCLUDED.user_name`;
}

export async function untrustUser(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql`DELETE FROM trusted_users WHERE user_id = ${userId} RETURNING user_id`;
  return rows.length > 0;
}

export async function listTrusted(sql: Sql): Promise<Array<{ user_id: string; user_name: string | null }>> {
  return (await sql`SELECT user_id, user_name FROM trusted_users ORDER BY added_at`) as any;
}

// ── Votes ────────────────────────────────────────────────────
/** Records (or changes) a vote and returns the user IDs on each side, oldest vote first. */
export async function castVote(sql: Sql, messageId: string, userId: string, choice: 0 | 1): Promise<[string[], string[]]> {
  await sql`INSERT INTO votes (message_id, user_id, choice) VALUES (${messageId}, ${userId}, ${choice})
            ON CONFLICT (message_id, user_id) DO UPDATE SET choice = EXCLUDED.choice`;
  const rows = await sql`SELECT user_id, choice FROM votes WHERE message_id = ${messageId} ORDER BY created_at`;
  const voters: [string[], string[]] = [[], []];
  for (const r of rows) voters[r.choice as 0 | 1].push(r.user_id as string);
  return voters;
}

export async function pruneVotes(sql: Sql): Promise<void> {
  await sql`DELETE FROM votes WHERE created_at < NOW() - INTERVAL '14 days'`;
}

// ── Reports ──────────────────────────────────────────────────
/** Returns the new report id, or null if this user already reported this prompt. */
export async function insertReport(
  sql: Sql,
  promptId: number,
  guildId: string | null,
  reporterId: string,
  reason: string,
): Promise<number | null> {
  const rows = await sql`
    INSERT INTO reports (prompt_id, guild_id, reporter_id, reason)
    VALUES (${promptId}, ${guildId}, ${reporterId}, ${reason})
    ON CONFLICT (prompt_id, reporter_id) DO NOTHING
    RETURNING id`;
  return rows[0]?.id ?? null;
}

export async function countOpenReports(sql: Sql, promptId: number): Promise<number> {
  const rows = await sql`SELECT COUNT(*)::int AS n FROM reports WHERE prompt_id = ${promptId} AND status = 'open'`;
  return rows[0]?.n ?? 0;
}

export async function resolveReports(sql: Sql, promptId: number, status: 'actioned' | 'dismissed', by: string): Promise<void> {
  await sql`UPDATE reports SET status = ${status}, resolved_by = ${by} WHERE prompt_id = ${promptId} AND status = 'open'`;
}

// ── Stats ────────────────────────────────────────────────────
export interface Stats {
  byType: Array<{ type: string; clean: number; adult: number; pending: number }>;
  guilds: number;
  active_guilds: number;
  plays: number;
  open_reports: number;
}

export async function getStats(sql: Sql): Promise<Stats> {
  const byType = await sql`
    SELECT type,
           COUNT(*) FILTER (WHERE status = 'approved' AND NOT is_adult)::int AS clean,
           COUNT(*) FILTER (WHERE status = 'approved' AND is_adult)::int AS adult,
           COUNT(*) FILTER (WHERE status = 'pending')::int AS pending
    FROM prompts GROUP BY type ORDER BY type`;
  const misc = await sql`
    SELECT (SELECT COUNT(*)::int FROM guild_settings) AS guilds,
           (SELECT COUNT(*)::int FROM guild_settings WHERE last_active_at > NOW() - INTERVAL '7 days') AS active_guilds,
           (SELECT COALESCE(SUM(times_played), 0)::int FROM prompts) AS plays,
           (SELECT COUNT(*)::int FROM reports WHERE status = 'open') AS open_reports`;
  return { byType: byType as Stats['byType'], ...(misc[0] as Omit<Stats, 'byType'>) };
}
