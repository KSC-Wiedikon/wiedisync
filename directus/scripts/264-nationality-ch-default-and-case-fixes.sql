-- 264 — CH nationality default for linked members + capitalization repairs
--
-- ClubDesk data-quality audit 2026-07-28 (user-directed). Two data fixes:
--
-- (a) 93 ClubDesk-linked members had NO nationality on either side (ClubDesk
--     Nationalität empty AND members.nationalitaet_codes/nationalitaet empty).
--     User rule: default to CH unless clearly not Swiss. Counter-signal check
--     came back empty for all 93 (no foreign federation_of_origin, no foreign
--     Volleymanager citizenship), and the guard below re-checks the
--     federation signal anyway. The members nationality trigger derives the
--     German mirror 'Schweiz' from the code. ClubDesk's empty cells are
--     filled by the companion one-off [Id]-keyed import CSV (generated from
--     these rows AFTER this migration), not by push flags.
--     Unlinked ClubDesk contacts without nationality (320) are deliberately
--     NOT defaulted: every one is a non-member (Kein Mitglied / Ehemalige /
--     departed Passiv / Verstorben) — no register need, real guess risk.
--
-- (b) Capitalization repairs that predate the registration form's
--     titleCaseName (profile edits never title-cased): 3 lowercase street
--     addresses, 2 lowercase cities — pinned by id + exact current value so
--     re-runs and already-fixed rows are no-ops. Member 177's adresse held an
--     EMAIL ADDRESS (junk) → cleared; the v1.53.0 profile gate collects the
--     real address at her next login. Fixed rows with a ClubDesk link are
--     flagged for the next sync-up so the canonical spelling reaches the
--     register. ("von Wattenwyl", "de Miguel Aramburu", "von Lear" are
--     correct nobility particles — not touched.)

UPDATE members m SET nationalitaet_codes = 'CH'
FROM clubdesk_export cd
WHERE cd.clubdesk_id = m.clubdesk_id
  AND COALESCE(BTRIM(cd.nationalitaet), '') = ''
  AND COALESCE(BTRIM(m.nationalitaet_codes), '') = ''
  AND COALESCE(BTRIM(m.nationalitaet), '') = ''
  AND COALESCE(m.federation_of_origin, '') IN ('', 'CH', 'NONE');

UPDATE members SET adresse = 'Feldeggstrasse 36',
  clubdesk_push_pending = (clubdesk_id IS NOT NULL) OR clubdesk_push_pending
  WHERE id = 335 AND adresse = 'feldeggstrasse 36';
UPDATE members SET adresse = 'Bahnhofstrasse 7',
  clubdesk_push_pending = (clubdesk_id IS NOT NULL) OR clubdesk_push_pending
  WHERE id = 356 AND adresse = 'bahnhofstrasse 7';
UPDATE members SET adresse = 'Augustinergasse 20',
  clubdesk_push_pending = (clubdesk_id IS NOT NULL) OR clubdesk_push_pending
  WHERE id = 706 AND adresse = 'augustinergasse 20';
UPDATE members SET ort = 'Zürich',
  clubdesk_push_pending = (clubdesk_id IS NOT NULL) OR clubdesk_push_pending
  WHERE id = 311 AND ort = 'zürich';
UPDATE members SET adresse = NULL, ort = 'Zürich'
  WHERE id = 177 AND adresse = 'elena.deluche@gmail.com';
