-- 263 — Fill-only backfill: contact fields from approved registrations
--
-- Generalizes migration 258 (birthdate + anrede) to the remaining contact
-- fields. Live case 2026-07-28: registration REG-2026-4026 (id 8) was filed
-- under the PARENT's email for junior Neo Paladino, so the 29.06 approval
-- found no member to fill; Neo self-signed-up 03.07 under his own email and
-- the registration was linked to member 545 after the fact by a link-only
-- step — the approval hook's fill-only copy (kscw-hooks index.js, present
-- since 2026-04-03) only ever runs AT approval time. Net: adresse/plz/ort,
-- nationality (code CH) and AHV sat in the registration and never reached
-- the member. Sweep over all approved registrations found exactly this one
-- row affected; the migration is written generically so any future
-- after-the-fact link with the same gap heals on the next deploy.
--
-- Fill-only per field (a member value, once present, is never overwritten);
-- matched strictly via the registrations.member link. Nationality prefers
-- the ISO code (members trigger derives the German mirror); the free-text
-- fallback only fires when no code exists on either side. ClubDesk-linked
-- members are flagged for the next sync-up with per-field change entries
-- (hook-identical shape), same as migration 262.

UPDATE members m SET
  adresse = COALESCE(NULLIF(BTRIM(m.adresse), ''), NULLIF(BTRIM(r.adresse), '')),
  plz     = COALESCE(NULLIF(BTRIM(m.plz), ''),     NULLIF(BTRIM(r.plz), '')),
  ort     = COALESCE(NULLIF(BTRIM(m.ort), ''),     NULLIF(BTRIM(r.ort), '')),
  phone   = COALESCE(NULLIF(BTRIM(m.phone), ''),   NULLIF(BTRIM(r.telefon_mobil), '')),
  ahv_nummer = COALESCE(NULLIF(BTRIM(m.ahv_nummer), ''), NULLIF(BTRIM(r.ahv_nummer), '')),
  nationalitaet_codes = COALESCE(NULLIF(BTRIM(m.nationalitaet_codes), ''),
                                 NULLIF(BTRIM(r.nationalitaet_code), '')),
  -- Free-text fallback ONLY when no code exists anywhere: the members trigger
  -- then derives codes from the German spelling where it can.
  nationalitaet = COALESCE(NULLIF(BTRIM(m.nationalitaet), ''),
                           CASE WHEN NULLIF(BTRIM(m.nationalitaet_codes), '') IS NULL
                                 AND NULLIF(BTRIM(r.nationalitaet_code), '') IS NULL
                                THEN NULLIF(BTRIM(r.nationalitaet), '') END),
  clubdesk_push_pending = CASE WHEN m.clubdesk_id IS NOT NULL
    THEN true ELSE m.clubdesk_push_pending END,
  clubdesk_push_changes = CASE WHEN m.clubdesk_id IS NULL THEN m.clubdesk_push_changes ELSE
    (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
       FROM jsonb_array_elements(COALESCE(m.clubdesk_push_changes, '[]'::jsonb)) e
      WHERE e->>'field' NOT IN ('adresse', 'plz', 'ort', 'phone', 'ahv_nummer', 'nationalitaet'))
    || (CASE WHEN NULLIF(BTRIM(m.adresse), '') IS NULL AND NULLIF(BTRIM(r.adresse), '') IS NOT NULL
        THEN jsonb_build_array(jsonb_build_object('field', 'adresse', 'old_value', NULL, 'new_value', BTRIM(r.adresse))) ELSE '[]'::jsonb END)
    || (CASE WHEN NULLIF(BTRIM(m.plz), '') IS NULL AND NULLIF(BTRIM(r.plz), '') IS NOT NULL
        THEN jsonb_build_array(jsonb_build_object('field', 'plz', 'old_value', NULL, 'new_value', BTRIM(r.plz))) ELSE '[]'::jsonb END)
    || (CASE WHEN NULLIF(BTRIM(m.ort), '') IS NULL AND NULLIF(BTRIM(r.ort), '') IS NOT NULL
        THEN jsonb_build_array(jsonb_build_object('field', 'ort', 'old_value', NULL, 'new_value', BTRIM(r.ort))) ELSE '[]'::jsonb END)
    || (CASE WHEN NULLIF(BTRIM(m.phone), '') IS NULL AND NULLIF(BTRIM(r.telefon_mobil), '') IS NOT NULL
        THEN jsonb_build_array(jsonb_build_object('field', 'phone', 'old_value', NULL, 'new_value', BTRIM(r.telefon_mobil))) ELSE '[]'::jsonb END)
    || (CASE WHEN NULLIF(BTRIM(m.ahv_nummer), '') IS NULL AND NULLIF(BTRIM(r.ahv_nummer), '') IS NOT NULL
        THEN jsonb_build_array(jsonb_build_object('field', 'ahv_nummer', 'old_value', NULL, 'new_value', BTRIM(r.ahv_nummer))) ELSE '[]'::jsonb END)
    || (CASE WHEN NULLIF(BTRIM(m.nationalitaet_codes), '') IS NULL AND NULLIF(BTRIM(r.nationalitaet_code), '') IS NOT NULL
        THEN jsonb_build_array(jsonb_build_object('field', 'nationalitaet', 'old_value', NULL, 'new_value', BTRIM(r.nationalitaet_code))) ELSE '[]'::jsonb END)
  END
FROM registrations r
WHERE r.member = m.id
  AND r.status = 'approved'
  AND (
       (NULLIF(BTRIM(m.adresse), '') IS NULL AND NULLIF(BTRIM(r.adresse), '') IS NOT NULL)
    OR (NULLIF(BTRIM(m.plz), '') IS NULL AND NULLIF(BTRIM(r.plz), '') IS NOT NULL)
    OR (NULLIF(BTRIM(m.ort), '') IS NULL AND NULLIF(BTRIM(r.ort), '') IS NOT NULL)
    OR (NULLIF(BTRIM(m.phone), '') IS NULL AND NULLIF(BTRIM(r.telefon_mobil), '') IS NOT NULL)
    OR (NULLIF(BTRIM(m.ahv_nummer), '') IS NULL AND NULLIF(BTRIM(r.ahv_nummer), '') IS NOT NULL)
    OR (NULLIF(BTRIM(m.nationalitaet_codes), '') IS NULL AND NULLIF(BTRIM(m.nationalitaet), '') IS NULL
        AND (NULLIF(BTRIM(r.nationalitaet_code), '') IS NOT NULL OR NULLIF(BTRIM(r.nationalitaet), '') IS NOT NULL))
  );
