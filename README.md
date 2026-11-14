# 🔥 The Hot Seat

Truth or Dare, Never Have I Ever, and Would You Rather for any Discord server.
One shared deck in Neon Postgres, community submissions with an approval queue, per-server 18+ controls.

**Stack:** TypeScript · Cloudflare Workers (free) · Neon Postgres (free) · Discord HTTP interactions (no always-on process, your PC can be off).

---

## What it does

| Players | Server admins | You + your team (support server) |
|---|---|---|
| `/tod` `/truth` `/dare` `/nhie` `/wyr` with optional `category` + `rating` | `/settings view` | Approve / Edit & approve / Reject buttons on every submission |
| Buttons on each card keep the game rolling (Truth · Dare · 🎲 Random · Next) | `/settings adult enabled:` on/off | 🚩 report queue with Remove / Dismiss |
| NHIE + WYR cards have live vote buttons | `/settings adult-channels` → channel dropdown (pick 1–25) | `/hs-admin trust` / `untrust` / `trusted` |
| `/submit` → pop-up form | `/settings adult enabled: mode:` → default to **Mixed** or **18+ only** in 18+ channels |
| | `/settings admin-role` → let a role manage settings | `/hs-admin stats` / `show` / `remove` / `restore` |
| 🚩 Report on any card | | CSV bulk import for seeding |

**Built-in behavior**
- **No repeats:** each server cycles through the whole deck before anything repeats.
- **18+ rules:** shows only if (1) the server turned it on, (2) the channel is marked **Age-Restricted** in Discord **or the whole server is set to Age-Restricted** (Server Settings → Safety Setup), and (3) if the admin picked channels, it's one of them. Rule 2 is a Discord policy requirement for apps. In fully Age-Restricted servers, where the per-channel toggle doesn't exist, every channel qualifies automatically. The bot reads that server setting and re-checks it every 6 hours (instantly on any `/settings` command).
- **Default rating:** clean everywhere 18+ isn't allowed. In 18+ channels, the server's chosen mode (Mixed or 18+ only). Players can always pick `rating:` themselves. Card buttons follow the server's *current* settings unless the player picked a rating.
- **Can't-check warning:** if the bot can't read a server's Age-Restricted setting (bot user not in the server), `/settings` says so and explains the fix instead of silently serving clean only.
- **Trusted submitters skip review.** You (owner) are always trusted. Everyone else goes to the queue.
- **Auto-hide:** 3 reports from different people pulls a prompt until a reviewer decides. Dismiss puts it back.
- **Duplicates blocked** (case-insensitive). Spam cap: 25 pending submissions per user.
- "Never have I ever…" / "Would you rather…" lead-ins are stripped automatically, so submitters can type them or not.

---

## One-time setup (about 30–45 minutes)

### 1. Install tools
- **Node.js 20+**: https://nodejs.org (LTS installer)
- In this folder, open a terminal and run:
  ```
  npm install
  ```

### 2. Create the Discord app
1. Go to https://discord.com/developers/applications → **New Application** → name it **The Hot Seat**.
2. **General Information:** copy the **Application ID** and **Public Key**.
3. **Bot:** click **Reset Token** → copy the token (you only see it once). Leave all Privileged Gateway Intents **off**; we don't need them.
4. **Installation:**
   - Installation Contexts: check **Guild Install** only.
   - Install Link: **Discord Provided Link**.
   - Guild Install scopes: `applications.commands` and `bot`.
   - Bot permissions: **Send Messages**, **Embed Links**, **View Channels**.
   - Copy the install link. You'll use it for your support server now and share it publicly later.

### 3. Create the database (Neon)
1. https://neon.tech → sign up → **New Project** (pick the US region closest to you).
2. Open **SQL Editor**, paste all of `db/schema.sql`, and click **Run**.
3. Click **Connect** → copy the connection string (`postgresql://…`).

### 4. Set up the support server
1. Create the server (e.g. "The Hot Seat HQ").
2. Create two **private** channels: `#submission-review` and `#reports`.
3. Create a role for helpers, e.g. **Reviewer**. Give it access to both channels.
4. Invite the bot using the install link from step 2. Make sure the bot can see and post in both channels.
5. Turn on **Developer Mode** (User Settings → Advanced). Then right-click to **Copy ID** for: the server, both channels, the Reviewer role, and yourself.

