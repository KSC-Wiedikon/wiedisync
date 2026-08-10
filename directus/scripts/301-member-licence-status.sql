-- Migration 301: per-member licence status for the current season
--
-- The club already mirrors what the REGISTERS say about a licence
-- (`licence_activated` / `licence_validated` from Swiss Volley's Volleymanager,
-- `licence_category` from VM or Basketplan). What it has never had is the state
-- of the club's own ORDERING WORKFLOW — the weeks between "this person needs a
-- licence" and "the federation confirmed it", which until now lived in a
-- spreadsheet and in the licence officer's head.
--
-- `licence_status` is that workflow, five states, in order:
--
--   none          no licence needed / none held           (manual, the default)
--   to_be_ordered somebody has to order one               (manual)
--   ordered       ordered with the federation             (manual)
--   finalized     paperwork done, awaiting confirmation   (manual)
--   licenced      CONFIRMED by the Swiss Volley / Basketplan sync
--
-- The first four are human judgements; only `licenced` is machine-asserted, and
-- the sweep that asserts it (POST /kscw/admin/licence-status/sync) may only ever
-- move a member UP into it. It never demotes. This is the same set-true-only
-- rule the VM and Basketplan syncs already follow for `scorer_vb` / `referee_vb`
-- and for exactly the same reason: a register that is temporarily unreachable,
-- or that simply holds less than the club does, is absence of evidence — not
-- evidence of absence. A weekly 403 window must not wipe the club's own records.
--
-- ── Why the status is season-stamped ────────────────────────────────────────
-- A licence is issued FOR A SEASON, so "Licenced" without a season attached
-- silently becomes a lie every 1 June. `licence_status_season` carries the
-- season the status describes ("2026/27"), and the sweep resets any row whose
-- stamp has gone stale back to `none` before it re-promotes from the registers.
-- That reset is the ONLY thing that may move a status down.
--
-- One row per member rather than a (member, season) history table: the Data
-- Explorer, the profile card and the /admin/anmeldungen buttons all want a
-- single current value, and the year-by-year trail already exists in the
-- Directus revision log for every items-API write.
--
-- ── The backfill ────────────────────────────────────────────────────────────
-- Deliberately done HERE, in the migration, and therefore SILENTLY: the sweep
-- notifies the member on every change, and seeding a few hundred members'
-- opening value is not a change any of them needs a push about. From the first
-- sweep onwards every transition is real and every notification is warranted.
--
-- Schema-only + idempotent. After applying: `npm run db:setup-perms:dev|prod`
-- — the four columns join the member's own-read list (they read their own
-- status, they never write it).

BEGIN;

-- ── Season label, in SQL ─────────────────────────────────────────────────────
-- The fourth sibling of the season module (src/utils/season.ts,
-- kscw-endpoints/src/season.js, kscw_current_season_start()). Derived FROM
-- kscw_current_season_start() rather than reimplementing the cutover, so the
-- Jun-1 rollover cannot drift here the way it drifted before migration 268.
CREATE OR REPLACE FUNCTION public.kscw_current_season_label()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT EXTRACT(YEAR FROM public.kscw_current_season_start())::int::text
      || '/'
      || lpad(((EXTRACT(YEAR FROM public.kscw_current_season_start())::int + 1) % 100)::text, 2, '0');
$$;

COMMENT ON FUNCTION public.kscw_current_season_label() IS
  'Current season in Wiedisync short form ("2026/27"). Mirrors currentSeasonShort() in src/utils/season.ts and kscw-endpoints/src/season.js; derived from kscw_current_season_start() so the Jun-1 cutover is defined in exactly one place.';

-- ── Columns ──────────────────────────────────────────────────────────────────
ALTER TABLE members ADD COLUMN IF NOT EXISTS licence_status character varying(20) NOT NULL DEFAULT 'none';
ALTER TABLE members ADD COLUMN IF NOT EXISTS licence_status_season character varying(9);
ALTER TABLE members ADD COLUMN IF NOT EXISTS licence_status_updated_at timestamp with time zone;
ALTER TABLE members ADD COLUMN IF NOT EXISTS licence_status_by_name character varying(120);

