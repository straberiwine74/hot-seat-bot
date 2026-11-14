// Registers slash commands with Discord. Run: npm run register
// Global commands can take a few minutes to show up everywhere; support-server commands are instant.
import { GLOBAL_COMMANDS, SUPPORT_GUILD_COMMANDS } from '../src/commands';

const { DISCORD_APPLICATION_ID: appId, DISCORD_TOKEN: token, SUPPORT_GUILD_ID: supportGuild } = process.env;
if (!appId || !token) {
  console.error('Missing DISCORD_APPLICATION_ID or DISCORD_TOKEN in .dev.vars');
  process.exit(1);
}

async function put(path: string, body: unknown) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bot ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as Array<{ name: string }>;
}

const global = await put(`/applications/${appId}/commands`, GLOBAL_COMMANDS);
console.log(`✅ Registered ${global.length} global commands: ${global.map((c) => '/' + c.name).join(' ')}`);

if (supportGuild) {
  const guild = await put(`/applications/${appId}/guilds/${supportGuild}/commands`, SUPPORT_GUILD_COMMANDS);
  console.log(`✅ Registered ${guild.length} support-server commands: ${guild.map((c) => '/' + c.name).join(' ')}`);
} else {
  console.log('ℹ️  SUPPORT_GUILD_ID not set — skipped /hs-admin.');
}
