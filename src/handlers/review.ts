// Approval queue in the support server: Approve / Edit / Reject buttons.
import type { Env } from '../env';
import { ownerIds } from '../env';
import {
  GAMES, CATEGORY_VALUES, CATEGORIES, categoryName,
  COLOR_BAD, COLOR_OK, COLOR_PENDING, MAX_PROMPT_LENGTH, MAX_WYR_OPTION_LENGTH, SIMILAR_MIN_SCORE,
} from '../constants';
import { getSql, getPrompt, transitionPrompt, editAndApprove, setReviewMessage, findSimilar, type Prompt, type Sql } from '../db';
import {
  button, row, ButtonStyle, discordApi, displayName, ephemeral, getModalValues, getUser,
  modal, textInput, TextInputStyle, updateMessage, type Interaction,
} from '../discord';
import { promptBody, promptOneLiner } from '../render';
import { normalizePromptText } from '../text';

export function isReviewer(i: Interaction, env: Env): boolean {
  const user = getUser(i);
  if (ownerIds(env).includes(user.id)) return true;
  return (
    !!env.REVIEWER_ROLE_ID &&
    i.guild_id === env.SUPPORT_GUILD_ID &&
    (i.member?.roles ?? []).includes(env.REVIEWER_ROLE_ID)
  );
}

const SIMILAR_TITLE = '🔎 Similar prompts already in the deck';

type EmbedField = { name: string; value: string; inline?: boolean };

/** Builds the "similar prompts" field for a review card. */
export async function similarField(sql: Sql, p: Prompt): Promise<EmbedField> {
  const rows = await findSimilar(sql, p, SIMILAR_MIN_SCORE);
  const lines = rows.map((r) => `${promptOneLiner(r, 110)} · ${Math.round(r.score * 100)}% match${r.status === 'pending' ? ' · *pending*' : ''}`);
  return { name: SIMILAR_TITLE, value: (lines.join('\n') || 'None found — looks new! (Try `/hs-admin search` for other wordings.)').slice(0, 1024) };
}

/** Keeps the similar-prompts field when a review card is updated. */
function keepSimilar(i: Interaction): EmbedField | undefined {
  return (i.message?.embeds?.[0]?.fields ?? []).find((f: EmbedField) => f.name === SIMILAR_TITLE);
}

export function reviewEmbed(p: Prompt, statusLine?: string, similar?: EmbedField) {
  const g = GAMES[p.type];
  const color = p.status === 'approved' ? COLOR_OK : p.status === 'pending' ? COLOR_PENDING : COLOR_BAD;
  return {
    title: `${g.emoji} ${g.label} submission${p.is_adult ? ' 🔥 18+' : ''}`,
    description: promptBody(p),
    color,
    fields: [
      { name: 'Category', value: categoryName(p.category), inline: true },
      { name: 'Rating', value: p.is_adult ? '18+' : 'Clean', inline: true },
      { name: 'Credit shown', value: p.show_credit ? 'Yes' : 'No', inline: true },
      {
        name: 'Submitted by',
        value: p.submitted_by ? `<@${p.submitted_by}> (${p.submitted_by_name ?? 'unknown'})` : 'unknown',
        inline: true,
      },
      { name: 'From server', value: p.source_guild_id ?? '—', inline: true },
      ...(similar ? [similar] : []),
    ],
    footer: { text: `Prompt #${p.id}${statusLine ? ` • ${statusLine}` : ''}` },
  };
}

function reviewButtons(id: number) {
  return [
    row(
      button(`review:approve:${id}`, 'Approve', ButtonStyle.SUCCESS, '✅'),
      button(`review:edit:${id}`, 'Edit & approve', ButtonStyle.PRIMARY, '✏️'),
      button(`review:reject:${id}`, 'Reject', ButtonStyle.DANGER, '✖️'),
    ),
  ];
}

/** Posts a pending submission to the review channel. Called in the background after /submit. */
export async function postForReview(env: Env, sql: Sql, p: Prompt): Promise<void> {
  if (!env.REVIEW_CHANNEL_ID) return;
  let similar: EmbedField | undefined;
  try {
    similar = await similarField(sql, p);
  } catch (e) {
    console.error('similarField', e); // never block the review post on this
  }
  const msg = await discordApi<{ id: string }>(env, `/channels/${env.REVIEW_CHANNEL_ID}/messages`, 'POST', {
    embeds: [reviewEmbed(p, 'Pending review', similar)],
    components: reviewButtons(p.id),
    allowed_mentions: { parse: [] },
  });
  await setReviewMessage(sql, p.id, msg.id);
}