-- The closed set, enforced by the database rather than by every caller. A typo
-- ('Ordered', 'licensed') would otherwise sit in the column matching no branch
-- of any switch in the app and render as a blank badge — the exact failure
-- mode memberFieldOptions.ts was written to stop for birthdate_visibility.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'members'::regclass AND conname = 'members_licence_status_values'
  ) THEN
    ALTER TABLE members ADD CONSTRAINT members_licence_status_values
      CHECK (licence_status IN ('none', 'to_be_ordered', 'ordered', 'finalized', 'licenced'));
  END IF;
END $$;

-- Season stamp shape: "2026/27". NULL is allowed and means "never stamped",
-- which the sweep treats as stale and resets — so a row can never carry a
-- status that belongs to no season at all.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'members'::regclass AND conname = 'members_licence_status_season_shape'
  ) THEN
    ALTER TABLE members ADD CONSTRAINT members_licence_status_season_shape
      CHECK (licence_status_season IS NULL OR licence_status_season ~ '^[0-9]{4}/[0-9]{2}$');
  END IF;
END $$;

-- The Data Explorer filters on this column across the whole register (708 rows
-- today), and the sweep scans it once per run.
CREATE INDEX IF NOT EXISTS idx_members_licence_status ON members (licence_status);

COMMENT ON COLUMN public.members.licence_status IS
  'Club licence-ordering workflow for the season in licence_status_season: none | to_be_ordered | ordered | finalized | licenced. The first four are set by hand (Data Explorer, /admin/anmeldungen); "licenced" is asserted ONLY by POST /kscw/admin/licence-status/sync from Swiss Volley (licence_activated AND licence_validated) or Basketplan (a licence row scraped this season). The sweep promotes only — it never demotes; the season rollover is the one thing that resets a status.';

COMMENT ON COLUMN public.members.licence_status_season IS
  'The season licence_status describes, Wiedisync short form ("2026/27"). A stamp that no longer equals kscw_current_season_label() means the status is last season''s and the sweep resets it to none. NULL = never stamped, treated the same way.';

COMMENT ON COLUMN public.members.licence_status_updated_at IS
  'When licence_status last changed. Stamped by the members.items.update hook for hand edits and by the sweep for machine promotions — never written by the member.';

COMMENT ON COLUMN public.members.licence_status_by_name IS
  'Display name of whoever last changed licence_status, or the machine that did ("Swiss Volley sync" / "Basketplan sync" / "Season rollover"). Raw-knex and psql writes bypass the Directus revision trail, so the actor is recorded on the row itself — same pattern as transfer_done_by_name (migration 234).';

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Every row gets the current season stamp so the first sweep has nothing stale
-- to reset, and the members the registers ALREADY confirm open at 'licenced'
-- instead of falsely reading as "no licence" on day one.
--
-- Volleyball: activated AND validated, both, per the club's decision — activated
-- alone means the club switched the licence on, validated is Swiss Volley
-- reconciling the paperwork (and for a transfer, the ITC actually landing).
-- Fielding an unvalidated licence is sanctionable, so "Licenced" must mean both.
-- ⚠ On prod today this matches ZERO members: the 2026/27 licences are not
-- activated in Volleymanager until ~September. That is the correct reading of
-- an off-season register, not a broken join.
--
-- Basketball: a row in the club's Basketplan licence list carrying a licence
-- number, scraped on or after this season's 1 June rollover. Basketplan has no
-- season column — the scrape date is the only thing that pins the list to a
-- season, so a stale scrape confirms nobody.
--
-- association_id is bigint and license_nr is a varchar that legitimately holds
-- leading zeros and, on a handful of rows, hand-typed non-numeric placeholders.
-- Guarding the cast with a digits-only regex is what stops one placeholder from
-- throwing on the whole statement (the same trap TransfersPage.tsx documents).
UPDATE members m
   SET licence_status = 'licenced',
       licence_status_by_name = 'Initial backfill'
 WHERE m.licence_status = 'none'
   AND (
     EXISTS (
       SELECT 1 FROM sv_vm_check s
        WHERE btrim(coalesce(m.license_nr, '')) ~ '^[0-9]+$'
          AND s.association_id = btrim(m.license_nr)::bigint
          AND s.licence_activated IS TRUE
          AND s.licence_validated IS TRUE
     )
     OR EXISTS (
       SELECT 1 FROM basketplan_people b
        WHERE nullif(btrim(b.licence_nr), '') IS NOT NULL
          AND b.scraped_at >= (make_date(EXTRACT(YEAR FROM public.kscw_current_season_start())::int, 6, 1))::timestamptz
          AND (
            nullif(btrim(b.licence_nr), '') = nullif(btrim(coalesce(m.license_nr, '')), '')
            OR (lower(btrim(b.last_name))  = lower(btrim(m.last_name))
            AND lower(btrim(b.first_name)) = lower(btrim(m.first_name))
            AND b.birthdate = m.birthdate)
          )
     )
   );

