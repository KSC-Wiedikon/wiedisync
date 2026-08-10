-- Migration 302: the club register's Status, Eintritt and Austritt, in wiedisync
--
-- Until now the three fields that decide whether somebody IS a member of the
-- club — ClubDesk's `Status`, `Eintritt` and `Austritt` — existed ONLY in
-- ClubDesk. wiedisync mirrored them read-only (`clubdesk_export`) and modelled
-- membership with a single boolean, `kscw_membership_active`. That boolean
-- cannot say WHY somebody is no longer a member, cannot express Ehrenmitglied
-- at all, and carries no date, so "when did they leave" was only ever
-- answerable by opening ClubDesk.
--
-- The seven values are ClubDesk's own picklist, verbatim (measured on prod
-- 2026-08-10 — Aktivmitglied 526, Ehemaliges Mitglied 390, Kein Mitglied 109,
-- Passivmitglied 88, Zwischenjahr 27, Ehrenmitglied 12, Verstorben 1). They are
-- NOT translated and NOT re-spelled: the push writes them straight into the
-- legal register's Status cell, where a re-spelling is a new picklist entry
-- rather than a synonym. Same reason `beitragskategorie` keeps its German.
--
-- ── Who wins ────────────────────────────────────────────────────────────────
-- These three are the first columns wiedisync may write back into ClubDesk's
-- OWN authoritative fields (`CD_PUSH_HEADERS` has always kept Status off UPDATE
-- rows). The contract, decided with the user 2026-08-10, is "wiedisync wins
-- until pushed, then ClubDesk":
--
--   • Edit here            → the members.* value changes and the row is flagged
--                            `clubdesk_push_pending` (the members.items.update
--                            hook does this, same shape as iban / ahv_nummer).
--   • Saturday sync-down   → fills/overwrites from the register EXCEPT on rows
--                            with a push pending. That exception is the whole
--                            guarantee: without it a Monday edit is silently
--                            reverted on Saturday if nobody approved the push.
--   • Approved sync-up     → the value lands in ClubDesk, the flag clears, and
--                            the register is authoritative again — so a change
--                            made IN ClubDesk still flows back next Saturday.
--
-- Divergences that are neither (somebody edited both sides) surface as ordinary
-- CONFLICTS in Data Health via computeClubdeskDrift, for a human to resolve.
--
-- ── Dates ───────────────────────────────────────────────────────────────────
-- Real `date` columns, not the register's `dd.mm.yyyy` text. ClubDesk's export
-- format is a display format; storing it verbatim would make "who left this
-- season" a string comparison. buildPushCsv formats back to dd.mm.yyyy on the
-- way out (fmtBirthdateDDMMYYYY, exactly as birthdate already does).
--
-- Schema-only + idempotent. After applying: `npm run db:setup-perms:dev|prod`
-- — the three columns join the admin/Vorstand update lists and the member's
-- own-read list (a member may see their own membership status; they never
-- write it).

BEGIN;

-- ── Columns ──────────────────────────────────────────────────────────────────
ALTER TABLE members ADD COLUMN IF NOT EXISTS register_status character varying(24);
ALTER TABLE members ADD COLUMN IF NOT EXISTS eintritt date;
ALTER TABLE members ADD COLUMN IF NOT EXISTS austritt date;

-- The closed set, enforced by the database rather than by every caller — a
-- value outside ClubDesk's picklist would be pushed into the legal register and
-- silently create an eighth status there. NULL is allowed and means "wiedisync
-- has never been told", which is what every member whose ClubDesk contact is
-- unlinked keeps after the backfill below.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'members'::regclass AND conname = 'members_register_status_values'
  ) THEN
    ALTER TABLE members ADD CONSTRAINT members_register_status_values
      CHECK (register_status IS NULL OR register_status IN (
        'Kein Mitglied', 'Aktivmitglied', 'Passivmitglied', 'Ehrenmitglied',
        'Ehemaliges Mitglied', 'Verstorben', 'Zwischenjahr'
      ));
  END IF;
END $$;

