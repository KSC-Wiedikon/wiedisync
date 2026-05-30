-- Migration 069: Fines service.
--
-- Two collections + helper functions powering coach/TR-issued fines with
-- per-team escalation rules.
--
--   fine_rules  — one row per team×category. tiers jsonb is a small array of
--                 {offense:N,amount:CHF} entries (last entry uses offense_min
--                 for "Nth and beyond"). reset_window controls when the
--                 monthly/seasonal/etc counter resets.
--   fines       — the ledger. amount is snapshotted at issue time so changing
--                 rules later doesn't rewrite history. tier_offense +
--                 reset_window_at_issue are snapshots for the member's
--                 "why this amount?" explainer.
--
-- The late-signin detection itself lives client-side in
-- ParticipationRosterModal — when a leader confirms an RSVP past respond_by
-- the frontend pops IssueFineModal pre-filled. No PG trigger needed: per the
-- locked design, every fine is leader-confirmed (no silent auto-fire).
--
-- Helper functions:
--   kscw_current_season_start()       — mirrors getCurrentSeason() in JS
--                                       (Sep 1 of current or prior year)
--   kscw_fine_window_start(text, ts)  — dispatches the 5 reset_window enums
--   kscw_compute_fine_amount(...)     — the escalation engine. Hook fills
--                                       amount/tier_offense via this if the
--                                       leader leaves amount NULL.
--
-- Permissions live ONLY in setup-permissions.mjs (per CLAUDE.md hard rule).
-- This migration is schema-only + idempotent.

BEGIN;

-- ── fine_rules ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fine_rules (
  id              serial PRIMARY KEY,
  team            integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  category        varchar(32) NOT NULL,
  enabled         boolean NOT NULL DEFAULT true,
  reset_window    varchar(32) NOT NULL DEFAULT 'calendar_month',
  tiers           jsonb NOT NULL DEFAULT '[]'::jsonb,
  currency        varchar(3) NOT NULL DEFAULT 'CHF',
  notes           text,
  date_created    timestamptz NOT NULL DEFAULT now(),
  date_updated    timestamptz NOT NULL DEFAULT now(),
  user_created    uuid,
  user_updated    uuid,
  updated_by      integer REFERENCES members(id) ON DELETE SET NULL,
  CONSTRAINT fine_rules_category_check CHECK (
    category IN ('late_signin','no_show','late_payment','custom')
  ),
  CONSTRAINT fine_rules_reset_window_check CHECK (
    reset_window IN ('calendar_month','rolling_30d','rolling_90d','season','never')
  ),
  CONSTRAINT fine_rules_team_category_unique UNIQUE (team, category)
);

CREATE INDEX IF NOT EXISTS fine_rules_team_idx ON fine_rules (team);

COMMENT ON TABLE fine_rules IS
  'Per-team×category fine config: escalation tiers + reset window. Read by useFineQuote on the frontend and by kscw_compute_fine_amount() in the backend hook. One row per (team,category) — UNIQUE enforced.';
COMMENT ON COLUMN fine_rules.tiers IS
  'jsonb array of escalation tiers. Each entry: {offense:N, amount:X} for an exact match, or {offense_min:N, amount:X} for the last "Nth and beyond" entry. Lookup order in kscw_compute_fine_amount: exact offense match, then highest offense_min ≤ current offense, then last tier as fallback.';
COMMENT ON COLUMN fine_rules.reset_window IS
  'When the offense counter resets. calendar_month=first of current month; rolling_30d/90d=relative; season=Sep 1 of current season (matches getCurrentSeason in dateHelpers.ts); never=lifetime.';

