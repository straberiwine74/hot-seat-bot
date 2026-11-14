// 🚩 Report button on cards → reason modal → posted to the support server's report channel.
import type { Env } from '../env';
import { COLOR_BAD, COLOR_OK, COLOR_PENDING, GAMES, categoryName } from '../constants';
import {
  getSql, getPrompt, insertReport, countOpenReports, transitionPrompt, resolveReports, type Prompt,
} from '../db';
import {
  button, row, ButtonStyle, discordApi, displayName, ephemeral, getModalValues, getUser, modal,
  textInput, TextInputStyle, updateMessage, type Interaction,
} from '../discord';
import { promptBody } from '../render';
import { isReviewer } from './review';

/** Distinct open reports that automatically pull a prompt from the deck until a reviewer decides. */
export const AUTO_HIDE_REPORTS = 3;
const AUTO = 'auto-reports';

/** Button: report:<promptId> */
export function handleReportButton(parts: string[]) {
  const id = Number(parts[1]);
  return modal({
    custom_id: `reportmodal:${id}`,
    title: `Report prompt #${id}`,
    components: [
      textInput('reason', 'What\'s wrong with it?', {
        style: TextInputStyle.PARAGRAPH,
        max: 300,
        required: false,
        placeholder: 'Offensive, should be 18+, wrong category, duplicate, typo…',
      }),
    ],
  });
}

function reportEmbed(p: Prompt, reporter: string, reason: string, openCount: number) {
  const g = GAMES[p.type];
  return {
    title: `🚩 Report on ${g.label} #${p.id}${p.is_adult ? ' (18+)' : ''}`,
    description: promptBody(p),
    color: COLOR_PENDING,
    fields: [
      { name: 'Reason', value: reason || '*(none given)*' },
      { name: 'Reported by', value: reporter, inline: true },
      { name: 'Open reports', value: String(openCount), inline: true },
      { name: 'Category', value: categoryName(p.category), inline: true },
      { name: 'Prompt status', value: p.status, inline: true },
    ],
  };
}

/** Modal: reportmodal:<promptId> */
export async function handleReportModal(i: Interaction, env: Env, ctx: ExecutionContext, parts: string[]) {
  const promptId = Number(parts[1]);
  const sql = getSql(env);
  const user = getUser(i);
  const reason = (getModalValues(i.data).reason ?? '').trim();

  const reportId = await insertReport(sql, promptId, i.guild_id ?? null, user.id, reason);
  if (reportId === null) return ephemeral('You\'ve already reported this one — thanks, we\'re on it.');

  ctx.waitUntil(
    (async () => {
      const open = await countOpenReports(sql, promptId);
      let p = await getPrompt(sql, promptId);
      if (!p) return;
      if (open >= AUTO_HIDE_REPORTS && p.status === 'approved') {
        p = (await transitionPrompt(sql, promptId, ['approved'], 'removed', AUTO)) ?? p;
      }
      if (!env.REPORT_CHANNEL_ID) return;
      await discordApi(env, `/channels/${env.REPORT_CHANNEL_ID}/messages`, 'POST', {
        content: p.status === 'removed' && p.reviewed_by === AUTO
          ? `⚠️ Auto-hidden after ${open} reports — Dismiss to restore it.`
          : undefined,
        embeds: [reportEmbed(p, `<@${user.id}> (${displayName(user)})`, reason, open)],
        components: [
          row(
            button(`repact:remove:${promptId}`, 'Remove from deck', ButtonStyle.DANGER, '🗑️'),
            button(`repact:dismiss:${promptId}`, 'Dismiss (keep)', ButtonStyle.SECONDARY, '👍'),
          ),
        ],
        allowed_mentions: { parse: [] },
      });
    })().catch((e) => console.error('report', e)),
  );
  return ephemeral('🚩 Thanks — the Hot Seat team will take a look.');
}

/** Button: repact:<remove|dismiss>:<promptId> */
export async function handleReportAction(i: Interaction, env: Env, parts: string[]) {
  if (!isReviewer(i, env)) return ephemeral('Only Hot Seat reviewers can do that.');
  const [, action, idRaw] = parts;
  const promptId = Number(idRaw);
  const sql = getSql(env);
  const reviewer = getUser(i);
  const embed = i.message?.embeds?.[0] ?? {};

  let statusLine: string;
  if (action === 'remove') {
    await transitionPrompt(sql, promptId, ['approved', 'pending'], 'removed', reviewer.id);
    await resolveReports(sql, promptId, 'actioned', reviewer.id);
    statusLine = `🗑️ Removed by ${displayName(reviewer)}`;
  } else {
    const p = await getPrompt(sql, promptId);
    // Only undo auto-hides; a reviewer's manual removal stays removed.
    if (p?.status === 'removed' && p.reviewed_by === AUTO) {
      await transitionPrompt(sql, promptId, ['removed'], 'approved', reviewer.id);
    }
    await resolveReports(sql, promptId, 'dismissed', reviewer.id);
    statusLine = `👍 Dismissed by ${displayName(reviewer)} — prompt kept`;
  }
  return updateMessage({ content: '', embeds: [{ ...embed, color: action === 'remove' ? COLOR_BAD : COLOR_OK, footer: { text: statusLine } }], components: [] });
}
