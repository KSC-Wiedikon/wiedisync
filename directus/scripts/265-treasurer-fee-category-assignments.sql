-- 265 — Treasurer-decided fee categories for three unbilled Aktivmitglieder
--
-- Follow-up to the 2026-07-28 fee-gap audit: 12 active members had neither a
-- Beitragskategorie nor a manual Mitgliederbeitrag (app-signup-era joiners who
-- never passed the fee-assigning registration form). The treasurer decided
-- three of them on 2026-07-28 (WhatsApp):
--   - Alban Scholtz (534)       → 'VB Schüler*in Meisterschaft' ("Schüler, 310")
--   - Joaquin Burgäzzi (155)    → 'Gratis'
--   - Vishvanth Sivakumar (536) → 'Gratis' ("Vishva is Free")
-- The remaining nine stay empty pending per-person decisions.
--
-- The treasurer's "don't know about schreiberfine" resolves itself: the
-- CHF 100 no-Schreiberlizenz surcharge is applied by deriveMitgliederbeitrag
-- at push time (user rule 2026-07-06) — with Alban's birthdate still unknown,
-- isU16Plus() is null and the youth surcharge is withheld, so the fill-only
-- billing cells send exactly 310 until his birthdate says otherwise.
--
-- Same push-flag shape as 262: pinned by id + still-empty category so re-runs
-- and manually-corrected rows are no-ops; all three are ClubDesk-linked, the
-- guard keeps the flag correct anyway.

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
  (534, 'VB Schüler*in Meisterschaft'),
  (155, 'Gratis'),
  (536, 'Gratis')
) AS v(id, kategorie)
WHERE m.id = v.id
  AND COALESCE(BTRIM(m.beitragskategorie), '') = '';
