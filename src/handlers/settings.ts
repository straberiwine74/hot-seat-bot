// /settings — per-server configuration (Manage Server, or the server's chosen admin role).
import type { Env } from '../env';
import { COLOR_INFO, type AdultDefault } from '../constants';
import { getSql, getGuildSettings, setAdultEnabled, setAdultChannels, setAdminRole, type GuildSettings } from '../db';
import {
  button, row, ButtonStyle, ComponentType, ephemeral, getOptions, hasPermission, Permission,
  updateMessage, type Interaction,
} from '../discord';
import { getTier } from '../premium';
import { adultAllowed, checkAgeRestrictedServer, CANT_CHECK_SERVER, type ServerAgeCheck } from './play';

// Text, voice (has text chat), announcement, stage — the channel types that can be Age-Restricted.
const ADULT_CHANNEL_TYPES = [0, 2, 5, 13];

function canManage(i: Interaction, s: GuildSettings): boolean {
  if (hasPermission(i, Permission.MANAGE_GUILD)) return true;
  return !!s.admin_role_id && (i.member?.roles ?? []).includes(s.admin_role_id);
}

const NO_ACCESS = '🔒 You need **Manage Server** (or this server\'s Hot Seat admin role) to change settings.';

const MODE_LABEL: Record<AdultDefault, string> = { mix: 'Mixed (clean + 18+)', adult: '18+ only' };

function settingsEmbed(s: GuildSettings, i: Interaction, check: ServerAgeCheck) {
  const serverRestricted = check.restricted;
  const channels = s.adult_channel_ids.length
    ? s.adult_channel_ids.map((id) => `<#${id}>`).join(', ')
    : serverRestricted ? 'Any channel' : 'Any Age-Restricted channel';
  return {
    title: '⚙️ The Hot Seat — server settings',
    color: COLOR_INFO,
    fields: [
      { name: '18+ prompts', value: s.adult_enabled ? '✅ On' : '❌ Off', inline: true },
      { name: '18+ allowed here?', value: adultAllowed(s, i, serverRestricted) ? 'Yes' : 'No', inline: true },
      {
        name: 'Age-Restricted Server',
        value: check.failed ? '⚠️ Can\'t check' : serverRestricted ? 'Yes — every channel qualifies' : 'No — per-channel setting applies',
        inline: true,
      },
      { name: 'Default in 18+ channels', value: MODE_LABEL[s.adult_default ?? 'mix'], inline: true },
      { name: 'Plan', value: getTier(s, i) === 'premium' ? '⭐ Premium' : 'Free', inline: true },
      { name: '18+ channels', value: channels },
      { name: 'Bot admin role', value: s.admin_role_id ? `<@&${s.admin_role_id}>` : 'None (Manage Server only)' },
    ],
    footer: {
      text: serverRestricted
        ? 'This whole server is Age-Restricted, so any channel you list (or every channel, if none) can show 18+.'
        : '18+ prompts only show in channels marked Age-Restricted in Discord, even if listed above.',
    },
  };
}

