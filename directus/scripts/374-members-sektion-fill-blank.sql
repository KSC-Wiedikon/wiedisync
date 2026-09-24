-- Migration 374: fill members.sektion where it is blank
--
-- Sektion is the member's SPORT in the ClubDesk register — a picklist of
-- Volleyball / Basketball / KSCW (KSCW = passive / club-wide). Migration 366
-- backfilled it from the registration, but only `WHERE m.sektion IS NULL`, so
-- rows holding an empty STRING were skipped: on 24.09.2026 four volleyball
-- players (Paula Farina among them) had '' here and an empty Sektion cell in
-- ClubDesk, which the fill-only push could not repair from an empty wiedisync
-- value.
--
-- Same derivation as 366 / deriveSektion(): the approved registration's
-- membership_type first, else the sport of the member's active teams when it
-- is unambiguous. A member matching neither is left alone for a human.
--
-- Fill-only + idempotent (only blank rows are touched).

BEGIN;

UPDATE members m
   SET sektion = COALESCE(
         (SELECT CASE lower(btrim(r.membership_type))
                   WHEN 'volleyball' THEN 'Volleyball'
                   WHEN 'basketball' THEN 'Basketball'
                 END
            FROM registrations r
           WHERE r.member = m.id AND r.status = 'approved'
           ORDER BY r.submitted_at DESC NULLS LAST
           LIMIT 1),
         (SELECT CASE WHEN count(DISTINCT t.sport) = 1
                      THEN initcap(min(t.sport)) END
            FROM member_teams mt JOIN teams t ON t.id = mt.team
           WHERE mt.member = m.id AND t.active IS TRUE))
 WHERE btrim(coalesce(m.sektion, '')) = '';

COMMIT;

-- Verification:
--   SELECT id, sektion FROM members WHERE btrim(coalesce(sektion, '')) = '';  -- expect 0 (or only unresolvable rows)