/** Button: review:<approve|edit|reject>:<id> */
export async function handleReviewButton(i: Interaction, env: Env, parts: string[]) {
  if (!isReviewer(i, env)) return ephemeral('Only Hot Seat reviewers can do that.');
  const [, action, idRaw] = parts;
  const id = Number(idRaw);
  const sql = getSql(env);
  const reviewer = getUser(i);

  if (action === 'edit') {
    const p = await getPrompt(sql, id);
    if (!p || p.status !== 'pending') return ephemeral(`Prompt #${id} is no longer pending.`);
    const isWyr = p.type === 'wyr';
    return modal({
      custom_id: `revedit:${id}`,
      title: `Edit #${id} before approving`,
      components: [
        textInput('text', isWyr ? 'Option A' : 'Prompt text', {
          style: TextInputStyle.PARAGRAPH,
          max: isWyr ? MAX_WYR_OPTION_LENGTH : MAX_PROMPT_LENGTH,
          value: p.text,
        }),
        ...(isWyr ? [textInput('option_b', 'Option B', { max: MAX_WYR_OPTION_LENGTH, value: p.option_b ?? '' })] : []),
        textInput('category', `Category (${CATEGORIES.map((c) => c.value).join(', ')})`.slice(0, 45), {
          max: 30,
          value: p.category,
        }),
        textInput('adult', '18+? (yes / no)', { max: 3, value: p.is_adult ? 'yes' : 'no' }),
      ],
    });
  }

  const to = action === 'approve' ? 'approved' : 'rejected';
  const updated = await transitionPrompt(sql, id, ['pending'], to, reviewer.id);
  if (!updated) {
    const current = await getPrompt(sql, id);
    if (!current) return updateMessage({ content: `Prompt #${id} no longer exists.`, embeds: [], components: [] });
    return updateMessage({ embeds: [reviewEmbed(current, `Already ${current.status}`, keepSimilar(i))], components: [] });
  }
  const verb = to === 'approved' ? '✅ Approved' : '✖️ Rejected';
  return updateMessage({ embeds: [reviewEmbed(updated, `${verb} by ${displayName(reviewer)}`, keepSimilar(i))], components: [] });
}

/** Modal: revedit:<id> */
export async function handleReviewEditModal(i: Interaction, env: Env, parts: string[]) {
  if (!isReviewer(i, env)) return ephemeral('Only Hot Seat reviewers can do that.');
  const id = Number(parts[1]);
  const sql = getSql(env);
  const p = await getPrompt(sql, id);
  if (!p) return ephemeral(`Prompt #${id} no longer exists.`);

  const v = getModalValues(i.data);
  const category = (v.category ?? '').trim().toLowerCase();
  if (!CATEGORY_VALUES.has(category)) {
    return ephemeral(`"${category}" isn't a category. Use one of: ${[...CATEGORY_VALUES].join(', ')}. Nothing was saved.`);
  }
  const adultRaw = (v.adult ?? '').trim().toLowerCase();
  if (!['yes', 'no', 'y', 'n'].includes(adultRaw)) return ephemeral('18+ must be "yes" or "no". Nothing was saved.');

  const text = normalizePromptText(p.type, v.text ?? '', 'a');
  const option_b = p.type === 'wyr' ? normalizePromptText('wyr', v.option_b ?? '', 'b') : null;
  if (!text || (p.type === 'wyr' && !option_b)) return ephemeral('Prompt text can\'t be empty. Nothing was saved.');

  const reviewer = getUser(i);
  const updated = await editAndApprove(sql, id, { text, option_b, category, is_adult: adultRaw.startsWith('y') }, reviewer.id);
  if (!updated) return ephemeral(`Couldn't save #${id} — it's no longer pending, or the edit duplicates an existing prompt.`);
  return updateMessage({
    embeds: [reviewEmbed(updated, `✏️ Edited & approved by ${displayName(reviewer)}`, keepSimilar(i))],
    components: [],
  });
}