-- Stamp every row with the current season, promoted or not. Without this the
-- first sweep would see 708 NULL stamps, call them stale, and reset the very
-- rows the promotion above just set.
UPDATE members
   SET licence_status_season = public.kscw_current_season_label(),
       licence_status_updated_at = coalesce(licence_status_updated_at, now())
 WHERE licence_status_season IS DISTINCT FROM public.kscw_current_season_label();

-- ── Directus field registration ──────────────────────────────────────────────
-- grp_sport, next to license_nr and trainer_licences: this is one column for
-- both sports (Basketplan licences share it), so filing it under grp_licences_vb
-- would hide every basketball member's status behind a volleyball toggle —
-- precisely the mistake license_nr itself had to be moved out of.
-- ⚠ `directus_fields.options` is `json`; a bare NULL in a VALUES list types as
-- text and fails the INSERT. The dropdown choices are therefore built as an
-- explicit json literal and the other three rows pass NULL::json.
INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, "group", note)
SELECT v.collection, v.field, v.interface, v.options::json,
       v.readonly, v.hidden, v.sort, v.width, v."group", v.note
FROM (VALUES
  ('members', 'licence_status', 'select-dropdown',
   '{"choices":[{"text":"No licence","value":"none"},{"text":"To be ordered","value":"to_be_ordered"},{"text":"Ordered","value":"ordered"},{"text":"Finalized","value":"finalized"},{"text":"Licenced","value":"licenced"}]}',
   false, false, 46, 'half', 'grp_sport',
   'Licence-ordering workflow for the current season. "Licenced" is set by the Swiss Volley / Basketplan sync and means the federation confirmed it — set it by hand only to correct the machine.'),
  ('members', 'licence_status_season', 'input', NULL,
   true, false, 47, 'half', 'grp_sport',
   'The season the status above describes ("2026/27"). Reset automatically at the 1 June rollover.'),
  ('members', 'licence_status_updated_at', 'datetime', NULL,
   true, true, 48, 'half', 'grp_sport',
   'When the licence status last changed.'),
  ('members', 'licence_status_by_name', 'input', NULL,
   true, true, 49, 'half', 'grp_sport',
   'Who last changed the licence status — a person, or the sync that confirmed it.')
) AS v(collection, field, interface, options, readonly, hidden, sort, width, "group", note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = v.collection AND df.field = v.field
);

COMMIT;

-- Verification (dev/prod):
--   SELECT licence_status, count(*) FROM members GROUP BY 1 ORDER BY 2 DESC;
--   SELECT count(*) FROM members WHERE licence_status_season <> public.kscw_current_season_label();  -- → 0
--   SELECT public.kscw_current_season_label();                       -- → 2026/27
--   UPDATE members SET licence_status = 'Ordered' WHERE id = <test>; -- → CHECK violation
--   UPDATE members SET licence_status_season = '2026' WHERE id = <test>; -- → CHECK violation
--   -- Dry-run the sweep before arming it (reports, writes nothing, notifies nobody):
--   --   POST /kscw/admin/licence-status/sync?dry_run=1
