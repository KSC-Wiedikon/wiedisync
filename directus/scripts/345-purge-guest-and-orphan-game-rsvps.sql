-- 345-purge-guest-and-orphan-game-rsvps.sql
--
-- Data cleanup (idempotent). Removes GAME participation rows that no roster can
-- show but every RSVP brick counts. Two populations, one symptom.
--
-- (A) Guest players — the exact set migration 124 purged on 2026-06-22, back
--     again. 124 fixed `autoDeclineForAbsence` (the absence-driven sweep) but
--     TWO other writers seed the same rows and never got the guard:
--       * the `games.items.create` action — a NEW fixture landing inside an
--         existing absence, which is how the Züri Cup rows synced 01./06.08.2026
--         acquired theirs the day they appeared;
--       * `reEvalActivityAutoDeclines` — re-run whenever a game's date moves.
--     Both are guarded in the same change (kscw-hooks), so this deletes the
--     historical rows only.
--
--     Why they are noise: a guest (`member_teams.guest_level > 0` on the game's
--     own team) may not play a league game — `trg_participations_guest_block`
--     (001) refuses the confirm and `ParticipationRosterModal` drops them from
--     every game roster. `ParticipationSummary` has no roster context and counts
--     every row, so each one pushed the declined brick one above the roster.
--     Reported 27.08.2026: H3's VBC Swiss card read "1 declined" against a
--     roster showing none. 128 rows on future fixtures at the time (D4 75,
--     H3 19, D1 18, DU23-1 16).
--
--     Scope, as in 124: only GAME rows, only where the member is a guest on THAT
--     game's team (a guest on team A keeps their legitimate team-B rows). New
--     since 124: skip anyone called up to this specific fixture via
--     `game_guests` (migration 271) — a called-up player IS on the roster the
--     modal renders, so their row is real. Nobody matches that today; it is here
--     so the two definitions of "guest" can never be conflated by this DELETE.
--
-- (B) One orphan row from the 04.07.2026 sv-sync derby hijack. Row 409 (H3's
--     copy of H1 v H3, both rows share game_id vb_406192) was briefly rewritten
--     to kscw_team = H1; an auto-decline pass seeded H1's absentees onto it, and
--     the data repair put the team back without sweeping the rows. Left one H1
--     player holding an auto-declined RSVP on an H3 fixture — off the roster,
--     inside the brick, and the second half of the "2 declined, roster shows
--     none" report. Restricted to auto-decline-CREATED rows (auto_declined_by
--     set AND the sentinel waitlisted_at) so a real RSVP from somebody who has
--     since left a team is never touched.
--
-- Both DELETEs are naturally idempotent — re-running removes nothing once clean.

-- (A) guest players on their own team's games
DELETE FROM participations p
USING games g, member_teams mt
WHERE p.activity_type = 'game'
  AND p.activity_id = g.id::text
  AND mt.team = g.kscw_team
  AND mt.member = p.member
  AND mt.guest_level > 0
  AND NOT EXISTS (
    SELECT 1 FROM game_guests gg
    WHERE gg.game = g.id AND gg.member = p.member
  );

-- (B) auto-decline rows for members who are in no part of the game's squad
--     (roster ∪ called-up guests ∪ coaches ∪ team responsibles)
DELETE FROM participations p
USING games g
WHERE p.activity_type = 'game'
  AND p.activity_id = g.id::text
  AND p.auto_declined_by IS NOT NULL
  AND p.waitlisted_at = '1970-01-01 00:00:00+00'::timestamptz
  AND NOT EXISTS (
    SELECT 1 FROM member_teams mt WHERE mt.team = g.kscw_team AND mt.member = p.member
  )
  AND NOT EXISTS (
    SELECT 1 FROM game_guests gg WHERE gg.game = g.id AND gg.member = p.member
  )
  AND NOT EXISTS (
    SELECT 1 FROM teams_coaches tc WHERE tc.teams_id = g.kscw_team AND tc.members_id = p.member
  )
  AND NOT EXISTS (
    SELECT 1 FROM teams_responsibles tr WHERE tr.teams_id = g.kscw_team AND tr.members_id = p.member
  );
