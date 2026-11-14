import type { Env } from '../env';
import { GAMES, CATEGORY_VALUES, categoryName, type GameType, type PlayGame, type Rating } from '../constants';
import {
  getSql, getGuildSettings, pickPrompt, markSeen, castVote, setGuildNsfwLevel, countApproved,
  type GuildSettings, type Sql,
} from '../db';
import { discordApi, displayName, ephemeral, getOptions, getUser, reply, updateMessage, type Interaction } from '../discord';
import { parseCategory, promptCard, voteLabel } from '../render';
import { getTier, hasFeature } from '../premium';

const THREAD_TYPES = new Set([10, 11, 12]);
const AGE_RESTRICTED_SERVER = 3; // Discord guild nsfw_level
const UNKNOWN_LEVEL = -1; // we tried to check and Discord wouldn't tell us
const SERVER_CHECK_TTL_MS = 6 * 60 * 60 * 1000;

export const CANT_CHECK_SERVER =
  '⚠️ I can\'t check whether this server is set to Age-Restricted, so 18+ only works in channels marked Age-Restricted. ' +
  'Fix: re-add the bot with its install link (that lets it read the server setting), then run `/settings view`.';

export interface ServerAgeCheck {
  restricted: boolean;
  /** true when Discord wouldn't tell us (usually: the bot user isn't in the server). */
  failed: boolean;
}

/**
 * Is the whole server set to "Age-Restricted Server" in Discord? In those servers the
 * per-channel Age-Restricted toggle isn't available, so we check the server-level setting.
 * Cached in guild_settings; re-checked every 6 hours (or immediately when `force`).
 * Failures are cached too, so a server we can't read doesn't trigger a lookup on every card.
 */
export async function checkAgeRestrictedServer(env: Env, sql: Sql, s: GuildSettings, force = false): Promise<ServerAgeCheck> {
  const fresh = s.guild_nsfw_checked_at && Date.now() - new Date(s.guild_nsfw_checked_at).getTime() < SERVER_CHECK_TTL_MS;
  if (!force && fresh) {
    return { restricted: s.guild_nsfw_level === AGE_RESTRICTED_SERVER, failed: s.guild_nsfw_level === UNKNOWN_LEVEL };
  }
  let failed = false;
  try {
    const guild = await discordApi<{ nsfw_level: number }>(env, `/guilds/${s.guild_id}`);
    s.guild_nsfw_level = guild.nsfw_level ?? 0;
  } catch (e) {
    console.error('guild nsfw check failed', s.guild_id, e);
    failed = true;
    // Keep the last known answer if we had one; otherwise remember that we couldn't check.
    if (s.guild_nsfw_level === null || s.guild_nsfw_level === undefined) s.guild_nsfw_level = UNKNOWN_LEVEL;
  }
  s.guild_nsfw_checked_at = new Date().toISOString();
  await setGuildNsfwLevel(sql, s.guild_id, s.guild_nsfw_level!);
  return {
    restricted: s.guild_nsfw_level === AGE_RESTRICTED_SERVER,
    failed: failed || s.guild_nsfw_level === UNKNOWN_LEVEL,
  };
}

/**
 * 18+ rules: enabled by admins, AND (the whole server is Age-Restricted OR this channel is
 * marked Age-Restricted), AND (if the admin picked channels) this channel is on the list.
 */
export function adultAllowed(settings: GuildSettings, i: Interaction, serverRestricted: boolean): boolean {
  if (!settings.adult_enabled || !i.channel) return false;
  const isThread = THREAD_TYPES.has(i.channel.type);
  const ageOk = serverRestricted || (!isThread && i.channel.nsfw === true);
  if (!ageOk) return false;
  const list = settings.adult_channel_ids ?? [];
  const channelId = isThread ? i.channel.parent_id ?? i.channel.id : i.channel.id;
  return list.length === 0 || list.includes(channelId);
}

interface AdultGate {
  allowed: boolean;
  serverRestricted: boolean;
  checkFailed: boolean;
}

/** Only calls Discord when it matters: 18+ is on and the channel itself isn't flagged. */
async function resolveAdultAllowed(env: Env, sql: Sql, s: GuildSettings, i: Interaction): Promise<AdultGate> {
  if (!s.adult_enabled) return { allowed: false, serverRestricted: false, checkFailed: false };
  const channelFlagged = !!i.channel && !THREAD_TYPES.has(i.channel.type) && i.channel.nsfw === true;
  const check = channelFlagged ? { restricted: false, failed: false } : await checkAgeRestrictedServer(env, sql, s);
  return { allowed: adultAllowed(s, i, check.restricted), serverRestricted: check.restricted, checkFailed: check.failed };
}

function adultBlockedReason(settings: GuildSettings, i: Interaction, gate: AdultGate): string {
  if (!settings.adult_enabled) {
    return '🔒 18+ prompts are turned off on this server. A server admin can turn them on with `/settings adult`.';
  }
  if (!gate.serverRestricted) {
    if (gate.checkFailed) return CANT_CHECK_SERVER;
    if (!i.channel || THREAD_TYPES.has(i.channel.type)) {
      return '🔒 18+ prompts can\'t be played in threads here. Try the parent channel.';
    }
    if (i.channel.nsfw !== true) {
      return '🔒 18+ prompts only appear in channels marked **Age-Restricted** (or servers set to Age-Restricted) in Discord.';
    }
  }
  const list = settings.adult_channel_ids.map((id) => `<#${id}>`).join(', ');
  return `🔒 On this server, 18+ prompts are limited to: ${list}`;
}

