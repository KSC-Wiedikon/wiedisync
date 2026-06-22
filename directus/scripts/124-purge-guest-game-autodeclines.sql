-- 124-purge-guest-game-autodeclines.sql
--
-- Data cleanup (idempotent). Removes participation rows that should never have
-- existed: auto-declined GAME RSVPs for guest players (member_teams.guest_level
-- > 0 on the game's own team).
--
-- Background. Guests can never play league games — `trg_participations_guest_block`
-- (001-postgres-triggers.sql) forbids a guest confirming a game, and the UI hides
-- the RSVP controls for guests entirely ("Guests cannot participate"). The ONLY
-- path that ever wrote a guest's game participation row was `autoDeclineForAbsence`
-- (kscw-hooks): when a guest filed a covering absence it inserted a `declined`
-- game row for every covered game. Those rows are pure noise —
--   * the roster modal already excludes guests from games, so they never showed
--     there, BUT
--   * `ParticipationSummary` (the card / detail-modal RSVP "bricks") counts every
--     participation row regardless of roster membership, so each such row pushed
--     the declined tally one above what the roster reported. Symptom: "brick says
--     2 declined, roster says 1" on most/all games of any team carrying a guest
--     with a standing absence.
--
-- The hook is fixed in the same change (adds `AND mt.guest_level = 0` to the games
-- INSERT, mirroring the auto-confirm guard) so no new rows are seeded. This
-- migration deletes the historical ones.
--
-- Scope is deliberately tight: only GAME rows, only where the member is a guest on
-- THAT game's team (a person who is a guest on team A but core on team B keeps
-- their legitimate team-B game rows). Naturally idempotent — re-running deletes
-- nothing once clean.

DELETE FROM participations p
USING games g, member_teams mt
WHERE p.activity_type = 'game'
  AND p.activity_id = g.id::text
  AND mt.team = g.kscw_team
  AND mt.member = p.member
  AND mt.guest_level > 0;
