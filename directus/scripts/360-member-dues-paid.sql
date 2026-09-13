-- 360 — "Has this member paid this season's membership bill?", as a flag on
-- the member row.
--
-- The fact has always been in wiedisync — `finance_invoices` mirrors ClubDesk's
-- Rechnungen nightly and carries the invoice status — but it was only reachable
-- per invoice, on the Finance member explorer, and nobody could filter the
-- member list by it ("which volleyball players have paid?" was a hand-written
-- SQL question on 13.09.2026). Three DERIVED columns on `members` answer it:
--
--   dues_paid          true iff a paid membership-dues invoice for the CURRENT
--                      season is linked to this member
--   dues_paid_season   the season that invoice bills, "2026/27" — so a stale
--                      true is self-describing after the 1 June rollover
--   dues_paid_at       ClubDesk's "Abgeschlossen am" (native: confirmed_at)
--
-- ── What counts as the season's bill ─────────────────────────────────────────
-- The invoice's SUBJECT, not its date or fiscal year. ClubDesk's July 2026
-- batch was issued with a 2025 invoice date (117 invoices dated 31.07.2025 for
-- "Mitgliederbeitrag Volleyball 2026/2027"), which puts them in fiscal year
-- 2025/26 by date while they bill 2026/27 by wording. The wording is what the
-- treasurer and the member both read, so it wins: `Mitgliederbeitrag` in the
-- subject plus the season written either long ("2026/2027", ClubDesk) or short
-- ("2026/27", the native dues run's default template). A Passivmitglied bill
-- is a membership bill too and counts.
--
-- Paid = ClubDesk status "Bezahlt" or "Bezahlt (teilw. abgeschrieben)", or a
-- native invoice at 'paid'. "Teilweise bezahlt" is NOT paid — the balance is
-- still owed — and every Storniert/cancelled row is ignored, which is exactly
-- how the re-issued-then-cancelled July batch stays out of the count.
--
-- ── Who keeps it current ─────────────────────────────────────────────────────
-- A STATEMENT-level trigger on finance_invoices, so both writers are covered
-- without either knowing: the nightly importer's DELETE + re-INSERT of the
-- ClubDesk mirror (two statements → two recomputes) and the native endpoints'
-- single-row knex writes (confirm / payments / cancel). One recompute is a
-- single UPDATE over ~700 members guarded by IS DISTINCT FROM — a few ms, and
-- on the nightly no-op it writes nothing (the members statement trigger
-- trg_pv_members still fires, a 20 ms refresh — measured, accepted).
--
-- The 1 June rollover is the one moment the flag goes stale: the season label
-- flips but no finance_invoices statement runs until the next nightly import
-- (04:00), which then clears every flag. Hours, not days, and in a window in
-- which nobody has been billed yet. `dues_paid_season` makes even that
-- window readable.
--
-- Raw SQL on `members` bypasses the Directus items hooks on purpose: nothing
-- here is a member edit, and it must never flag a ClubDesk push.
--
-- Schema-only + idempotent. After applying: restart the container (the three
-- directus_fields rows below are invisible to the schema cache until then).
-- No permission change: the audience is the Data Explorer (AdminRoute — full
-- admins bypass policies, KSCW Sport Admin reads members.* ) and the board
-- (unfiltered read). Own-read for members is a one-line follow-up in
-- setup-permissions.mjs (MEMBER_DERIVED_READ_FIELDS) if the profile ever
-- shows it.

BEGIN;

-- ── Columns ──────────────────────────────────────────────────────────────────
ALTER TABLE members ADD COLUMN IF NOT EXISTS dues_paid boolean NOT NULL DEFAULT false;
ALTER TABLE members ADD COLUMN IF NOT EXISTS dues_paid_season character varying(9);
ALTER TABLE members ADD COLUMN IF NOT EXISTS dues_paid_at date;

COMMENT ON COLUMN members.dues_paid IS
  'DERIVED — true iff a paid membership-dues invoice (subject "Mitgliederbeitrag … <current season>") is linked to this member. Recomputed by refresh_members_dues_paid() from finance_invoices; never write it.';
COMMENT ON COLUMN members.dues_paid_season IS
  'DERIVED — the season ("2026/27") the paid dues invoice bills. Set with dues_paid; NULL when it is false.';
COMMENT ON COLUMN members.dues_paid_at IS
  'DERIVED — when the dues invoice was settled (ClubDesk "Abgeschlossen am"; native: confirmed_at). NULL when dues_paid is false.';

CREATE INDEX IF NOT EXISTS members_dues_paid_idx ON members (dues_paid) WHERE dues_paid;

-- ── The recompute ────────────────────────────────────────────────────────────
-- Season pattern from the one place the cutover is defined
-- (kscw_current_season_start, migration 069): 2026 → '2026/(2027|27)'.
CREATE OR REPLACE FUNCTION public.refresh_members_dues_paid()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  y       integer := EXTRACT(YEAR FROM public.kscw_current_season_start())::int;
  season_label text := public.kscw_current_season_label();
  pat     text;
  changed integer := 0;
BEGIN
  pat := '(^|[^0-9])' || y::text || '/(' || (y + 1)::text || '|' || lpad(((y + 1) % 100)::text, 2, '0') || ')([^0-9]|$)';

  -- The paid dues invoice per member, if any — newest settlement wins when a
  -- member somehow holds two (a re-issue paid twice is a treasurer's problem,
  -- not a reason to show them unpaid). Only rows whose answer moves are
  -- written, so the members row (and its own statement trigger) is left alone
  -- on the nightly no-op.
  WITH paid AS (
    SELECT DISTINCT ON (fi.member)
           fi.member                                        AS member_id,
           coalesce(fi.closed_on, fi.confirmed_at::date)    AS paid_at
    FROM finance_invoices fi
    WHERE fi.member IS NOT NULL
      AND fi.subject ILIKE '%mitgliederbeitrag%'
      AND fi.subject ~ pat
      AND (fi.status ILIKE 'bezahlt%' OR fi.status = 'paid')
    ORDER BY fi.member, coalesce(fi.closed_on, fi.confirmed_at::date) DESC NULLS LAST, fi.id DESC
  ),
  target AS (
    SELECT m.id,
           (p.member_id IS NOT NULL)                              AS dues_paid,
           CASE WHEN p.member_id IS NOT NULL THEN season_label END AS dues_paid_season,
           p.paid_at                                              AS dues_paid_at
    FROM members m
    LEFT JOIN paid p ON p.member_id = m.id
  )
  UPDATE members m
  SET dues_paid        = t.dues_paid,
      dues_paid_season = t.dues_paid_season,
      dues_paid_at     = t.dues_paid_at
  FROM target t
  WHERE t.id = m.id
    AND (   m.dues_paid        IS DISTINCT FROM t.dues_paid
         OR m.dues_paid_season IS DISTINCT FROM t.dues_paid_season
         OR m.dues_paid_at     IS DISTINCT FROM t.dues_paid_at);
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END $$;

COMMENT ON FUNCTION public.refresh_members_dues_paid() IS
  'Recomputes members.dues_paid / dues_paid_season / dues_paid_at from finance_invoices for the current season (subject-matched, see migration 360). Returns the number of member rows changed. Fired by trg_members_dues_paid on every finance_invoices statement; safe to call by hand.';

CREATE OR REPLACE FUNCTION public.trg_members_dues_paid_fn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_members_dues_paid();
  RETURN NULL; -- AFTER STATEMENT
END $$;

DROP TRIGGER IF EXISTS trg_members_dues_paid ON finance_invoices;
CREATE TRIGGER trg_members_dues_paid
  AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON finance_invoices
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_members_dues_paid_fn();

-- ── Directus field registration (read-only, Finance & billing) ───────────────
INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'members', 'dues_paid', 'boolean', true, false, 230, 'half',
  'Derived: a paid membership-dues invoice for the current season is linked to this member. Recomputed from finance_invoices — never edit.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'dues_paid');

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'members', 'dues_paid_season', 'input', true, false, 231, 'half',
  'Derived: the season the paid dues invoice bills (e.g. 2026/27).'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'dues_paid_season');

INSERT INTO directus_fields (collection, field, interface, readonly, hidden, sort, width, note)
SELECT 'members', 'dues_paid_at', 'datetime', true, false, 232, 'half',
  'Derived: when the dues invoice was settled.'
WHERE NOT EXISTS (SELECT 1 FROM directus_fields WHERE collection = 'members' AND field = 'dues_paid_at');

-- ── Backfill ─────────────────────────────────────────────────────────────────
SELECT public.refresh_members_dues_paid();

COMMIT;
