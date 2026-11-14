export interface Env {
  DISCORD_APPLICATION_ID: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_TOKEN: string;
  DATABASE_URL: string;
  SUPPORT_GUILD_ID: string;
  REVIEW_CHANNEL_ID: string;
  REPORT_CHANNEL_ID: string;
  REVIEWER_ROLE_ID?: string;
  OWNER_IDS: string;
  SUPPORT_INVITE_URL?: string;
}

export function ownerIds(env: Env): string[] {
  return (env.OWNER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
