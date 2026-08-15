/**
 * Who counts as "on a team" for RSVP purposes — players AND staff.
 *
 * Every auto-RSVP writer used to join `member_teams` alone, which is the
 * PLAYER roster. Coaches and team responsibles live in `teams_coaches` /
 * `teams_responsibles` and never get a `member_teams` row (see the
 * member_teams role model), so no auto-confirm path has ever reached them:
 * not the team toggle (`features_enabled.training_auto_confirm` /
 * `game_auto_confirm`), not the per-activity override, and not even their own
 * `members.auto_confirm_trainings` opt-in — that backfill joins the same
 * table. Surfaced 2026-08-15 by DU23-1's coach, who had the team toggle ON,
 * his personal flag ON, and no participation row on 57 of his 58 upcoming
 * trainings.
 *
 * This is the ONE definition both packages build their eligibility on, and it
 * mirrors the frontend exactly:
 *   - `AuthProvider.coachTeamIds` is the UNION of teams_coaches and
 *     teams_responsibles (both are "staff" to the app), intersected with
 *     active teams — hence the inner UNION here.
 *   - `isStaffOnly(team)` = staff of the team AND NOT on its roster. Somebody
 *     who is both (D4's coach, who also plays) is a PLAYER — one row, and
 *     `is_staff` false. That is what the NOT EXISTS in the second branch
 *     enforces, and why the branches can never both yield the same member.
 *
 * `is_staff` is not cosmetic. Player tallies drop staff rows
 * (`countConfirmedPlayers` in src/utils/participationWarnings.ts), so a
 * confirmed coach must not count toward `min_participants` — the
 * auto-cancel-on-min gate in kscw-hooks filters on it for the same reason.
 *
 * Staff carry `guest_level = 0`: guest levels are a roster property, and a
 * staff-only person has no roster row to read one from.
 *
 * @param {string} teamExpr SQL expression for the team id (e.g. `tr.team`,
 *   `g.kscw_team`, or a bind placeholder like `?::integer`). Interpolated
 *   twice — pass a column reference or a placeholder, never user input.
 * @returns {string} a parenthesised subquery yielding (member, guest_level, is_staff)
 */
export function teamPeopleSql(teamExpr) {
  return `(
    SELECT mt.member AS member, COALESCE(mt.guest_level, 0) AS guest_level, false AS is_staff
    FROM member_teams mt
    WHERE mt.team = ${teamExpr}
    UNION
    SELECT s.members_id AS member, 0 AS guest_level, true AS is_staff
    FROM (
      SELECT teams_id, members_id FROM teams_coaches
      UNION
      SELECT teams_id, members_id FROM teams_responsibles
    ) s
    WHERE s.teams_id = ${teamExpr}
      AND NOT EXISTS (
        SELECT 1 FROM member_teams mt2
        WHERE mt2.team = s.teams_id AND mt2.member = s.members_id
      )
  )`
}

/**
 * Guard for the GAME branch only. `trg_participations_guest_block` (migration
 * 001) refuses a confirmed game RSVP for anybody holding `guest_level > 0` in
 * ANY member_teams row — the trigger is club-wide, not per-team — and it
 * RAISES, which aborts the whole INSERT...SELECT rather than skipping the row.
 * Players are already filtered by `guest_level = 0` on their own row; a
 * staff-only person has no row to filter, so a coach who happens to guest for
 * another team would take the entire sweep down with them. Nobody matches
 * this on prod today (checked 2026-08-15) — it is here so that stays true.
 *
 * @param {string} memberExpr SQL expression for the member id
 */
export function notGuestAnywhereSql(memberExpr) {
  return `NOT EXISTS (
    SELECT 1 FROM member_teams gmt
    WHERE gmt.member = ${memberExpr} AND COALESCE(gmt.guest_level, 0) > 0
  )`
}
