-- 266 — Default fee categories for the remaining 8 never-billed Aktivmitglieder
--
-- Completes the 2026-07-28 fee-gap audit (12 unbilled → 262 solved Alexander,
-- 265 the three treasurer-named ones). For the rest the treasurer's rule is
-- "440 per default plus 100 CHF fine" for members who never declared a
-- category at Anmeldung — i.e. 'VB Erwerbstätige' (CHF 440 base) with the
-- codified no-Schreiberlizenz surcharge applied by deriveMitgliederbeitrag at
-- push time (none of the six holds scorer_vb → CHF 540 pushed). A member who
-- is really a student can have the category corrected before billing — the
-- sync-up preview shows every cell.
--
-- The two basketball kids are NOT defaulted to the VB adult rate — their
-- category is age-band-structural: Matilda Maag (age 6, MU8) → 'BB Minis
-- Turnier' (210); Jesaya Manser (age 13, HU14) → 'BB Jugend Meisterschaft'
-- (310). Both are under 16 → no surcharge (SURCHARGE_YOUTH + isU16Plus gate).
--
-- Same fill-only shape as 262/265: pinned by id + still-empty category, push
-- flag + hook-identical clubdesk_push_changes entry for linked members.

UPDATE members m SET
  beitragskategorie = v.kategorie,
  clubdesk_push_pending = CASE WHEN m.clubdesk_id IS NOT NULL
    THEN true ELSE m.clubdesk_push_pending END,
  clubdesk_push_changes = CASE WHEN m.clubdesk_id IS NOT NULL THEN
    (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
       FROM jsonb_array_elements(COALESCE(m.clubdesk_push_changes, '[]'::jsonb)) e
      WHERE e->>'field' <> 'beitragskategorie')
    || jsonb_build_array(jsonb_build_object(
         'field', 'beitragskategorie', 'old_value', NULL, 'new_value', v.kategorie))
    ELSE m.clubdesk_push_changes END
FROM (VALUES
  (523, 'VB Erwerbstätige'),          -- Christine Albrecht (D1/D2)
  (522, 'VB Erwerbstätige'),          -- Marta Gambardella (D1/D2)
  (524, 'VB Erwerbstätige'),          -- Jens Baumgartner (HU23-1)
  (526, 'VB Erwerbstätige'),          -- Thierry Pfister (HU23-1)
  (473, 'VB Erwerbstätige'),          -- Sophie Dobbs (DU23-1/2)
  (529, 'VB Erwerbstätige'),          -- Aaliyah Schaller (DU23-1)
  (569, 'BB Minis Turnier'),          -- Matilda Maag (6, MU8)
  (311, 'BB Jugend Meisterschaft')    -- Jesaya Manser (13, HU14)
) AS v(id, kategorie)
WHERE m.id = v.id
  AND COALESCE(BTRIM(m.beitragskategorie), '') = '';
