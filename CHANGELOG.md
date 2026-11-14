# Changelog

## [0.1.2] — 2026-11-14
### Added
- feat: `/settings adult` takes `mode:` — **Mixed (clean + 18+)** or **18+ only** — as the default in 18+ channels. Omitting `mode` keeps the current one. Players can still choose `rating:` explicitly.
- feat: `/settings view` shows the default mode and a "Can't check" state for the Age-Restricted Server lookup.
### Fixed
- fix: When the bot can't read the server's Age-Restricted setting (bot user not in the server), `/settings` and 18+ requests now say so and how to fix it, instead of silently falling back to clean only. Failed lookups are cached so they don't repeat on every card.
- fix: Next/Truth/Dare/Random buttons now re-apply the server's current settings on each click (rating `auto`) unless the player picked a rating.
- fix: Empty-deck messages explain when the other rating has cards (e.g., "No clean Truth cards yet. There are 18+ ones, but…").
### Database
- `guild_settings.adult_default` (`'mix'` | `'adult'`, default `'mix'`). Re-run `db/schema.sql` or the v0.1.2 ALTER.

## [0.1.1] — 2026-11-13
### Fixed
- fix: 18+ prompts now work in servers set to Age-Restricted server-wide (no per-channel toggle exists there). The bot reads the server's `nsfw_level` from Discord, caches it for 6 hours, and refreshes it on `/settings` commands.
### Changed
- `/settings view` shows whether the server is Age-Restricted; messages and channel-picker warnings account for it.
- Threads in an Age-Restricted server can show 18+ (checked against the parent channel's list).
- db: `guild_settings.guild_nsfw_level`, `guild_nsfw_checked_at` (schema.sql re-run adds them).

## [0.1.0] — 2026-11-13
### Added
- feat: Serverless Discord bot on Cloudflare Workers with Ed25519 request verification
- feat: Games — `/tod`, `/truth`, `/dare`, `/nhie`, `/wyr` with category + rating filters and next-card buttons
- feat: Live vote buttons on NHIE and WYR cards
- feat: Per-server no-repeat memory (deck reshuffles when exhausted)
- feat: `/submit` with modal form, duplicate blocking, 25-pending cap per user
- feat: Approval queue in support server (Approve / Edit & approve / Reject)
- feat: Trusted submitters bypass review; owners always trusted
- feat: 🚩 reports with auto-hide at 3 reports, Remove / Dismiss actions
- feat: `/settings` — 18+ toggle, 18+ channel picker (dropdown, up to 25), optional admin role
- feat: 18+ only in Discord Age-Restricted channels (Discord policy)
- feat: `/hs-admin` — trust, untrust, trusted, stats, show, remove, restore
- feat: Opt-in submitter credit on cards
- feat: Premium tier scaffolding (Discord entitlements + manual tier)
- feat: CSV bulk import + command registration scripts
- feat: Daily cron prunes votes older than 14 days
