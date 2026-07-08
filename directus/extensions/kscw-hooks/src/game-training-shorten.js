/**
 * Home-game → training auto-shorten (migration 191).
 *
 * A home game claims its hall from WARMUP_MINUTES before start (same constant
 * as spielplanung's gameBlock.ts) until after any evening training. The
 * training scheduled right before the game used to be called off entirely;
 * club ruling 2026-07-08: keep it, shortened to the warm-up start (e.g. D1
 * home game Mon 19:15 in KWI C → DU23 trains 18:00–18:30, not 18:00–19:30).
 *
 * Two idempotent passes, safe to run nightly and on games.items.* actions:
 *
 *   1. RESTORE — a previously shortened training whose marker game vanished,
 *      moved hall/date, was cancelled/completed, or no longer cuts into the
 *      training's ORIGINAL window gets its original end back. Only future
 *      dates: past trainings are history.
 *   2. SHORTEN — a future non-cancelled training that starts before the
 *      warm-up block of another team's scheduled home game (same hall, same
 *      date) is cut to the earliest such block start. Skipped when the
 *      remainder would be under MIN_REMAINING_MINUTES — a 10-minute training
 *      is not a training; those stay full-length and remain visible as
 *      Hallenplan conflicts for a human to resolve.
 *
 * The playing team's own overlapping training is never touched — the game
 * replaces it naturally (mirrors the same-team skip in the Hallenplan
 * conflict detection).
 *
 * The UPDATEs fire the trg_trainings_notify PG trigger ('training_updated'
 * push to the team) — desired, members must learn the new end time; the
 * value-change guards keep re-runs silent.
 */

export const WARMUP_MINUTES = 45
export const MIN_REMAINING_MINUTES = 30

export async function sweepGameTrainingShorten(database, log) {
  const restored = await database.raw(`
    UPDATE trainings t
    SET end_time = t.original_end_time,
        original_end_time = NULL,
        auto_shortened_by_game = NULL
    WHERE t.auto_shortened_by_game IS NOT NULL
      AND t.original_end_time IS NOT NULL
      AND t.date >= CURRENT_DATE
      AND t.cancelled = false
      AND NOT EXISTS (
        SELECT 1 FROM games g
        WHERE g.id = t.auto_shortened_by_game
          AND g.type = 'home' AND g.status = 'scheduled'
          AND g.hall = t.hall AND g.date = t.date AND g.time IS NOT NULL
          AND g.kscw_team IS DISTINCT FROM t.team
          AND (g.time - make_interval(mins => :warmup)) > t.start_time
          AND (g.time - make_interval(mins => :warmup)) < t.original_end_time
      )
  `, { warmup: WARMUP_MINUTES })

  const shortened = await database.raw(`
    WITH cand AS (
      SELECT t.id AS training_id,
             min(g.time - make_interval(mins => :warmup)) AS new_end,
             (array_agg(g.id ORDER BY g.time ASC))[1] AS game_id
      FROM trainings t
      JOIN games g
        ON g.hall = t.hall AND g.date = t.date
       AND g.type = 'home' AND g.status = 'scheduled' AND g.time IS NOT NULL
       AND g.kscw_team IS DISTINCT FROM t.team
      WHERE t.date >= CURRENT_DATE
        AND t.cancelled = false
        AND (g.time - make_interval(mins => :warmup)) > t.start_time
        AND (g.time - make_interval(mins => :warmup)) < COALESCE(t.original_end_time, t.end_time)
      GROUP BY t.id
    )
    UPDATE trainings t
    SET original_end_time = COALESCE(t.original_end_time, t.end_time),
        end_time = c.new_end,
        auto_shortened_by_game = c.game_id
    FROM cand c
    WHERE t.id = c.training_id
      AND (c.new_end - t.start_time) >= make_interval(mins => :minRemaining)
      AND t.end_time IS DISTINCT FROM c.new_end
  `, { warmup: WARMUP_MINUTES, minRemaining: MIN_REMAINING_MINUTES })

  const nRestored = restored?.rowCount || 0
  const nShortened = shortened?.rowCount || 0
  if (nRestored > 0 || nShortened > 0) {
    log.info(`[game-training-shorten] restored=${nRestored} shortened=${nShortened}`)
  }
  return { restored: nRestored, shortened: nShortened }
}
