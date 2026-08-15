/**
 * Training auto-confirm sweep — the backstop games already had and trainings
 * did not.
 *
 * Training auto-confirm fires at exactly three moments: training creation
 * (`applyTrainingAutoRSVP`, incl. the slot-cascade callsites), the team toggle
 * flip (`teams.items.update`), and the per-member flag flip
 * (`backfillMemberAutoConfirm`). All three are keyed on the activity or the
 * setting — NOT on the roster. So anybody who joins a team AFTER its trainings
 * were generated is never picked up, and stays "not responded" forever.
 *
 * That is not hypothetical: HU14's roster was filled on 2026-07-04, after the
 * August/September trainings had been generated, and on 2026-08-15 those
 * trainings carried 1–5 participations against a 21-strong roster while every
 * training generated later carried 21. Club-wide the gap was 460 rows.
 *
 * Games never showed this because `sweepGameAutoConfirm` re-runs after every
 * SVRZ/Basketplan sync and self-heals. This is the training equivalent, run
 * nightly from kscw-hooks. Two differences from the game sweep, both from
 * `teamPeopleSql`: staff (coaches / team responsibles) are in scope and land
 * with `is_staff = true`, and the training's `excluded_guest_levels` applies.
 *
 * Eligibility per (training, person): NOT in the training's excluded guest
 * levels AND ( effective team training-auto-confirm on OR the person opted in
 * via `members.auto_confirm_trainings` ). Effective team setting =
 * COALESCE(trainings.auto_confirm_rsvp, features_enabled->>'training_auto_confirm',
 * false) — mirrors `effectiveTrainingAutoConfirm()` in kscw-hooks, including
 * the detail that a per-activity `false` suppresses the TEAM default but not a
 * personal opt-in.
 *
 * NOT EXISTS skips manual answers and absence-declines (both are rows), so the
 * sweep never overwrites a choice and is safe to re-run. The targetless
 * `ON CONFLICT DO NOTHING` closes the race against migration 246's partial
 * unique RSVP indexes — targetless on purpose, same reasoning as the game
 * sweep (a named target errors when the index is missing; this form is simply
 * inert on a pre-246 database).
 */
import { teamPeopleSql } from './activity-roster-sql.js'

export async function sweepTrainingAutoConfirm(db, log) {
  try {
    const res = await db.raw(`
      INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff)
      SELECT e.member, 'training', tr.id::text, 'confirmed', '', 0, e.is_staff
      FROM trainings tr
      JOIN teams t ON t.id = tr.team
      JOIN LATERAL ${teamPeopleSql('tr.team')} e ON true
      JOIN members m ON m.id = e.member
      WHERE tr.date::date >= CURRENT_DATE
        AND tr.cancelled = false
        AND (
          COALESCE(tr.auto_confirm_rsvp,
                   NULLIF(t.features_enabled->>'training_auto_confirm', '')::boolean,
                   false) = true
          OR m.auto_confirm_trainings = true
        )
        AND NOT (COALESCE(tr.excluded_guest_levels, '[]')::jsonb @> to_jsonb(e.guest_level))
        AND NOT EXISTS (
          SELECT 1 FROM participations p
          WHERE p.activity_type = 'training' AND p.activity_id = tr.id::text AND p.member = e.member
        )
      ON CONFLICT DO NOTHING
    `)
    const n = res?.rowCount || 0
    if (n > 0) log.info(`[training-auto-confirm-sweep] ${n} participations confirmed`)
    return n
  } catch (err) {
    log.error(`[training-auto-confirm-sweep] ${err.message}`)
    return 0
  }
}
