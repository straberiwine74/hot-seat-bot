-- The Hot Seat — database schema (PostgreSQL / Neon)
-- Run once in the Neon SQL Editor. Safe to re-run (IF NOT EXISTS everywhere).

-- ─────────────────────────────────────────────────────────────
-- Prompts: the shared deck every server draws from
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prompts (
  id                 SERIAL PRIMARY KEY,
  type               TEXT NOT NULL CHECK (type IN ('truth', 'dare', 'nhie', 'wyr')),
  text               TEXT NOT NULL,              -- WYR: option A
  option_b           TEXT,                       -- WYR: option B (NULL for other games)
  is_adult           BOOLEAN NOT NULL DEFAULT FALSE,
  category           TEXT NOT NULL DEFAULT 'general',
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'rejected', 'removed')),
  submitted_by       TEXT,                       -- Discord user ID ('import' for bulk loads)
  submitted_by_name  TEXT,
  show_credit        BOOLEAN NOT NULL DEFAULT FALSE,
  source_guild_id    TEXT,
  review_message_id  TEXT,
  reviewed_by        TEXT,
  reviewed_at        TIMESTAMPTZ,
  times_played       INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wyr_needs_option_b CHECK (type <> 'wyr' OR option_b IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS prompts_pick_idx ON prompts (type, status, is_adult, category);
CREATE INDEX IF NOT EXISTS prompts_submitter_idx ON prompts (submitted_by, status);
-- Blocks exact duplicates (case-insensitive) among live prompts
CREATE UNIQUE INDEX IF NOT EXISTS prompts_no_dupes
  ON prompts (type, LOWER(text), LOWER(COALESCE(option_b, '')))
  WHERE status IN ('pending', 'approved');

-- ─────────────────────────────────────────────────────────────
-- Per-server settings (one row per server that has used the bot)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id           TEXT PRIMARY KEY,
  adult_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  adult_channel_ids  TEXT[] NOT NULL DEFAULT '{}',  -- empty = any age-restricted channel
  adult_default      TEXT NOT NULL DEFAULT 'mix' CHECK (adult_default IN ('mix', 'adult')),
  admin_role_id      TEXT,
  guild_nsfw_level   SMALLINT,                      -- Discord server-wide setting; 3 = Age-Restricted, -1 = couldn't check
  guild_nsfw_checked_at TIMESTAMPTZ,
  tier               TEXT NOT NULL DEFAULT 'free',  -- 'free' | 'premium' (future paywall)
  premium_until      TIMESTAMPTZ,
  last_active_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Upgrades for databases created before v0.1.1
ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS guild_nsfw_level SMALLINT;
ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS guild_nsfw_checked_at TIMESTAMPTZ;
-- v0.1.2
ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS adult_default TEXT NOT NULL DEFAULT 'mix'
  CHECK (adult_default IN ('mix', 'adult'));

-- ─────────────────────────────────────────────────────────────
-- No-repeat memory: which prompts each server has already seen
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guild_seen (
  guild_id   TEXT NOT NULL,
  prompt_id  INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guild_id, prompt_id)
);

-- ─────────────────────────────────────────────────────────────
-- Trusted submitters: their submissions skip the approval queue
-- (bot owners from OWNER_IDS are always trusted)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trusted_users (
  user_id    TEXT PRIMARY KEY,
  user_name  TEXT,
  added_by   TEXT,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- Player reports on prompts
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
  id           SERIAL PRIMARY KEY,
  prompt_id    INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  guild_id     TEXT,
  reporter_id  TEXT NOT NULL,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  resolved_by  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (prompt_id, reporter_id)
);

-- ─────────────────────────────────────────────────────────────
-- Votes on NHIE / WYR cards (pruned daily after 14 days)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS votes (
  message_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  choice      SMALLINT NOT NULL CHECK (choice IN (0, 1)),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS votes_created_idx ON votes (created_at);

-- ─────────────────────────────────────────────────────────────
-- Search + duplicate detection (v0.1.3)
-- hs_norm: lowercase + strip common accents, so "Ménage" matches "menage".
-- Keep the two character lists in sync with NORM_FROM / NORM_TO in src/constants.ts.
-- ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION hs_norm(t TEXT) RETURNS TEXT
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT translate(lower(t), 'àáâãäåāèéêëēìíîïòóôõöøùúûüýÿçñ', 'aaaaaaaeeeeeiiiioooooouuuuyycn') $$;

CREATE INDEX IF NOT EXISTS prompts_search_trgm
  ON prompts USING gin (hs_norm(text || ' ' || COALESCE(option_b, '')) gin_trgm_ops);
