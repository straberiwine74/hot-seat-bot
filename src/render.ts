// Builds the messages (embeds + buttons) players see.
import { GAMES, categoryName, type GameType, type Rating, BOT_NAME } from './constants';
import type { Prompt } from './db';
import { button, row, ButtonStyle } from './discord';

const NO_CAT = '-';

/**
 * custom_id for a "next card" button: next:<game>:<rating>:<category>
 * rating 'auto' = no rating was picked, so re-apply the server's current default on every click.
 */
export function nextId(game: GameType | 'tod', rating: Rating | 'auto', category: string | null): string {
  return `next:${game}:${rating}:${category ?? NO_CAT}`;
}

export function parseCategory(raw: string | undefined): string | null {
  return !raw || raw === NO_CAT ? null : raw;
}

export function promptBody(p: Pick<Prompt, 'type' | 'text' | 'option_b'>): string {
  switch (p.type) {
    case 'nhie':
      return `Never have I ever… **${p.text}**`;
    case 'wyr':
      return `Would you rather…\n\n🅰️ **${p.text}**\n\n*— or —*\n\n🅱️ **${p.option_b ?? ''}**`;
    default:
      return `**${p.text}**`;
  }
}

export function promptFooter(p: Prompt): string {
  const parts = [`#${p.id}`, categoryName(p.category)];
  if (p.show_credit && p.submitted_by_name) parts.push(`Submitted by ${p.submitted_by_name}`);
  return parts.join(' • ');
}

export function promptCard(
  p: Prompt,
  opts: { rating: Rating | 'auto'; category: string | null; requestedBy: string },
) {
  const g = GAMES[p.type];
  const isTod = p.type === 'truth' || p.type === 'dare';
  const embed = {
    author: { name: isTod ? `${opts.requestedBy} is in the Hot Seat` : `${opts.requestedBy} asked everyone` },
    title: `${g.emoji} ${g.label}${p.is_adult ? ' 🔥' : ''}`,
    description: promptBody(p),
    color: g.color,
    footer: { text: promptFooter(p) },
  };

  const report = button(`report:${p.id}`, 'Report', ButtonStyle.SECONDARY, '🚩');
  let gameRow;
  if (p.type === 'truth' || p.type === 'dare') {
    gameRow = row(
      button(nextId('truth', opts.rating, opts.category), 'Truth', ButtonStyle.PRIMARY),
      button(nextId('dare', opts.rating, opts.category), 'Dare', ButtonStyle.DANGER),
      button(nextId('tod', opts.rating, opts.category), 'Random', ButtonStyle.SUCCESS, '🎲'),
      report,
    );
  } else if (p.type === 'nhie') {
    gameRow = row(
      button('vote:0', voteLabel('nhie', 0, 0), ButtonStyle.SUCCESS),
      button('vote:1', voteLabel('nhie', 1, 0), ButtonStyle.SECONDARY),
      button(nextId('nhie', opts.rating, opts.category), 'Next', ButtonStyle.PRIMARY, '➡️'),
      report,
    );
  } else {
    gameRow = row(
      button('vote:0', voteLabel('wyr', 0, 0), ButtonStyle.PRIMARY),
      button('vote:1', voteLabel('wyr', 1, 0), ButtonStyle.DANGER),
      button(nextId('wyr', opts.rating, opts.category), 'Next', ButtonStyle.SUCCESS, '➡️'),
      report,
    );
  }
  return { embeds: [embed], components: [gameRow] };
}

export function voteLabel(game: 'nhie' | 'wyr', choice: 0 | 1, count: number): string {
  if (game === 'nhie') return choice === 0 ? `🙋 I have (${count})` : `🙅 Never (${count})`;
  return choice === 0 ? `🅰️ (${count})` : `🅱️ (${count})`;
}

export function helpEmbed(inviteUrl?: string) {
  return {
    title: `🔥 ${BOT_NAME}`,
    color: 0xef4444,
    description:
      'Party games for any server. Every card has buttons so the game keeps rolling.\n\n' +
      '**Play**\n' +
      '`/tod` — random Truth or Dare\n' +
      '`/truth` · `/dare` — pick your poison\n' +
      '`/nhie` — Never Have I Ever (vote with buttons)\n' +
      '`/wyr` — Would You Rather (vote with buttons)\n' +
      'All games take optional `category` and `rating` filters.\n\n' +
      '**Contribute**\n' +
      '`/submit` — suggest a truth, dare, NHIE, or WYR for the shared deck\n' +
      '🚩 on any card — report a prompt that doesn\'t belong\n\n' +
      '**Server admins**\n' +
      '`/settings view` · `/settings adult` · `/settings adult-channels` · `/settings admin-role`\n' +
      '18+ prompts only appear in channels marked **Age-Restricted**, or anywhere in a server set to Age-Restricted.' +
      (inviteUrl ? `\n\n**Support:** ${inviteUrl}` : ''),
  };
}
