// Minimal Discord API types + helpers (keeps the worker dependency-free).
import type { Env } from './env';

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
} as const;

export const ResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE: 4,
  DEFERRED_CHANNEL_MESSAGE: 5,
  DEFERRED_UPDATE: 6,
  UPDATE_MESSAGE: 7,
  MODAL: 9,
} as const;

export const ComponentType = {
  ACTION_ROW: 1,
  BUTTON: 2,
  STRING_SELECT: 3,
  TEXT_INPUT: 4,
  CHANNEL_SELECT: 8,
} as const;

export const ButtonStyle = { PRIMARY: 1, SECONDARY: 2, SUCCESS: 3, DANGER: 4, LINK: 5 } as const;
export const TextInputStyle = { SHORT: 1, PARAGRAPH: 2 } as const;

export const OptionType = {
  SUB_COMMAND: 1,
  SUB_COMMAND_GROUP: 2,
  STRING: 3,
  INTEGER: 4,
  BOOLEAN: 5,
  USER: 6,
  CHANNEL: 7,
  ROLE: 8,
} as const;

export const Permission = {
  ADMINISTRATOR: 1n << 3n,
  MANAGE_GUILD: 1n << 5n,
} as const;

export const EPHEMERAL = 1 << 6;

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
}

export interface Interaction {
  id: string;
  application_id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  channel?: { id: string; type: number; nsfw?: boolean; parent_id?: string | null };
  member?: { user: DiscordUser; roles: string[]; permissions: string };
  user?: DiscordUser;
  data?: any;
  message?: any;
  entitlements?: Array<{ id: string; sku_id: string; guild_id?: string; ends_at?: string | null }>;
}

// ── Responses ────────────────────────────────────────────────
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const NO_PINGS = { parse: [] as string[] };

export function reply(data: Record<string, unknown>): Response {
  return json({ type: ResponseType.CHANNEL_MESSAGE, data: { allowed_mentions: NO_PINGS, ...data } });
}

export function ephemeral(content: string, extra: Record<string, unknown> = {}): Response {
  return json({
    type: ResponseType.CHANNEL_MESSAGE,
    data: { content, flags: EPHEMERAL, allowed_mentions: NO_PINGS, ...extra },
  });
}

export function updateMessage(data: Record<string, unknown>): Response {
  return json({ type: ResponseType.UPDATE_MESSAGE, data: { allowed_mentions: NO_PINGS, ...data } });
}

export function modal(data: Record<string, unknown>): Response {
  return json({ type: ResponseType.MODAL, data });
}

// ── Interaction helpers ──────────────────────────────────────
export function getUser(i: Interaction): DiscordUser {
  return (i.member?.user ?? i.user)!;
}

export function displayName(u: DiscordUser): string {
  return u.global_name || u.username;
}

/** Flattens slash-command options; a subcommand's name is returned as `_sub`. */
export function getOptions(data: any): Record<string, any> {
  const out: Record<string, any> = {};
  let opts: any[] = data?.options ?? [];
  if (opts[0] && (opts[0].type === OptionType.SUB_COMMAND || opts[0].type === OptionType.SUB_COMMAND_GROUP)) {
    out._sub = opts[0].name;
    opts = opts[0].options ?? [];
  }
  for (const o of opts) out[o.name] = o.value;
  return out;
}

/** Reads text-input values from a modal submit (supports classic rows and newer Label wrappers). */
export function getModalValues(data: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of data?.components ?? []) {
    const comps = row.component ? [row.component] : row.components ?? [];
    for (const c of comps) if (c?.custom_id) out[c.custom_id] = (c.value ?? '').toString();
  }
  return out;
}

export function hasPermission(i: Interaction, perm: bigint): boolean {
  if (!i.member?.permissions) return false;
  const p = BigInt(i.member.permissions);
  return (p & Permission.ADMINISTRATOR) === Permission.ADMINISTRATOR || (p & perm) === perm;
}

// ── REST (bot token) ─────────────────────────────────────────
export async function discordApi<T = any>(env: Env, path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: {
      Authorization: `Bot ${env.DISCORD_TOKEN}`,
      'content-type': 'application/json',
      'user-agent': 'DiscordBot (https://github.com, 0.1.0) TheHotSeat',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Discord API ${method} ${path} -> ${res.status}: ${await res.text()}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

// ── Component builders ───────────────────────────────────────
export function row(...components: unknown[]) {
  return { type: ComponentType.ACTION_ROW, components };
}

export function button(custom_id: string, label: string, style: number = ButtonStyle.SECONDARY, emoji?: string) {
  return { type: ComponentType.BUTTON, custom_id, label, style, ...(emoji ? { emoji: { name: emoji } } : {}) };
}

export function linkButton(url: string, label: string) {
  return { type: ComponentType.BUTTON, url, label, style: ButtonStyle.LINK };
}

export function textInput(
  custom_id: string,
  label: string,
  opts: { style?: number; required?: boolean; max?: number; min?: number; value?: string; placeholder?: string } = {},
) {
  return row({
    type: ComponentType.TEXT_INPUT,
    custom_id,
    label,
    style: opts.style ?? TextInputStyle.SHORT,
    required: opts.required ?? true,
    ...(opts.max ? { max_length: opts.max } : {}),
    ...(opts.min ? { min_length: opts.min } : {}),
    ...(opts.value ? { value: opts.value } : {}),
    ...(opts.placeholder ? { placeholder: opts.placeholder } : {}),
  });
}
