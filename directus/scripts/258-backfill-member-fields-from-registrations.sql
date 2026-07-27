-- Migration 258 — backfill birthdate + anrede from approved registrations
--
-- Context (2026-07-27, live case member 525 / registration 26 / ClubDesk
-- contact 1001301). The registration-approval hook materializes members two
-- ways: the create-new-member branch copies `birthdate` from
-- reg.geburtsdatum, but the FILL-ONLY branch for an EXISTING member (shell
-- invites — the "Rajesh" path: team-invite shell first, full registration
-- second) never filled it; and NEITHER branch copied `anrede`, though the
-- signup form collects it (Herr/Frau) and the ClubDesk sync pushes
-- members.anrede as the register's salutation. Net effect: the ClubDesk
-- CREATE/UPDATE push sent empty Geburtsdatum/Anrede cells for exactly these
-- members. The hook is fixed in the same change-set; this backfills the rows
-- the gap already produced.
--
-- Live counts 2026-07-27: 1 birthdate gap (member 525), 18 anrede gaps.
-- Fill-only — a member value, once present, is never overwritten; matched
-- strictly via the registrations.member link (not name/email heuristics).
--
-- Schema-free data backfill; idempotent (safe to re-run).

BEGIN;

UPDATE members m
   SET birthdate = r.geburtsdatum
  FROM registrations r
 WHERE r.member = m.id
   AND r.status = 'approved'
   AND m.birthdate IS NULL
   AND r.geburtsdatum IS NOT NULL;

UPDATE members m
   SET anrede = r.anrede
  FROM registrations r
 WHERE r.member = m.id
   AND r.status = 'approved'
   AND m.anrede IS NULL
   AND r.anrede IN ('Herr', 'Frau');

COMMIT;