### 5. Fill in your settings
Copy `.dev.vars.example` to `.dev.vars` and fill in every value. `.dev.vars` is git-ignored, so it never gets committed.

### 6. Deploy to Cloudflare (free)
```
npx wrangler login
npx wrangler deploy
```
Copy the URL it prints, e.g. `https://hot-seat-bot.<you>.workers.dev`.

Then give the live worker its settings. Run each line and paste the matching value from `.dev.vars` when prompted:
```
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put DATABASE_URL
npx wrangler secret put SUPPORT_GUILD_ID
npx wrangler secret put REVIEW_CHANNEL_ID
npx wrangler secret put REPORT_CHANNEL_ID
npx wrangler secret put REVIEWER_ROLE_ID
npx wrangler secret put OWNER_IDS
npx wrangler secret put SUPPORT_INVITE_URL
```

### 7. Connect Discord to the worker
Developer Portal → **General Information** → **Interactions Endpoint URL** → paste the workers.dev URL → **Save Changes**.
Discord sends a test ping. If it saves, the signature check works.

### 8. Register the slash commands
```
npm run register
```
`/hs-admin` shows up in your support server right away. Global commands can take a few minutes to appear.

### 9. Test it
In your support server: `/hotseat`, `/submit game:Truth`, `/truth`, `/hs-admin stats`.

---

## Seeding the deck (approval queue "off")

You're auto-trusted as owner. For each friend helping out:
```
/hs-admin trust user:@friend
```
Their `/submit`s go straight into the deck. When seeding is done, run `/hs-admin untrust user:@friend` to send their submissions back through review (or leave trusted helpers on).

**Bulk option:** fill a CSV in the `seed/prompts.example.csv` format (works great as a shared Google Sheet → File → Download → CSV), then run:
```
npm run import -- seed/my-prompts.csv
```
Duplicates are skipped and bad rows are listed with line numbers.

---

## Day-to-day

| Task | Command |
|---|---|
| See live logs/errors | `npm run logs` |
| Ship a code change | `npx wrangler deploy` |
| Changed `src/commands.ts` or categories | `npm run register` |
| Type-check | `npm run typecheck` |

**Changing categories:** edit `CATEGORIES` in `src/constants.ts` (max 25), then deploy + register. Don't rename a `value` once prompts use it.

---

## Free-tier notes
- **Cloudflare Workers free plan:** 100,000 requests per day. Each slash command or button click is one request. Upgrading later is a plan change, not a rewrite.
- **Neon free plan:** the database sleeps when idle, so the first command after a quiet spell can take about a second. Discord allows 3 seconds, so you're fine. Check Neon's pricing page for current storage and compute limits.
- A daily cron (built in) deletes vote records older than 14 days to keep the database small.

## Premium-ready
`src/premium.ts` is the single switchboard:
- **Discord App Subscriptions** (Developer Portal → Monetization): Discord attaches the server's entitlement to every interaction, so `getTier()` already returns `premium` for subscribers.
- **Donations (Ko-fi/Patreon):** set `tier = 'premium'` (and optionally `premium_until`) on that server's row in `guild_settings`.
- To paywall a feature, flip its flag under `FEATURES.free`.

Ideas for premium later: server-only custom prompt packs, turn-based lobbies, more categories, scheduled "Question of the Day."

## Project map
```
src/index.ts            request entry, signature check, routing, daily cron
src/commands.ts         slash command definitions
src/constants.ts        game names, colors, categories, limits
src/db.ts               all SQL
src/render.ts           cards + buttons
src/premium.ts          tiers & feature flags
src/handlers/play.ts    games, no-repeat draw, 18+ gate, votes
src/handlers/submit.ts  /submit + modal
src/handlers/review.ts  approval queue (approve / edit / reject)
src/handlers/report.ts  reports, auto-hide
src/handlers/settings.ts per-server settings + channel picker
src/handlers/admin.ts   /hs-admin (support server only)
scripts/register.ts     registers commands
scripts/import.ts       CSV bulk import
db/schema.sql           database tables
```
