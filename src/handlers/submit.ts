// /submit → modal → saved as approved (trusted submitters) or pending (everyone else).
import type { Env } from '../env';
import {
  GAMES, CATEGORY_VALUES, categoryName, MAX_PENDING_PER_USER, MAX_PROMPT_LENGTH, MAX_WYR_OPTION_LENGTH,
  type GameType,
} from '../constants';
import { getSql, insertPrompt, isTrusted, countPending } from '../db';
import {
  displayName, ephemeral, getModalValues, getOptions, getUser, modal, textInput, TextInputStyle,
  type Interaction,
} from '../discord';
import { postForReview } from './review';
import { normalizePromptText } from '../text';

const GAME_TYPES = new Set<GameType>(['truth', 'dare', 'nhie', 'wyr']);

export async function handleSubmitCommand(i: Interaction) {
  if (!i.guild_id) return ephemeral('Please submit from inside a server.');
  const o = getOptions(i.data);
  const game = o.game as GameType;
  if (!GAME_TYPES.has(game)) return ephemeral('Pick a game type.');
  const category = CATEGORY_VALUES.has(o.category) ? o.category : 'general';
  const adult = o.adult === true ? 1 : 0;
  const credit = o.credit === true ? 1 : 0;
  const id = `submit:${game}:${category}:${adult}:${credit}`;

  const title = `Submit a ${GAMES[game].label}`.slice(0, 45);
  if (game === 'wyr') {
    return modal({
      custom_id: id,
      title,
      components: [
        textInput('text', 'Would you rather… (option A)', {
          max: MAX_WYR_OPTION_LENGTH,
          placeholder: 'only be able to whisper',
        }),
        textInput('option_b', '…or (option B)', { max: MAX_WYR_OPTION_LENGTH, placeholder: 'only be able to shout' }),
      ],
    });
  }
  const placeholder =
    game === 'nhie' ? 'Never have I ever… (just the ending, e.g. "fallen asleep in a meeting")'
      : game === 'truth' ? 'What\'s the most embarrassing song on your playlist?'
        : 'Talk in a pirate accent until your next turn.';
  return modal({
    custom_id: id,
    title,
    components: [
      textInput('text', game === 'nhie' ? 'Never have I ever…' : `Your ${GAMES[game].label.toLowerCase()}`, {
        style: TextInputStyle.PARAGRAPH,
        max: MAX_PROMPT_LENGTH,
        min: 3,
        placeholder: placeholder.slice(0, 100),
      }),
    ],
  });
}

/** Modal: submit:<game>:<category>:<adult>:<credit> */
export async function handleSubmitModal(i: Interaction, env: Env, ctx: ExecutionContext, parts: string[]) {
  const [, gameRaw, catRaw, adultRaw, creditRaw] = parts;
  const game = gameRaw as GameType;
  if (!GAME_TYPES.has(game)) return ephemeral('Unknown game type.');
  const category = CATEGORY_VALUES.has(catRaw) ? catRaw : 'general';

  const v = getModalValues(i.data);
  const text = normalizePromptText(game, v.text ?? '', 'a');
  const optionB = game === 'wyr' ? normalizePromptText('wyr', v.option_b ?? '', 'b') : null;
  if (text.length < 3 || (game === 'wyr' && (!optionB || optionB.length < 2))) {
    return ephemeral('That one\'s a little too short — give it another try!');
  }

  const sql = getSql(env);
  const user = getUser(i);
  const trusted = await isTrusted(sql, env, user.id);
  if (!trusted && (await countPending(sql, user.id)) >= MAX_PENDING_PER_USER) {
    return ephemeral(`You have ${MAX_PENDING_PER_USER} submissions waiting for review already. Hang tight until some are reviewed!`);
  }

  const prompt = await insertPrompt(sql, {
    type: game,
    text,
    option_b: optionB,
    is_adult: adultRaw === '1',
    category,
    status: trusted ? 'approved' : 'pending',
    submitted_by: user.id,
    submitted_by_name: displayName(user),
    show_credit: creditRaw === '1',
    source_guild_id: i.guild_id ?? null,
  });
  if (!prompt) return ephemeral('🙈 That one\'s already in the deck (or waiting for review). Try another!');

  const summary = `${GAMES[game].emoji} **${GAMES[game].label}** · ${categoryName(category)}${prompt.is_adult ? ' · 🔥 18+' : ''}`;
  if (trusted) return ephemeral(`✅ Added to the deck as #${prompt.id}. Thanks!\n${summary}`);

  ctx.waitUntil(postForReview(env, sql, prompt).catch((e) => console.error('postForReview', e)));
  return ephemeral(`📬 Thanks! Submission #${prompt.id} is waiting for review.\n${summary}`);
}