const RATING_LABEL: Record<Rating, string> = { clean: 'clean', mix: '', adult: '18+' };

/** Explains an empty draw — including when the *other* rating has cards the player can't (or didn't) get. */
async function emptyPoolMessage(
  sql: Sql,
  settings: GuildSettings,
  i: Interaction,
  gate: AdultGate,
  type: GameType,
  category: string | null,
  rating: Rating,
  playerPicked: boolean,
): Promise<string> {
  const label = GAMES[type].label;
  const cat = category ? ` in **${categoryName(category)}**` : '';
  const what = `${RATING_LABEL[rating] ? RATING_LABEL[rating] + ' ' : ''}${label}`;
  const nudge = 'Help fill the deck with `/submit`!';

  if (rating === 'clean') {
    const adultCount = await countApproved(sql, type, category, true);
    if (adultCount > 0) {
      return `😅 No clean ${label} cards${cat} yet. There are 18+ ones, but 18+ isn't available here:\n` +
        `${adultBlockedReason(settings, i, gate)}\n${nudge}`;
    }
  }
  if (rating === 'adult') {
    const cleanCount = await countApproved(sql, type, category, false);
    if (cleanCount > 0) {
      const why = playerPicked ? 'you asked for 18+ only' : 'this server is set to 18+ only';
      return `😅 No 18+ ${label} cards${cat} yet (${why}). There are clean ones — try \`rating: Mixed\` or \`rating: Clean only\`.\n${nudge}`;
    }
  }
  return `😅 The ${what} deck${cat} is empty right now.\n${nudge}`;
}

export async function handlePlayCommand(i: Interaction, env: Env, ctx: ExecutionContext, game: PlayGame) {
  const o = getOptions(i.data);
  return play(i, env, ctx, game, (o.rating as Rating) ?? null, o.category ?? null);
}

/** Button: next:<game>:<rating|auto>:<category> */
export async function handleNextButton(i: Interaction, env: Env, ctx: ExecutionContext, parts: string[]) {
  const [, game, rating, cat] = parts;
  const requested = rating === 'clean' || rating === 'mix' || rating === 'adult' ? (rating as Rating) : null;
  return play(i, env, ctx, game as PlayGame, requested, parseCategory(cat), true);
}

async function play(
  i: Interaction,
  env: Env,
  ctx: ExecutionContext,
  game: PlayGame,
  requestedRating: Rating | null,
  category: string | null,
  fromButton = false,
) {
  if (!i.guild_id) return ephemeral('The Hot Seat only works inside servers.');
  if (category && !CATEGORY_VALUES.has(category)) category = null;

  const sql = getSql(env);
  const settings = await getGuildSettings(sql, i.guild_id);
  const tier = getTier(settings, i);
  if (category && !hasFeature(tier, 'categoryFilter')) category = null;

  const gate = await resolveAdultAllowed(env, sql, settings, i);
  gate.allowed = gate.allowed && hasFeature(tier, 'adultContent');
  const serverDefault: Rating = settings.adult_default === 'adult' ? 'adult' : 'mix';
  let rating: Rating = requestedRating ?? (gate.allowed ? serverDefault : 'clean');
  if (rating !== 'clean' && !gate.allowed) {
    // Explicit 18+ request (or a button from an old 18+ card) → explain; "mix" quietly falls back to clean.
    if (rating === 'adult' || (!fromButton && requestedRating === 'mix')) return ephemeral(adultBlockedReason(settings, i, gate));
    rating = 'clean';
  }

  const type: GameType = game === 'tod' ? (Math.random() < 0.5 ? 'truth' : 'dare') : game;
  const adultFilter = rating === 'clean' ? false : rating === 'adult' ? true : null;
  const prompt = await pickPrompt(sql, i.guild_id, type, category, adultFilter);
  if (!prompt) {
    return ephemeral(await emptyPoolMessage(sql, settings, i, gate, type, category, rating, requestedRating !== null));
  }

  ctx.waitUntil(markSeen(sql, i.guild_id, prompt.id).catch((e) => console.error('markSeen', e)));
  // Buttons keep an explicit rating; otherwise 'auto' so each click follows the server's current settings.
  return reply(promptCard(prompt, { rating: requestedRating ?? 'auto', category, requestedBy: displayName(getUser(i)) }));
}

/** Button: vote:<0|1> on an NHIE / WYR card. Updates the counts on the button labels. */
export async function handleVoteButton(i: Interaction, env: Env, parts: string[]) {
  const choice = parts[1] === '1' ? 1 : 0;
  const msg = i.message;
  if (!msg) return ephemeral('That card is no longer available.');

  const counts = await castVote(getSql(env), msg.id, getUser(i).id, choice);
  const isNhie = (msg.embeds?.[0]?.title ?? '').includes(GAMES.nhie.label);
  const game = isNhie ? 'nhie' : 'wyr';

  const components = (msg.components ?? []).map((r: any) => ({
    ...r,
    components: (r.components ?? []).map((c: any) => {
      if (c.custom_id === 'vote:0') return { ...c, label: voteLabel(game, 0, counts[0]) };
      if (c.custom_id === 'vote:1') return { ...c, label: voteLabel(game, 1, counts[1]) };
      return c;
    }),
  }));
  return updateMessage({ embeds: msg.embeds, components });
}
