-- Migration 361: fine rules per activity type.
--
-- A team's late-sign-in ladder used to be one ladder: the same tiers and the
-- same reset window whether the member ignored a training or a game. Coaches
-- price those differently — a missed training deadline is a nuisance, a missed
-- game deadline leaves the team short — so a rule may now be scoped to one
-- activity type.
--
--   fine_rules.activity_type  NULL       ⇒ the category's GENERAL rule (as
--                                          before — applies to every activity
--                                          type that has no rule of its own,
--                                          and to fines with no activity).
--                             'training' ⇒ an override for that activity
--                             'game'        type only.
--                             'event'
--
-- Engine (kscw_compute_fine_amount) gets a 4th argument, the activity type of
-- the fine being priced, and picks the most specific ENABLED rule: the
-- override for that type if there is one, else the general rule. A disabled
-- override is no override — it falls back to the general rule, so "Enabled"
-- on an override reads as "this ladder is in force", same as on the general
-- one.
--
-- Counters are per rule, not per category: an override counts only offenses
-- of its own type, and the general rule counts only offenses no override
-- claims. "Offense #1" on the Games ladder therefore means the first late
-- game, whatever the training history — the literal reading of the settings
-- panel, and the only one under which a per-rule reset window makes sense.
--
-- The 3-arg signature is DROPPED and replaced by the 4-arg one with a default
-- (keeping both would make every 3-arg call "function is not unique"); the
-- existing callers keep working unchanged and are updated in the same change
-- to pass the type. `useFines.ts` mirrors the engine and is updated alongside.
--
-- Schema-only + idempotent (per CLAUDE.md hard rule). No permission rows —
-- fine_rules grants are field-wildcard in setup-permissions.mjs.
--
-- ⚠ Registers a directus_fields row — RESTART the container after applying
-- (`npm run deploy:dev` chains it) or the field reads back as an alias.

BEGIN;

-- ── Column + check ────────────────────────────────────────────────────
ALTER TABLE fine_rules ADD COLUMN IF NOT EXISTS activity_type varchar(16);

ALTER TABLE fine_rules DROP CONSTRAINT IF EXISTS fine_rules_activity_type_check;
ALTER TABLE fine_rules ADD CONSTRAINT fine_rules_activity_type_check CHECK (
  activity_type IS NULL OR activity_type IN ('training','game','event')
);

COMMENT ON COLUMN fine_rules.activity_type IS
  'NULL = the category''s general rule (covers every activity type without its own override, and activity-less fines). training/game/event = an override for that type only. The engine prefers an ENABLED override over the general rule; a disabled override falls back to the general one.';

-- ── Uniqueness: one general rule + at most one override per type ─────
-- The old two-column UNIQUE would forbid the overrides outright. NULL is not
-- equal to NULL under a plain unique constraint, so the general rule is keyed
-- on COALESCE(…, '') through a unique index instead.
ALTER TABLE fine_rules DROP CONSTRAINT IF EXISTS fine_rules_team_category_unique;
CREATE UNIQUE INDEX IF NOT EXISTS fine_rules_team_category_type_uidx
  ON fine_rules (team, category, COALESCE(activity_type, ''));

COMMENT ON TABLE fine_rules IS
  'Per-team×category fine config: escalation tiers + reset window. activity_type NULL is the general rule; training/game/event rows are per-type overrides (migration 361). Read by useFineQuote on the frontend and by kscw_compute_fine_amount() in the backend hook. One row per (team, category, activity_type) — unique index enforced.';

-- ── Engine ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS kscw_compute_fine_amount(integer, integer, text);

CREATE OR REPLACE FUNCTION kscw_compute_fine_amount(
  p_member integer,
  p_team integer,
  p_category text,
  p_activity_type text DEFAULT NULL
)
RETURNS TABLE(
  amount numeric,
  tier_offense integer,
  reset_window_at_issue text
)
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_rule          record;
  v_window_start  timestamptz;
  v_prior_count   integer;
  v_offense_no    integer;
  v_tier          jsonb;
  v_amount        numeric;
BEGIN
  -- 1. Load the most specific enabled rule: the override for this activity
  --    type first, the general rule otherwise. No enabled rule → no rows.
  SELECT * INTO v_rule
  FROM fine_rules
  WHERE team = p_team
    AND category = p_category
    AND enabled = true
    AND (activity_type IS NULL OR activity_type = p_activity_type)
  ORDER BY (activity_type IS NOT NULL) DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- 2. Window start.
  v_window_start := kscw_fine_window_start(v_rule.reset_window, now());

  -- 3. Count prior non-waived fines in window — scoped to the rule:
  --    an override counts only its own activity type; the general rule
  --    counts everything no enabled override claims.
  IF v_rule.activity_type IS NOT NULL THEN
    SELECT COUNT(*)::int INTO v_prior_count
    FROM fines
    WHERE member = p_member
      AND team = p_team
      AND category = p_category
      AND status <> 'waived'
      AND issued_at >= v_window_start
      AND activity_type = v_rule.activity_type;
  ELSE
    SELECT COUNT(*)::int INTO v_prior_count
    FROM fines f
    WHERE f.member = p_member
      AND f.team = p_team
      AND f.category = p_category
      AND f.status <> 'waived'
      AND f.issued_at >= v_window_start
      AND (
        f.activity_type IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM fine_rules o
          WHERE o.team = p_team
            AND o.category = p_category
            AND o.enabled = true
            AND o.activity_type = f.activity_type
        )
      );
  END IF;
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
$$;

COMMENT ON FUNCTION kscw_compute_fine_amount(integer, integer, text, text) IS
  'Escalation engine. Picks the enabled fine_rules row for (team, category) — the activity_type override when one exists and is enabled, else the general (NULL) rule — counts the member''s prior non-waived fines in that rule''s window and scope, and returns the tier amount for the next offense. No rows when no enabled rule or no usable tier. Mirrored by computeFineAmount() in src/hooks/useFines.ts.';

-- ── Directus admin metadata ──────────────────────────────────────────
INSERT INTO directus_fields (collection, field, special, interface, options, sort, width, note)
SELECT 'fine_rules', 'activity_type', NULL, 'select-dropdown',
  '{"allowNone":true,"choices":[{"text":"Training","value":"training"},{"text":"Game","value":"game"},{"text":"Event","value":"event"}]}'::json,
  3, 'half', 'Leave empty for the category''s general rule. Set to make this row an override for that activity type only.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'fine_rules' AND field = 'activity_type');

COMMIT;
