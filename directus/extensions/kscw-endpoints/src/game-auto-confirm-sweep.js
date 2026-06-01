/**
 * Game auto-confirm sweep.
 *
 * SVRZ + Basketplan syncs insert games via raw knex (`db('games').insert`),
 * which bypasses the `games.items.create` action in kscw-hooks — so neither the
 * team-level game auto-confirm (teams.features_enabled.game_auto_confirm /
 * games.auto_confirm_rsvp) nor the per-member opt-in (members.auto_confirm_games,
 * migration 077) ever fires for synced games. This sweep runs once at the end of
 * each game sync and confirms every eligible member on all upcoming games.
 *
 * Eligibility per (game, member): guest_level = 0 AND
 *   ( effective team game-auto-confirm on  OR  member opted in ).
 * Effective team setting = COALESCE(games.auto_confirm_rsvp,
 *   teams.features_enabled->>'game_auto_confirm', false) — mirrors
 *   effectiveGameAutoConfirm() in kscw-hooks.
 *
 * NOT EXISTS skips manual answers and absence-declines (both are rows), so the
 * sweep never overwrites a choice and is safe to re-run every sync.
 */
export async function sweepGameAutoConfirm(db, log) {
  try {
    const res = await db.raw(`
      INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff)
      SELECT mt.member, 'game', g.id::text, 'confirmed', '', 0, false
      FROM games g
      JOIN teams t ON t.id = g.kscw_team
      JOIN member_teams mt ON mt.team = g.kscw_team
      JOIN members m ON m.id = mt.member
      WHERE g.date::date >= CURRENT_DATE
        AND g.status NOT IN ('completed', 'postponed', 'cancelled')
        AND mt.guest_level = 0
        AND (
          COALESCE(g.auto_confirm_rsvp,
                   NULLIF(t.features_enabled->>'game_auto_confirm', '')::boolean,
                   false) = true
          OR m.auto_confirm_games = true
        )
        AND NOT EXISTS (
          SELECT 1 FROM participations p
          WHERE p.activity_type = 'game' AND p.activity_id = g.id::text AND p.member = mt.member
        )
    `)
    const n = res?.rowCount || 0
    if (n > 0) log.info(`[game-auto-confirm-sweep] ${n} participations confirmed`)
    return n
  } catch (err) {
    log.error(`[game-auto-confirm-sweep] ${err.message}`)
    return 0
  }
}