-- ── fines ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fines (
  id                serial PRIMARY KEY,
  member            integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  team              integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  category          varchar(32) NOT NULL,
  amount            numeric(8,2) NOT NULL,
  currency          varchar(3) NOT NULL DEFAULT 'CHF',
  status            varchar(16) NOT NULL DEFAULT 'open',
  -- Optional activity link. activity_date is a snapshot so the fine survives
  -- the activity being deleted.
  activity_type     varchar(16),
  activity_id       integer,
  activity_date     date,
  -- Audit snapshots from the engine at issue time. Explains "why CHF X" to the
  -- member without re-deriving against rules that may have changed since.
  tier_offense      integer,
  reset_window_at_issue varchar(32),
  reason            text,
  issued_by         integer REFERENCES members(id) ON DELETE SET NULL,
  issued_at         timestamptz NOT NULL DEFAULT now(),
  paid_at           timestamptz,
  paid_method       varchar(16),
  paid_to           varchar(16),
  paid_received_by  integer REFERENCES members(id) ON DELETE SET NULL,
  waived_at         timestamptz,
  waived_by         integer REFERENCES members(id) ON DELETE SET NULL,
  waived_reason     text,
  -- Reserved for a future server-issued path (cron, no-show detector). For
  -- now every row is leader-issued, so this stays false.
  auto_issued       boolean NOT NULL DEFAULT false,
  notes             text,
  date_created      timestamptz NOT NULL DEFAULT now(),
  date_updated      timestamptz NOT NULL DEFAULT now(),
  user_created      uuid,
  user_updated      uuid,
  CONSTRAINT fines_category_check CHECK (
    category IN ('late_signin','no_show','late_payment','custom')
  ),
  CONSTRAINT fines_status_check CHECK (
    status IN ('open','paid','waived')
  ),
  CONSTRAINT fines_activity_type_check CHECK (
    activity_type IS NULL OR activity_type IN ('training','game','event')
  ),
  CONSTRAINT fines_paid_method_check CHECK (
    paid_method IS NULL OR paid_method IN ('cash','twint','transfer','other')
  ),
  CONSTRAINT fines_paid_to_check CHECK (
    paid_to IS NULL OR paid_to IN ('team_kasse','club_kasse')
  ),
  CONSTRAINT fines_amount_nonneg CHECK (amount >= 0)
);

-- Engine count (the hot path: "how many prior fines this window?")
CREATE INDEX IF NOT EXISTS fines_engine_count_idx
  ON fines (team, member, category, status, issued_at);
-- Member-view balance ("CHF X open across all teams")
CREATE INDEX IF NOT EXISTS fines_member_status_idx
  ON fines (member, status);
-- Leader-view list (newest first per team)
CREATE INDEX IF NOT EXISTS fines_team_status_issued_idx
  ON fines (team, status, issued_at DESC);

COMMENT ON TABLE fines IS
  'Per-member fine ledger. amount + tier_offense + reset_window_at_issue are snapshotted at issue time and never re-derived. Edits to amount/category/reason are blocked by the kscw-hooks filter — leaders must waive + reissue to change a wrong fine, preserving audit trail.';

-- ── Directus admin metadata ──────────────────────────────────────────
-- Surface both tables in /admin so non-developer admins (Sport Admin /
-- Vorstand) can spot-fix rows without touching SQL.
INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_field, archive_value, unarchive_value, archive_app_filter)
SELECT 'fine_rules', 'rule', '#B45309', NULL, NULL, NULL, NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'fine_rules');

INSERT INTO directus_collections (collection, icon, color, "group", sort, archive_field, archive_value, unarchive_value, archive_app_filter)
SELECT 'fines', 'gavel', '#B45309', NULL, NULL, NULL, NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'fines');

-- fine_rules fields
INSERT INTO directus_fields (collection, field, special, interface, options, display, display_options, readonly, hidden, sort, width, note)
SELECT 'fine_rules', 'team', 'm2o', 'select-dropdown-m2o', NULL, 'related-values', NULL, false, false, 1, 'half', 'Team this rule applies to.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fine_rules' AND field = 'team');

INSERT INTO directus_fields (collection, field, special, interface, options, sort, width, note)
SELECT 'fine_rules', 'category', NULL, 'select-dropdown',
  '{"choices":[{"text":"Late sign-in","value":"late_signin"},{"text":"No-show","value":"no_show"},{"text":"Late payment","value":"late_payment"},{"text":"Custom","value":"custom"}]}'::json,
  2, 'half', 'Which fine category these tiers apply to.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fine_rules' AND field = 'category');

INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'fine_rules', 'enabled', 'cast-boolean', 'boolean', 3, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fine_rules' AND field = 'enabled');

INSERT INTO directus_fields (collection, field, special, interface, options, sort, width, note)
SELECT 'fine_rules', 'reset_window', NULL, 'select-dropdown',
  '{"choices":[{"text":"Calendar month","value":"calendar_month"},{"text":"Rolling 30 days","value":"rolling_30d"},{"text":"Rolling 90 days","value":"rolling_90d"},{"text":"Season (Sep–Aug)","value":"season"},{"text":"Never (lifetime)","value":"never"}]}'::json,
  4, 'half', 'When the offense counter resets for this team×category.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fine_rules' AND field = 'reset_window');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'fine_rules', 'tiers', 'cast-json', 'input-code', 5, 'full',
  'Escalation tiers as JSON. e.g. [{"offense":1,"amount":1.00},{"offense":2,"amount":2.00},{"offense_min":3,"amount":5.00}] — entries match in order, last "offense_min" catches Nth and beyond.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fine_rules' AND field = 'tiers');

INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'fine_rules', 'currency', NULL, 'input', 6, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fine_rules' AND field = 'currency');

INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'fine_rules', 'notes', NULL, 'input-multiline', 7, 'full'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fine_rules' AND field = 'notes');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'fine_rules', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fine_rules' AND field = 'date_created');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'fine_rules', 'date_updated', 'date-updated', 'datetime', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fine_rules' AND field = 'date_updated');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'fine_rules', 'user_created', 'user-created', 'select-dropdown-m2o', true, true, 92
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fine_rules' AND field = 'user_created');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'fine_rules', 'user_updated', 'user-updated', 'select-dropdown-m2o', true, true, 93
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fine_rules' AND field = 'user_updated');

-- fines fields
INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'fines', 'member', 'm2o', 'select-dropdown-m2o', 'related-values', 1, 'half', 'Member being fined.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'member');

INSERT INTO directus_fields (collection, field, special, interface, display, sort, width, note)
SELECT 'fines', 'team', 'm2o', 'select-dropdown-m2o', 'related-values', 2, 'half', 'Team context for the fine (escalation counter scoped per team).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'team');

INSERT INTO directus_fields (collection, field, special, interface, options, sort, width)
SELECT 'fines', 'category', NULL, 'select-dropdown',
  '{"choices":[{"text":"Late sign-in","value":"late_signin"},{"text":"No-show","value":"no_show"},{"text":"Late payment","value":"late_payment"},{"text":"Custom","value":"custom"}]}'::json,
  3, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'category');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'fines', 'amount', NULL, 'input', 4, 'half', 'Snapshotted at issue time. Edits to this field via REST are blocked by kscw-hooks.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'amount');

INSERT INTO directus_fields (collection, field, special, interface, options, sort, width)
SELECT 'fines', 'status', NULL, 'select-dropdown',
  '{"choices":[{"text":"Open","value":"open"},{"text":"Paid","value":"paid"},{"text":"Waived","value":"waived"}]}'::json,
  5, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'status');

INSERT INTO directus_fields (collection, field, special, interface, options, sort, width)
SELECT 'fines', 'activity_type', NULL, 'select-dropdown',
  '{"choices":[{"text":"Training","value":"training"},{"text":"Game","value":"game"},{"text":"Event","value":"event"}]}'::json,
  6, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'activity_type');

INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'fines', 'activity_id', NULL, 'input', 7, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'activity_id');

INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'fines', 'activity_date', NULL, 'datetime', 8, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'activity_date');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'fines', 'tier_offense', NULL, 'input', 9, 'half', 'Snapshot: which Nth offense this was within the window.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'tier_offense');

INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'fines', 'reset_window_at_issue', NULL, 'input', 10, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'reset_window_at_issue');

INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'fines', 'reason', NULL, 'input-multiline', 11, 'full'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'reason');

INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'fines', 'issued_by', 'm2o', 'select-dropdown-m2o', 12, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'issued_by');

INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'fines', 'issued_at', NULL, 'datetime', 13, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'issued_at');

INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'fines', 'paid_at', NULL, 'datetime', 14, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'paid_at');

INSERT INTO directus_fields (collection, field, special, interface, options, sort, width)
SELECT 'fines', 'paid_method', NULL, 'select-dropdown',
  '{"choices":[{"text":"Cash","value":"cash"},{"text":"TWINT","value":"twint"},{"text":"Bank transfer","value":"transfer"},{"text":"Other","value":"other"}]}'::json,
  15, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'paid_method');

INSERT INTO directus_fields (collection, field, special, interface, options, sort, width)
SELECT 'fines', 'paid_to', NULL, 'select-dropdown',
  '{"choices":[{"text":"Team kasse","value":"team_kasse"},{"text":"Club kasse","value":"club_kasse"}]}'::json,
  16, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'paid_to');

INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'fines', 'paid_received_by', 'm2o', 'select-dropdown-m2o', 17, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'paid_received_by');

INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'fines', 'waived_at', NULL, 'datetime', 18, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'waived_at');

INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'fines', 'waived_by', 'm2o', 'select-dropdown-m2o', 19, 'half'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'waived_by');

INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'fines', 'waived_reason', NULL, 'input-multiline', 20, 'full'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'waived_reason');

INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'fines', 'auto_issued', 'cast-boolean', 'boolean', 21, 'half', 'Reserved for a future server-issued path (cron, no-show detector). Currently always false.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'auto_issued');

INSERT INTO directus_fields (collection, field, special, interface, sort, width)
SELECT 'fines', 'notes', NULL, 'input-multiline', 22, 'full'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'notes');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'fines', 'date_created', 'date-created', 'datetime', true, true, 90
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'date_created');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'fines', 'date_updated', 'date-updated', 'datetime', true, true, 91
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'date_updated');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'fines', 'user_created', 'user-created', 'select-dropdown-m2o', true, true, 92
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'user_created');

INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort)
SELECT 'fines', 'user_updated', 'user-updated', 'select-dropdown-m2o', true, true, 93
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fines' AND field = 'user_updated');

-- ── Directus relations metadata ──────────────────────────────────────
-- Tells Directus which integer columns are M2O FKs so /items/fines etc. can
-- expand them with `fields[]=member.first_name` queries.
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'fines', 'member', 'members', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'fines' AND many_field = 'member');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'fines', 'team', 'teams', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'fines' AND many_field = 'team');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'fines', 'issued_by', 'members', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'fines' AND many_field = 'issued_by');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'fines', 'waived_by', 'members', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'fines' AND many_field = 'waived_by');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'fines', 'paid_received_by', 'members', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'fines' AND many_field = 'paid_received_by');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'fine_rules', 'team', 'teams', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'fine_rules' AND many_field = 'team');

INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
SELECT 'fine_rules', 'updated_by', 'members', NULL, NULL, NULL, NULL, NULL, 'nullify'
WHERE NOT EXISTS (SELECT 1 FROM directus_relations WHERE many_collection = 'fine_rules' AND many_field = 'updated_by');

-- ── Helper functions ─────────────────────────────────────────────────

-- kscw_current_season_start()
-- Returns Sep 1 of the current season. Mirrors src/utils/dateHelpers.ts
-- getCurrentSeason(): if today's month is Sep+ (month index ≥ 8), the season
-- started this Sep; otherwise (Jan–Aug), last Sep. Used by season-reset
-- fine counters so the SQL stays aligned with the JS that builds team/member
-- season strings.
CREATE OR REPLACE FUNCTION kscw_current_season_start()
RETURNS date AS $$
DECLARE
  v_now date := (now() AT TIME ZONE 'Europe/Zurich')::date;
  v_year int := EXTRACT(YEAR FROM v_now)::int;
  v_month int := EXTRACT(MONTH FROM v_now)::int;
BEGIN
  -- JS getMonth() is 0-indexed (Aug=7, Sep=8). PG EXTRACT MONTH is 1-indexed.
  -- JS check: month < 8 (Jan–Aug) → previous Sep.
  -- PG equivalent: month <= 8 (Jan–Aug) → previous Sep. Note Aug is included
  -- in "previous season" both ways: JS month 7 (Aug) < 8 = true; PG month 8
  -- (Aug) <= 8 = true. Sep flips: JS month 8 (Sep) < 8 = false; PG month 9
  -- (Sep) <= 8 = false. Aligned.
  IF v_month <= 8 THEN
    RETURN make_date(v_year - 1, 9, 1);
  ELSE
    RETURN make_date(v_year, 9, 1);
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;
COMMENT ON FUNCTION kscw_current_season_start() IS
  'Sep 1 of the current season (Sep–Aug). Mirrors getCurrentSeason() in src/utils/dateHelpers.ts. STABLE (not IMMUTABLE — depends on now()); do not use in indexes or generated columns.';