export async function handleSettingsCommand(i: Interaction, env: Env) {
  if (!i.guild_id) return ephemeral('Settings only work inside a server.');
  const sql = getSql(env);
  const s = await getGuildSettings(sql, i.guild_id);
  const o = getOptions(i.data);

  if (o._sub === 'view') {
    const check = await checkAgeRestrictedServer(env, sql, s, true);
    return ephemeral(check.failed ? CANT_CHECK_SERVER : '', { embeds: [settingsEmbed(s, i, check)] });
  }
  if (!canManage(i, s)) return ephemeral(NO_ACCESS);

  switch (o._sub) {
    case 'adult': {
      const enabled = o.enabled === true;
      const mode: AdultDefault | null = o.mode === 'adult' || o.mode === 'mix' ? o.mode : null;
      await setAdultEnabled(sql, i.guild_id, enabled, mode);
      if (!enabled) return ephemeral('✅ 18+ prompts are **off** everywhere on this server.');
      const effectiveMode: AdultDefault = mode ?? s.adult_default ?? 'mix';
      const check = await checkAgeRestrictedServer(env, sql, s, true);
      const where = s.adult_channel_ids.length
        ? 'only in the channels on your list'
        : check.restricted
          ? 'in **any channel** (this server is Age-Restricted)'
          : 'only in channels marked Age-Restricted';
      const modeLine = effectiveMode === 'adult'
        ? 'Games there default to **18+ only** (players can still pick `rating: Clean only` or `Mixed`).'
        : 'Games there default to **Mixed** — clean + 18+. Use `mode: 18+ only` to serve only 18+ by default.';
      return ephemeral(
        `🔥 18+ prompts are **on** — they'll appear ${where}.\n${modeLine}` +
          (s.adult_channel_ids.length ? '' : '\nUse `/settings adult-channels` to limit them to specific channels.') +
          (check.failed && !check.restricted ? `\n\n${CANT_CHECK_SERVER}` : ''),
      );
    }
    case 'adult-channels':
      return ephemeral('Pick the channel(s) where 18+ prompts may appear. Leave empty to allow every eligible channel.', {
        components: [
          row({
            type: ComponentType.CHANNEL_SELECT,
            custom_id: 'cfg:adultch',
            channel_types: ADULT_CHANNEL_TYPES,
            placeholder: 'Choose 18+ channels…',
            min_values: 0,
            max_values: 25,
            default_values: s.adult_channel_ids.map((id) => ({ id, type: 'channel' })),
          }),
          row(button('cfg:adultch-clear', 'Allow every eligible channel', ButtonStyle.SECONDARY)),
        ],
      });
    case 'admin-role': {
      // Only true Manage Server holders can change who else gets admin access.
      if (!hasPermission(i, Permission.MANAGE_GUILD)) return ephemeral('🔒 Only members with **Manage Server** can change the admin role.');
      const roleId: string | null = o.role ?? null;
      await setAdminRole(sql, i.guild_id, roleId);
      return ephemeral(roleId ? `✅ Members with <@&${roleId}> can now manage Hot Seat settings.` : '✅ Admin role cleared — Manage Server only.');
    }
    default:
      return ephemeral('Unknown settings option.');
  }
}

/** Channel select (cfg:adultch) and clear button (cfg:adultch-clear). */
export async function handleSettingsComponent(i: Interaction, env: Env, parts: string[]) {
  if (!i.guild_id) return ephemeral('Settings only work inside a server.');
  const sql = getSql(env);
  const s = await getGuildSettings(sql, i.guild_id);
  if (!canManage(i, s)) return ephemeral(NO_ACCESS);

  const ids: string[] = parts[1] === 'adultch-clear' ? [] : (i.data?.values ?? []);
  await setAdultChannels(sql, i.guild_id, ids);

  const check = await checkAgeRestrictedServer(env, sql, s, true);
  const serverRestricted = check.restricted;
  const resolved = i.data?.resolved?.channels ?? {};
  const notRestricted = serverRestricted ? [] : ids.filter((id) => resolved[id] && resolved[id].nsfw === false);
  let msg = ids.length
    ? `✅ 18+ prompts limited to: ${ids.map((id) => `<#${id}>`).join(', ')}`
    : serverRestricted
      ? '✅ 18+ prompts allowed in any channel (this server is Age-Restricted).'
      : '✅ 18+ prompts allowed in any Age-Restricted channel.';
  if (notRestricted.length) {
    msg += `\n⚠️ ${notRestricted.map((id) => `<#${id}>`).join(', ')} ${notRestricted.length === 1 ? 'is' : 'are'} not marked Age-Restricted, so 18+ won't show there until it is (Edit Channel → Age-Restricted).`;
  }
  if (check.failed && !serverRestricted) msg += `\n${CANT_CHECK_SERVER}`;
  if (!s.adult_enabled) msg += '\nℹ️ 18+ prompts are currently **off** — turn them on with `/settings adult enabled:True`.';
  return updateMessage({ content: msg, components: [] });
}
