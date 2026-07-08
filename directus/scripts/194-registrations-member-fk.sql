-- 194: registrations.member — the authoritative registration → member link.
--
-- The approval hook (createMemberFromRegistration) has always COMPUTED the
-- member id (created or linked-to-existing) and then thrown it away; every
-- consumer since (ClubDesk registration-status badge, per-registration zone)
-- re-derived the link by email + first-name heuristics, which false-negatives
-- on divergent emails (child registered under a parent's address while the
-- member row carries their own — the Neo Paladino case, 2026-07-08).
-- This column stores the link once, at approval time; lookups become ID-first
-- (user rule 2026-07-08: "lookup should be by ID").
--
-- Backfill: two passes, both accepting ONLY a unique candidate (the JS
-- heuristics' .find() takes an arbitrary row on ties — the durable FK must
-- never guess): (1) email + symmetric first-name-prefix (the approval-hook
-- rule), (2) exact last-name + first-name-prefix (divergent-email rows).
-- Unmatched legacy rows stay NULL — the endpoint keeps its heuristic fallback.
-- Idempotent throughout.

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS member integer;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_member_fkey') THEN
    ALTER TABLE registrations
      ADD CONSTRAINT registrations_member_fkey
      FOREIGN KEY (member) REFERENCES members(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS registrations_member_idx ON registrations(member);

-- Pass 1: email + symmetric first-name prefix, unique candidate only.
WITH cand AS (
  SELECT r.id AS rid, m.id AS mid, count(*) OVER (PARTITION BY r.id) AS n
  FROM registrations r
  JOIN members m
    ON LOWER(BTRIM(r.email)) = LOWER(BTRIM(m.email))
   AND (
     NULLIF(BTRIM(r.vorname), '') IS NULL OR NULLIF(BTRIM(m.first_name), '') IS NULL
     OR LOWER(BTRIM(m.first_name)) LIKE LOWER(BTRIM(r.vorname)) || '%'
     OR LOWER(BTRIM(r.vorname)) LIKE LOWER(BTRIM(m.first_name)) || '%'
   )
  WHERE r.member IS NULL
)
UPDATE registrations r SET member = c.mid
FROM cand c WHERE r.id = c.rid AND c.n = 1;

-- Pass 2: exact last-name + symmetric first-name prefix (divergent email),
-- unique candidate only.
WITH cand AS (
  SELECT r.id AS rid, m.id AS mid, count(*) OVER (PARTITION BY r.id) AS n
  FROM registrations r
  JOIN members m
    ON LOWER(BTRIM(m.last_name)) = LOWER(BTRIM(r.nachname))
   AND (
     NULLIF(BTRIM(r.vorname), '') IS NULL OR NULLIF(BTRIM(m.first_name), '') IS NULL
     OR LOWER(BTRIM(m.first_name)) LIKE LOWER(BTRIM(r.vorname)) || '%'
     OR LOWER(BTRIM(r.vorname)) LIKE LOWER(BTRIM(m.first_name)) || '%'
   )
  WHERE r.member IS NULL AND NULLIF(BTRIM(r.nachname), '') IS NOT NULL
)
UPDATE registrations r SET member = c.mid
FROM cand c WHERE r.id = c.rid AND c.n = 1;

-- Register the field + m2o relation so the Directus admin/data explorer can
-- read and render it (raw-knex writes bypass Directus metadata otherwise).
INSERT INTO directus_fields (collection, field, special, interface, readonly, hidden, sort, note)
SELECT 'registrations', 'member', NULL, 'select-dropdown-m2o', false, false, 90,
       'Member created/linked by this registration — stamped at approval (hook), backfilled by migration 194'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = 'registrations' AND df.field = 'member'
);

INSERT INTO directus_relations (many_collection, many_field, one_collection)
SELECT 'registrations', 'member', 'members'
WHERE NOT EXISTS (
  SELECT 1 FROM directus_relations dr WHERE dr.many_collection = 'registrations' AND dr.many_field = 'member'
);

-- Report backfill coverage (visible in the migration log).
SELECT 'registrations_member_backfill' AS metric,
       count(*) FILTER (WHERE member IS NOT NULL) AS linked,
       count(*) FILTER (WHERE member IS NULL) AS unlinked
FROM registrations;
