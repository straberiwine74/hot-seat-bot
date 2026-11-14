// /hs-admin — owner/reviewer tools, registered only in the support server.
import type { Env } from '../env';
import { ownerIds } from '../env';
import { COLOR_INFO, GAMES, SEARCH_PAGE_SIZE, normalizeForSearch, type GameType } from '../constants';
import {
  getSql, getPrompt, getStats, listTrusted, transitionPrompt, trustUser, untrustUser, searchPrompts, type SearchStatus,
} from '../db';
import { displayName, ephemeral, getOptions, getUser, type Interaction } from '../discord';
import { promptBody, promptOneLiner } from '../render';
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
    case 'search': {
      const terms = String(o.terms ?? '')
        .split('|')
        .map((t) => normalizeForSearch(t.replace(/\s+/g, ' ').trim()))
        .filter((t) => t.length >= 2)
        .slice(0, 10);
      if (!terms.length) return ephemeral('Give me at least one word or phrase (2+ letters). Separate alternatives with `|`.');
      const status = (o.status ?? 'approved') as SearchStatus;
      const page = Math.max(1, Number(o.page ?? 1));
      const { rows, total } = await searchPrompts(sql, terms, (o.game as GameType) ?? null, status, SEARCH_PAGE_SIZE, (page - 1) * SEARCH_PAGE_SIZE);
      const pages = Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE));
      const filters = [o.game ? GAMES[o.game as GameType].label : null, status === 'all' ? 'any status' : status].filter(Boolean).join(' · ');
      const header = `Searched for: ${terms.map((t) => `\`${t}\``).join(' or ')} · ${filters}`;
      if (!total) return ephemeral(`${header}\n\nNo matches. 🎉`);
      if (!rows.length) return ephemeral(`${header}\n\nPage ${page} is past the end — there ${pages === 1 ? 'is 1 page' : `are ${pages} pages`}.`);
      const start = (page - 1) * SEARCH_PAGE_SIZE + 1;
      let desc = '';
      for (const r of rows) {
        const line = promptOneLiner(r, 140) + (status === 'all' && r.status !== 'approved' ? ` · *${r.status}*` : '') + '\n';
        if (desc.length + line.length > 3900) break;
        desc += line;
      }
      return ephemeral(header, {
        embeds: [{
          title: `🔎 ${total} match${total === 1 ? '' : 'es'}`,
          color: COLOR_INFO,
          description: desc,
          footer: { text: `Showing ${start}–${start + rows.length - 1} of ${total} · page ${page}/${pages}${page < pages ? ' · add page:' + (page + 1) + ' for more' : ''}` },
        }],
      });
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