-- An exit date without a departed status is a contradiction the UI cannot
-- produce (picking an active status clears the date) but a hand-written SQL
-- update could. Deliberately NOT the converse: a departed member with no
-- Austritt is a real and common register state — 390 'Ehemaliges Mitglied'
-- contacts on prod against 359 Austritt dates — and /clubdesk-departed already
-- treats the missing date as "not confirmed departed" rather than an error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'members'::regclass AND conname = 'members_austritt_needs_departed_status'
  ) THEN
    ALTER TABLE members ADD CONSTRAINT members_austritt_needs_departed_status
      CHECK (
        austritt IS NULL
        OR register_status IS NULL
        OR register_status IN ('Kein Mitglied', 'Ehemaliges Mitglied', 'Verstorben')
      );
  END IF;
END $$;

-- The Data Explorer filters and groups by status across the whole register.
CREATE INDEX IF NOT EXISTS idx_members_register_status ON members (register_status);

COMMENT ON COLUMN public.members.register_status IS
  'The club register''s membership status, ClubDesk''s own picklist verbatim: Kein Mitglied | Aktivmitglied | Passivmitglied | Ehrenmitglied | Ehemaliges Mitglied | Verstorben | Zwischenjahr. Two-way with ClubDesk — wiedisync wins while clubdesk_push_pending is set, the register wins once the push has landed (see CD_PUSH_HEADERS in kscw-endpoints/src/clubdesk-update.js). NOT the same thing as kscw_membership_active, which is wiedisync''s own "counts as a member here" switch.';

COMMENT ON COLUMN public.members.eintritt IS
  'Club entry date (ClubDesk "Eintritt"). Pushed as dd.mm.yyyy. For members created from a signup this is the registration SUBMISSION date (user rule 2026-07-06); for everybody else it is whatever the register holds.';

COMMENT ON COLUMN public.members.austritt IS
  'Club exit date (ClubDesk "Austritt"). Only meaningful with a departed register_status, which a CHECK constraint enforces. Prefilled with today when an admin sets a departed status in the Data Explorer, and cleared when they set an active one.';

-- ── Backfill from the register mirror ───────────────────────────────────────
-- The register is the source for the opening value of all three: this migration
-- is the moment wiedisync learns what ClubDesk has always known. DISTINCT ON
-- because clubdesk_export stages one row per contact PER GROUP — the contact
-- columns are identical across a contact's rows, so the lowest row_id wins
-- (the same dedupe computeClubdeskDrift and the /up echo already use).
--
-- Dates are guarded by a shape regex rather than trusted to to_date(): the
-- column is free text in the export and one malformed cell would abort the
-- whole statement. A cell that does not match is left NULL and shows up as a
-- fill candidate later, which is the correct reading of "the register does not
-- hold a usable date" — never a wrong date.
WITH cd AS (
  SELECT DISTINCT ON (btrim(clubdesk_id))
         btrim(clubdesk_id) AS cdid,
         nullif(btrim(status), '') AS status,
         CASE WHEN btrim(coalesce(eintritt, '')) ~ '^\d{2}\.\d{2}\.\d{4}$'
              THEN to_date(btrim(eintritt), 'DD.MM.YYYY') END AS eintritt,
         CASE WHEN btrim(coalesce(austritt, '')) ~ '^\d{2}\.\d{2}\.\d{4}$'
              THEN to_date(btrim(austritt), 'DD.MM.YYYY') END AS austritt
    FROM clubdesk_export
   WHERE nullif(btrim(clubdesk_id), '') IS NOT NULL
   ORDER BY btrim(clubdesk_id), row_id
)
--
-- ⚠ The exit date is taken ONLY when the status it lands next to is a departed
-- one. The register does not enforce that pairing and therefore contains rows
-- that break it — Timo Beyerlein is 'Passivmitglied' with an Austritt of
-- 30.07.2026 — and copying such a row verbatim violates
-- members_austritt_needs_departed_status in this very statement. The status is
-- the claim and the date is only its detail, so the date is what gets dropped.
UPDATE members m
   SET register_status = COALESCE(m.register_status, cd.status),
       eintritt        = COALESCE(m.eintritt, cd.eintritt),
       austritt        = CASE
         WHEN COALESCE(m.register_status, cd.status)
              IN ('Kein Mitglied', 'Ehemaliges Mitglied', 'Verstorben')
         THEN COALESCE(m.austritt, cd.austritt)
       END
  FROM cd
 WHERE cd.cdid = m.clubdesk_id
   AND (m.register_status IS NULL OR m.eintritt IS NULL OR m.austritt IS NULL)
   -- Only ever FILL. Re-running this migration on a database where an admin has
   -- already set a status by hand must not walk it back to the register's.
   AND (cd.status IS NOT NULL OR cd.eintritt IS NOT NULL OR cd.austritt IS NOT NULL);

