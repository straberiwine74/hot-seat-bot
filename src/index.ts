// The Hot Seat — Cloudflare Worker entry point.
// Discord POSTs every slash command / button / modal here (Interactions Endpoint URL).
import type { Env } from './env';
import { verifyDiscordRequest } from './verify';
import { InteractionType, ResponseType, ephemeral, json, reply, type Interaction } from './discord';
import { getSql, pruneVotes } from './db';
import { helpEmbed } from './render';
import { handlePlayCommand, handleNextButton, handleVoteButton } from './handlers/play';
import { handleSubmitCommand, handleSubmitModal } from './handlers/submit';
import { handleReviewButton, handleReviewEditModal } from './handlers/review';
import { handleReportButton, handleReportModal, handleReportAction } from './handlers/report';
import { handleSettingsCommand, handleSettingsComponent } from './handlers/settings';
import { handleAdminCommand } from './handlers/admin';
import { linkButton, row } from './discord';

async function route(i: Interaction, env: Env, ctx: ExecutionContext): Promise<Response> {
  switch (i.type) {
    case InteractionType.PING:
      return json({ type: ResponseType.PONG });

    case InteractionType.APPLICATION_COMMAND:
      switch (i.data?.name) {
        case 'tod':
        case 'truth':
        case 'dare':
        case 'nhie':
        case 'wyr':
          return handlePlayCommand(i, env, ctx, i.data.name);
        case 'submit':
          return handleSubmitCommand(i);
        case 'settings':
          return handleSettingsCommand(i, env);
        case 'hs-admin':
          return handleAdminCommand(i, env);
        case 'hotseat':
          return reply({
            embeds: [helpEmbed()],
            components: env.SUPPORT_INVITE_URL ? [row(linkButton(env.SUPPORT_INVITE_URL, 'Support server'))] : [],
            flags: 64,
          });
      }
      break;

    case InteractionType.MESSAGE_COMPONENT: {
      const parts = String(i.data?.custom_id ?? '').split(':');
      switch (parts[0]) {
        case 'next':
          return handleNextButton(i, env, ctx, parts);
        case 'vote':
          return handleVoteButton(i, env, parts);
        case 'report':
          return handleReportButton(parts);
        case 'review':
          return handleReviewButton(i, env, parts);
        case 'repact':
          return handleReportAction(i, env, parts);
        case 'cfg':
          return handleSettingsComponent(i, env, parts);
      }
      break;
    }

    case InteractionType.MODAL_SUBMIT: {
      const parts = String(i.data?.custom_id ?? '').split(':');
      switch (parts[0]) {
        case 'submit':
          return handleSubmitModal(i, env, ctx, parts);
        case 'revedit':
          return handleReviewEditModal(i, env, parts);
        case 'reportmodal':
          return handleReportModal(i, env, ctx, parts);
      }
      break;
    }
  }
  return ephemeral('🤔 I don\'t know that one (yet).');
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'GET') return new Response('🔥 The Hot Seat is running.');
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const { valid, body } = await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY);
    if (!valid) return new Response('Bad request signature', { status: 401 });

    const interaction = JSON.parse(body) as Interaction;
    try {
      return await route(interaction, env, ctx);
    } catch (err) {
      console.error('Interaction failed', interaction.type, interaction.data?.name ?? interaction.data?.custom_id, err);
      return ephemeral('😬 Something went wrong on our end. Please try again in a moment.');
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(pruneVotes(getSql(env)));
  },
};
