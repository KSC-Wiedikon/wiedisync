-- Migration 110: split opponent contacts into Calendar vs Team responsibles.
--
-- game_scheduling_opponents stored ONE merged contact blob (contact_name /
-- contact_email = the union of the club calendar responsible(s) +
-- the opponent team's own responsible(s)). That hid which contacts came from
-- where, and a contacts refresh could silently drop the per-team responsibles
-- (they're matched by the opponent team's staticTeamIdentifier — see migration
-- 106 — and a miss left only the club calendar contacts).
--
-- We now ALSO persist the two groups separately so the dashboard can label them
-- ("Calendar responsibles" / "Team responsibles") and a drop is visible. The
-- existing contact_name/contact_email stay as the UNION (everything that reads
-- or emails contacts keeps working unchanged); the new columns are additive.
--
-- Schema-only + idempotent per the CLAUDE.md migration policy. The opponents
-- read policy grants fields ['*'], so no permission row is needed; the columns
-- are registered with Directus so the items API returns them.

BEGIN;

ALTER TABLE game_scheduling_opponents
  ADD COLUMN IF NOT EXISTS calendar_contact_name  text,
  ADD COLUMN IF NOT EXISTS calendar_contact_email text,
  ADD COLUMN IF NOT EXISTS team_contact_name      text,
  ADD COLUMN IF NOT EXISTS team_contact_email     text;

-- Register each field with Directus so the items API reads them.
INSERT INTO directus_fields (collection, field, special, interface, sort, width, note)
SELECT 'game_scheduling_opponents', v.field, NULL, 'input', v.sort, 'half', v.note
FROM (VALUES
  ('calendar_contact_name',  90, 'Calendar (Spielplanverantwortliche) contact names, comma-joined.'),
  ('calendar_contact_email', 91, 'Calendar (Spielplanverantwortliche) contact emails, comma-joined.'),
  ('team_contact_name',      92, 'Team responsible (Teamverantwortliche) contact names, comma-joined.'),
  ('team_contact_email',     93, 'Team responsible (Teamverantwortliche) contact emails, comma-joined.')
) AS v(field, sort, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f
  WHERE f.collection = 'game_scheduling_opponents' AND f.field = v.field
);

COMMIT;