-- An Austritt whose status did not come along (a register row holding an exit
-- date under an ACTIVE status — ClubDesk allows it) would violate the CHECK the
-- moment anybody touches the row. Drop the orphan date rather than invent a
-- departure: the status is the claim, the date is only its detail.
UPDATE members
   SET austritt = NULL
 WHERE austritt IS NOT NULL
   AND (register_status IS NULL
        OR register_status NOT IN ('Kein Mitglied', 'Ehemaliges Mitglied', 'Verstorben'));

-- ── Directus field registration ─────────────────────────────────────────────
-- grp_club_status, next to kscw_membership_active / wiedisync_active: those two
-- and these three are the same question asked of two different systems, and an
-- admin comparing them should not have to scroll between field groups.
-- ⚠ `directus_fields.options` is `json`; a bare NULL in a VALUES list types as
-- text and fails the INSERT — the two date rows pass NULL::json (memory
-- [[member-fee-overrides]], migration 299).
INSERT INTO directus_fields (collection, field, interface, options, readonly, hidden, sort, width, "group", note)
SELECT v.collection, v.field, v.interface, v.options::json,
       v.readonly, v.hidden, v.sort, v.width, v."group", v.note
FROM (VALUES
  ('members', 'register_status', 'select-dropdown',
   '{"choices":[{"text":"Kein Mitglied","value":"Kein Mitglied"},{"text":"Aktivmitglied","value":"Aktivmitglied"},{"text":"Passivmitglied","value":"Passivmitglied"},{"text":"Ehrenmitglied","value":"Ehrenmitglied"},{"text":"Ehemaliges Mitglied","value":"Ehemaliges Mitglied"},{"text":"Verstorben","value":"Verstorben"},{"text":"Zwischenjahr","value":"Zwischenjahr"}]}',
   false, false, 3, 'half', 'grp_club_status',
   'The club register''s membership status. Two-way with ClubDesk: an edit here rides the next approved sync-up into the register.'),
  ('members', 'eintritt', 'datetime', NULL,
   false, false, 4, 'half', 'grp_club_status',
   'Club entry date (ClubDesk "Eintritt").'),
  ('members', 'austritt', 'datetime', NULL,
   false, false, 5, 'half', 'grp_club_status',
   'Club exit date (ClubDesk "Austritt"). Only settable alongside a departed status.')
) AS v(collection, field, interface, options, readonly, hidden, sort, width, "group", note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields df WHERE df.collection = v.collection AND df.field = v.field
);

COMMIT;

-- Verification (dev/prod):
--   SELECT register_status, count(*) FROM members GROUP BY 1 ORDER BY 2 DESC;
--   -- Expect the linked subset of prod's register: Aktivmitglied ~500,
--   -- Ehemaliges Mitglied / Kein Mitglied small (most are unlinked contacts),
--   -- Ehrenmitglied ~12, Verstorben 0-1, and NULL for every unlinked member.
--   SELECT count(*) FROM members WHERE eintritt IS NOT NULL;
--   SELECT count(*) FROM members
--    WHERE austritt IS NOT NULL
--      AND register_status NOT IN ('Kein Mitglied','Ehemaliges Mitglied','Verstorben');  -- → 0
--   UPDATE members SET register_status = 'Ehrenmitglieder' WHERE id = <test>;  -- → CHECK violation
--   UPDATE members SET austritt = now()::date WHERE id = <active test member>; -- → CHECK violation
