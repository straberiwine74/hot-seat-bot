// /hs-admin — owner/reviewer tools, registered only in the support server.
import type { Env } from '../env';
import { ownerIds } from '../env';
import { COLOR_INFO, GAMES, type GameType } from '../constants';
import { getSql, getPrompt, getStats, listTrusted, transitionPrompt, trustUser, untrustUser } from '../db';
import { displayName, ephemeral, getOptions, getUser, type Interaction } from '../discord';
import { promptBody } from '../render';
import { isReviewer } from './review';

export async function handleAdminCommand(i: Interaction, env: Env) {
  if (!isReviewer(i, env)) return ephemeral('🔒 Hot Seat team only.');
  const sql = getSql(env);
  const me = getUser(i);
  const isOwner = ownerIds(env).includes(me.id);
  const o = getOptions(i.data);

  switch (o._sub) {
    case 'trust': {
      if (!isOwner) return ephemeral('🔒 Only bot owners can manage trusted submitters.');
      const u = i.data?.resolved?.users?.[o.user];
      await trustUser(sql, o.user, u ? displayName(u) : o.user, me.id);
      return ephemeral(`✅ <@${o.user}> is now trusted — their submissions skip the approval queue.`);
    }
    case 'untrust': {
      if (!isOwner) return ephemeral('🔒 Only bot owners can manage trusted submitters.');
      const removed = await untrustUser(sql, o.user);
      return ephemeral(removed ? `✅ <@${o.user}>'s submissions will go through review again.` : `<@${o.user}> wasn't on the trusted list.`);
    }
    case 'trusted': {
      const list = await listTrusted(sql);
      const owners = ownerIds(env).map((id) => `<@${id}> (owner)`);
      const lines = [...owners, ...list.map((t) => `<@${t.user_id}> (${t.user_name ?? 'unknown'})`)];
      return ephemeral(`**Trusted submitters (auto-approved):**\n${lines.join('\n') || 'None yet.'}`);
    }
    case 'stats': {
      const s = await getStats(sql);
      const rows = (['truth', 'dare', 'nhie', 'wyr'] as GameType[]).map((t) => {
        const r = s.byType.find((x) => x.type === t) ?? { clean: 0, adult: 0, pending: 0 };
        return `${GAMES[t].emoji} **${GAMES[t].label}** — ${r.clean} clean · ${r.adult} 18+ · ${r.pending} pending`;
      });
      return ephemeral('', {
        embeds: [{
          title: '📊 The Hot Seat — stats',
          color: COLOR_INFO,
          description: rows.join('\n'),
          fields: [
            { name: 'Servers', value: String(s.guilds), inline: true },
            { name: 'Active (7d)', value: String(s.active_guilds), inline: true },
            { name: 'Cards played', value: String(s.plays), inline: true },
            { name: 'Open reports', value: String(s.open_reports), inline: true },
          ],
        }],
      });
    }
    case 'remove':
    case 'restore': {
      const id = Number(o.id);
      const to = o._sub === 'remove' ? 'removed' : 'approved';
      const from = o._sub === 'remove' ? ['approved', 'pending'] : ['removed', 'rejected'];
      const p = await transitionPrompt(sql, id, from, to, me.id);
      if (!p) {
        const cur = await getPrompt(sql, id);
        return ephemeral(cur ? `#${id} is currently **${cur.status}** — no change made.` : `No prompt #${id}.`);
      }
      return ephemeral(`${to === 'removed' ? '🗑️ Removed' : '♻️ Restored'} #${id}:\n${promptBody(p)}`);
    }
    case 'show': {
      const p = await getPrompt(sql, Number(o.id));
      if (!p) return ephemeral(`No prompt #${o.id}.`);
      return ephemeral(`**#${p.id}** · ${GAMES[p.type].label} · ${p.category} · ${p.is_adult ? '18+' : 'clean'} · **${p.status}** · played ${p.times_played}×\n${promptBody(p)}`);
    }
    default:
      return ephemeral('Unknown admin option.');
  }
}
