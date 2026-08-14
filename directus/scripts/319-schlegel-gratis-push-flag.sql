-- 319 — fix-forward for 318: flag Livia Schlegel (#98) so her category change
-- SURVIVES and reaches the register.
--
-- WHAT 318 GOT WRONG. It set beitragskategorie = 'Gratis' and deliberately wrote
-- no push flag, reasoning that Beitragskategorie was unconditionally fill-only in
-- buildPushCsv and a flag would only promise a push that could not happen. The
-- first half was true; the conclusion was not. The sync-DOWN is
-- ClubDesk-AUTHORITATIVE on this column —
--
--     beitragskategorie = COALESCE(cd.categ, NULLIF(btrim(m.beitragskategorie),''))
--     … WHERE … m.clubdesk_push_pending IS DISTINCT FROM true
--
-- — so ClubDesk's 'Kein Beitrag' would have won her back at the next Saturday
-- 22:00 run. `clubdesk_push_pending` is not only the push licence, it is the ONLY
-- thing that shields a wiedisync edit from the down. 318 was a change with a
-- one-week half-life.
--
-- WHAT MAKES THE FLAG MEANINGFUL NOW. Shipped in the same commit as this file:
-- Beitragskategorie is a registerCell()-gated cell (CD_REGISTER_FIELDS), so a
-- change that NAMES the field is carried to the register instead of being echoed
-- away, and the members hook flags the field on any items-API edit from here on.
-- ⚠ The push drags Mitgliederbeitrag along with the category, priced under the
-- new one — for her that is CHF 0, which is what the register already holds
-- (verified with deriveMitgliederbeitrag against her real row: "0"), so the
-- amount cell is a no-op and only the category actually moves.
--
-- ⚠ Migration 318 is left exactly as applied. The runner tracks each file by
-- sha256 and refuses an edited migration that has already run, so the fix is a
-- new number — never a rewrite of history. Read 318 and 319 together; 318's
-- closing note about "no flag on purpose" is superseded by this file.
--
-- Data-only. Idempotent: the change entry replaces any earlier entry for the
-- same field, and a re-run simply re-asserts pending = true.

UPDATE members m
SET clubdesk_push_pending = true,
    clubdesk_push_changes = (
      SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
      FROM jsonb_array_elements(COALESCE(m.clubdesk_push_changes, '[]'::jsonb)) e
      WHERE e->>'field' IS DISTINCT FROM 'beitragskategorie'
    ) || jsonb_build_array(jsonb_build_object(
      'field', 'beitragskategorie',
      'old_value', 'Kein Beitrag',
      'new_value', 'Gratis'
    ))
WHERE m.id = 98
  AND m.beitragskategorie = 'Gratis'
  AND NULLIF(BTRIM(COALESCE(m.clubdesk_id, '')), '') IS NOT NULL;