-- kscw_fine_window_start(window, ts) — start of the offense counter window
-- for a given reset_window enum, relative to ts. Returns timestamptz so the
-- caller can use `>= window_start` directly against fines.issued_at.
CREATE OR REPLACE FUNCTION kscw_fine_window_start(p_window text, p_ts timestamptz)
RETURNS timestamptz AS $$
BEGIN
  CASE p_window
    WHEN 'calendar_month' THEN
      RETURN date_trunc('month', p_ts AT TIME ZONE 'Europe/Zurich')
             AT TIME ZONE 'Europe/Zurich';
    WHEN 'rolling_30d' THEN
      RETURN p_ts - interval '30 days';
    WHEN 'rolling_90d' THEN
      RETURN p_ts - interval '90 days';
    WHEN 'season' THEN
      RETURN (kscw_current_season_start()::timestamp AT TIME ZONE 'Europe/Zurich');
    WHEN 'never' THEN
      RETURN 'epoch'::timestamptz;
    ELSE
      -- Unknown window — be conservative and count everything.
      RETURN 'epoch'::timestamptz;
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE;
COMMENT ON FUNCTION kscw_fine_window_start(text, timestamptz) IS
  'Start timestamp of the offense-counter window for a fine_rules.reset_window value. calendar_month/season anchor to Europe/Zurich wall-clock (1st of month / Sep 1); rolling windows subtract N days from now.';

-- kscw_compute_fine_amount(member, team, category)
-- Returns the amount + which offense it would be + the window that drove it,
-- given an existing fine_rules row for (team, category). Returns no rows when
-- no enabled rule exists — the caller (hook filter) then either rejects the
-- insert (if amount was NULL) or trusts the leader's override (if non-NULL).
CREATE OR REPLACE FUNCTION kscw_compute_fine_amount(
  p_member integer,
  p_team integer,
  p_category text
)
RETURNS TABLE(
  amount numeric,
  tier_offense integer,
  reset_window_at_issue text
) AS $$
DECLARE
  v_rule          record;
  v_window_start  timestamptz;
  v_prior_count   integer;
  v_offense_no    integer;
  v_tier          jsonb;
  v_amount        numeric;
BEGIN
  -- 1. Load the rule. No enabled rule → no rows returned.
  SELECT * INTO v_rule
  FROM fine_rules
  WHERE team = p_team
    AND category = p_category
    AND enabled = true
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- 2. Window start.
  v_window_start := kscw_fine_window_start(v_rule.reset_window, now());

  -- 3. Count prior non-waived fines in window.
  SELECT COUNT(*)::int INTO v_prior_count
  FROM fines
  WHERE member = p_member
    AND team = p_team
    AND category = p_category
    AND status <> 'waived'
    AND issued_at >= v_window_start;
  v_offense_no := v_prior_count + 1;

  -- 4. Tier lookup.
  --    a. exact match on `offense`
  --    b. fall through to highest `offense_min` ≤ offense_no
  --    c. fall through to last tier (any shape)
  v_amount := NULL;

  -- Exact match
  SELECT t INTO v_tier
  FROM jsonb_array_elements(v_rule.tiers) AS t
  WHERE (t->>'offense')::int = v_offense_no
  LIMIT 1;
  IF v_tier IS NOT NULL THEN
    v_amount := (v_tier->>'amount')::numeric;
  END IF;

  -- Highest offense_min ≤ offense_no
  IF v_amount IS NULL THEN
    SELECT t INTO v_tier
    FROM jsonb_array_elements(v_rule.tiers) AS t
    WHERE (t ? 'offense_min') AND (t->>'offense_min')::int <= v_offense_no
    ORDER BY (t->>'offense_min')::int DESC
    LIMIT 1;
    IF v_tier IS NOT NULL THEN
      v_amount := (v_tier->>'amount')::numeric;
    END IF;
  END IF;

  -- Last tier as fallback (covers misconfigured rules with only exact tiers and
  -- a higher offense than any covered — leader still gets a hint).
  -- WITH ORDINALITY exposes the array index so we can pick the *last* element.
  IF v_amount IS NULL THEN
    SELECT elem INTO v_tier
    FROM jsonb_array_elements(v_rule.tiers) WITH ORDINALITY AS arr(elem, ord)
    ORDER BY arr.ord DESC
    LIMIT 1;
    IF v_tier IS NOT NULL THEN
      v_amount := (v_tier->>'amount')::numeric;
    END IF;
  END IF;

  IF v_amount IS NULL THEN
    -- Rule exists but tiers is empty / malformed. Refuse to guess.
    RETURN;
  END IF;

  amount := v_amount;
  tier_offense := v_offense_no;
  reset_window_at_issue := v_rule.reset_window;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql STABLE;
COMMENT ON FUNCTION kscw_compute_fine_amount(integer, integer, text) IS
  'Escalation engine. Counts prior non-waived fines in the rule''s reset window, then picks the matching tier: exact offense first, then highest offense_min ≤ N, then last tier as fallback. Returns no rows if no enabled rule or empty tiers — caller must handle.';

COMMIT;
