-- Migration 248 — members identity + hygiene: merge the duplicate person,
-- protect the VM join keys, and add the missing auth-link FKs
--
-- Context (DB review 2026-07-27, findings MBR-01, MBR-02, MBR-04/ri-05,
-- MBR-07, MBR-08).
--
-- MBR-01 — members 333 ("Michelle-Robine Nessler") and 585 ("Michelle Robine
-- Nessler") are the same person stored twice, sharing license_nr=323744 AND
-- vm_email — and license_nr is an exact join key (scorer-roster whereIn, VM
-- sync write-back, Basketplan people join), so sync and eligibility landed on
-- an arbitrary row. Canonical is 333: it holds the directus_users link, the
-- roster rows and clubdesk_id 1001135. 585 has NO user, NO member_teams, NO
-- participations; the ONLY referencing row anywhere (all 59 member-FK columns
-- + games duty columns checked live) is finance_invoices 30427.
-- ⚠ ClubDesk still holds BOTH contacts (1001135 kept on 333, 1001031 orphaned
-- with 585) — the ClubDesk-side dedup is a MANUAL follow-up in the register;
-- until then the nightly sync-down may re-materialize contact 1001031, which
-- the register cleanup resolves at the source.
--
-- MBR-02 — members 490/491 carry the placeholder license_nr='0' ('0' is
-- truthy in JS and an exact-match join value in the Basketplan people join).
-- NOTE: leading zeros are real and significant (live: '038514', '055803' —
-- VM/Basketplan join licence numbers as STRINGS), so the format CHECK allows
-- them and bans only the lone '0'.
--
-- MBR-04/ri-05 — of members' reference columns only photo had an FK.
-- members."user" (the auth link every own-profile permission walks) and
-- requested_team were bare integers/uuids; a directus_users or teams delete
-- would silently dangle. Also: nothing prevented two members sharing one
-- directus_user (0 live — keep it that way).
--
-- MBR-07 — position/role were json (no equality operator, no indexing);
-- jsonb is the project norm elsewhere (clubdesk_push_changes).
-- MBR-08 — members_clubdesk_id_idx duplicates the partial unique
-- members_clubdesk_id_uq for every real lookup.
--
-- Schema + data repair; idempotent (safe to re-run).

BEGIN;

-- ── (1) MBR-01: merge member 585 into 333 ────────────────────────────────
-- Known reference (live 2026-07-27): finance_invoices 30427.
UPDATE finance_invoices SET member = 333 WHERE id = 30427 AND member = 585;

-- Defensive sweep: anything that appeared on 585 since the review re-points
-- to 333 (all no-ops today). Junction-style tables guard against creating a
-- duplicate pair.
UPDATE finance_invoices SET member = 333 WHERE member = 585;
UPDATE participations   SET member = 333 WHERE member = 585
  AND NOT EXISTS (SELECT 1 FROM participations p2 WHERE p2.member = 333
                  AND p2.activity_type = participations.activity_type
                  AND p2.activity_id = participations.activity_id
                  AND COALESCE(p2.session_id,'') = COALESCE(participations.session_id,''));
DELETE FROM participations WHERE member = 585;
UPDATE absences        SET member = 333 WHERE member = 585;
UPDATE notifications   SET member = 333 WHERE member = 585;
UPDATE member_teams    SET member = 333 WHERE member = 585
  AND NOT EXISTS (SELECT 1 FROM member_teams mt2 WHERE mt2.member = 333 AND mt2.team = member_teams.team);
DELETE FROM member_teams WHERE member = 585;

-- The delete: only if 585 still looks like the known duplicate (same licence,
-- no auth link) — a re-run or a diverged clone where 585 is someone else
-- leaves the row alone.
DELETE FROM members
WHERE id = 585 AND "user" IS NULL AND clubdesk_id = '1001031';

-- ── (2) MBR-02: kill the '0' placeholder, then lock the format ───────────
UPDATE members SET license_nr = NULL WHERE license_nr = '0';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'members_license_nr_fmt' AND conrelid = 'members'::regclass
  ) THEN
    ALTER TABLE members
      ADD CONSTRAINT members_license_nr_fmt
      CHECK (license_nr IS NULL OR (license_nr ~ '^[0-9]+$' AND license_nr <> '0'));
  END IF;
END $$;

-- ── (3) Unique join keys (after the merge above) ─────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS members_license_nr_uq
  ON members (license_nr) WHERE license_nr IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS members_vm_email_uq
  ON members (vm_email) WHERE vm_email IS NOT NULL;

-- ── (4) MBR-04/ri-05: auth link + requested_team FKs ─────────────────────
UPDATE members m SET "user" = NULL
 WHERE m."user" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM directus_users u WHERE u.id = m."user");
UPDATE members m SET requested_team = NULL
 WHERE m.requested_team IS NOT NULL AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = m.requested_team);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_user_foreign' AND conrelid = 'members'::regclass) THEN
    ALTER TABLE members ADD CONSTRAINT members_user_foreign
      FOREIGN KEY ("user") REFERENCES directus_users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_requested_team_foreign' AND conrelid = 'members'::regclass) THEN
    ALTER TABLE members ADD CONSTRAINT members_requested_team_foreign
      FOREIGN KEY (requested_team) REFERENCES teams(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS members_user_uq
  ON members ("user") WHERE "user" IS NOT NULL;

-- ── (5) MBR-07: json → jsonb ─────────────────────────────────────────────
-- (members_role_values_valid already casts ::jsonb — unaffected.)
-- `role` is referenced by the stats_members + stats_club_overview views
-- (003/068; security_invoker per 072), and Postgres refuses ALTER COLUMN
-- TYPE on any view-referenced column — so: capture the live definitions,
-- drop both views, convert, recreate, restore security_invoker. The views
-- are independent of each other and carry no ACLs (verified live: relacl
-- NULL — SCHEMA.sql is dumped --no-acl, so nothing to restore there). The
-- data_type guard doubles as the idempotency guard: once role is jsonb the
-- whole block is a no-op and the recreated views are left alone.
DO $$
DECLARE
  v_stats_members  text;
  v_stats_overview text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'members'
      AND column_name = 'role' AND data_type = 'json'
  ) THEN
    v_stats_members  := pg_get_viewdef('public.stats_members'::regclass, true);
    v_stats_overview := pg_get_viewdef('public.stats_club_overview'::regclass, true);
    DROP VIEW stats_club_overview;
    DROP VIEW stats_members;
    ALTER TABLE members ALTER COLUMN role TYPE jsonb USING role::jsonb;
    EXECUTE format('CREATE VIEW stats_members AS %s', v_stats_members);
    EXECUTE format('CREATE VIEW stats_club_overview AS %s', v_stats_overview);
    ALTER VIEW stats_members       SET (security_invoker = true);
    ALTER VIEW stats_club_overview SET (security_invoker = true);
  END IF;
END $$;

-- "position" has no view dependency (verified via pg_depend) — plain guarded
-- conversion.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'members'
      AND column_name = 'position' AND data_type = 'json'
  ) THEN
    ALTER TABLE members ALTER COLUMN "position" TYPE jsonb USING "position"::jsonb;
  END IF;
END $$;

-- ── (6) MBR-08: drop the redundant clubdesk_id index ─────────────────────
-- members_clubdesk_id_uq (partial unique, WHERE clubdesk_id IS NOT NULL)
-- serves every real lookup; the plain btree twin only doubles write cost.
DROP INDEX IF EXISTS members_clubdesk_id_idx;

COMMIT;
