/**
 * Home-game → training auto-shorten / auto-cancel (migration 191; A+B multi-hall
 * + full-cover cancel added 2026-07-09).
 *
 * A home game claims ALL of its halls (primary `hall` + every `additional_halls`
 * entry — e.g. a KWI A+B combo derby occupies both halves) from WARMUP_MINUTES
 * before start. Another team's training that overlaps is:
 *   - SHORTENED to the warm-up start if it begins BEFORE the block cuts in
 *     (club ruling 2026-07-08: keep it, trimmed — e.g. training 18:00–19:30 vs a
 *     20:00 game → 18:00–19:15); or
 *   - CANCELLED if the block starts at/before the training start and the game's
 *     occupation covers the whole training (a training sitting entirely inside
 *     the block — e.g. D1's 19:45–21:30 KWI B training under a 20:00 A+B derby).
 *
 * Four idempotent passes, safe to run nightly and on games.items.* actions:
 *   0. NORMALIZE — repair rotted KWI A/B combos. `additional_halls` should hold
 *      the OTHER half, but a Volleymanager re-sync that rewrites the primary
 *      `hall` can leave it pointing back at the (now primary) hall, collapsing
 *      the combo to a single hall. Any home KWI-A/B game whose additional_halls
 *      redundantly contains its own primary hall is reset to the complementary
 *      half (the app only ever makes A+B combos).
 *   1. RESTORE — a shortened or auto-cancelled training whose marker game
 *      vanished, moved hall(s)/date, was cancelled/completed, or no longer
 *      cuts in gets its original end / active state back. Future dates only.
 *   2. CANCEL — a future non-cancelled training fully inside another team's game
 *      block (any of the game's halls) is cancelled, marked restorable.
 *   3. SHORTEN — a future non-cancelled training that starts before the block
 *      cuts in is trimmed to the block start, unless the remainder would be
 *      under MIN_REMAINING_MINUTES (those stay full-length as Hallenplan
 *      conflicts for a human).
 *
 * The playing team's own overlapping training is never touched — the game
 * replaces it naturally (kscw_team IS DISTINCT FROM t.team).
 *
 * UPDATEs fire trg_trainings_notify ('training_updated' / cancellation push);
 * the value-change guards keep re-runs silent.
 */

export const WARMUP_MINUTES = 45
export const MIN_REMAINING_MINUTES = 30
// Nominal court occupation after a game's start time, for the full-cover cancel
// (warm-up before start is WARMUP_MINUTES). Deliberately modest so a training
// ending well after the game is left as a conflict rather than wrongly cancelled.
export const GAME_MINUTES = 105

// CTE: expand each scheduled home game into one row per hall it blocks (primary
// `hall` ∪ `additional_halls`). additional_halls is a json array of hall ids
// (number- or string-typed across history) → read via jsonb_array_elements_text.
// `sport` (from the playing team) is carried so matching stays SAME-SPORT — a
// volleyball game must never shorten/cancel a basketball training and vice versa,
// even when both share a hall (KWI C hosts both). Games with no team are dropped
// (their sport is unknowable, so they can't be matched).
const GAME_BLOCK_CTE = `
  game_block AS (
    SELECT g.id AS game_id, g.date, g.time, g.kscw_team, tg.sport, hb.hall_id
    FROM games g
    JOIN teams tg ON tg.id = g.kscw_team
    CROSS JOIN LATERAL (
      SELECT g.hall AS hall_id
      UNION
      SELECT e::int AS hall_id
      FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(COALESCE(g.additional_halls::jsonb, 'null'::jsonb)) = 'array'
             THEN g.additional_halls::jsonb ELSE '[]'::jsonb END
      ) AS e
    ) hb
    WHERE g.type = 'home' AND g.status = 'scheduled' AND g.time IS NOT NULL
      AND hb.hall_id IS NOT NULL
  )`

export async function sweepGameTrainingShorten(database, log) {
  // ── Pass 0: normalize rotted KWI A/B combos ──────────────────────────────
  await database.raw(`
    WITH kwi AS (
      SELECT (SELECT id FROM halls WHERE name = 'KWI A') AS a,
             (SELECT id FROM halls WHERE name = 'KWI B') AS b
    )
    UPDATE games g
    SET additional_halls = to_json(ARRAY[ CASE WHEN g.hall = kwi.a THEN kwi.b ELSE kwi.a END ])
    FROM kwi
    WHERE g.type = 'home'
      AND g.hall IN (kwi.a, kwi.b)
      AND g.additional_halls IS NOT NULL
      AND jsonb_typeof(g.additional_halls::jsonb) = 'array'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(g.additional_halls::jsonb) e
        WHERE e = g.hall::text
      )
  `)

  // ── Pass 1a: restore shortened trainings whose game no longer cuts in ─────
  const restored = await database.raw(`
    WITH ${GAME_BLOCK_CTE}
    UPDATE trainings t
    SET end_time = t.original_end_time,
        original_end_time = NULL,
        auto_shortened_by_game = NULL
    WHERE t.auto_shortened_by_game IS NOT NULL
      AND t.original_end_time IS NOT NULL
      AND t.cancelled = false
      AND t.date >= CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1 FROM game_block gb
        WHERE gb.game_id = t.auto_shortened_by_game
          AND gb.hall_id = t.hall AND gb.date = t.date
          AND gb.kscw_team IS DISTINCT FROM t.team AND gb.sport = (SELECT sport FROM teams WHERE id = t.team)
          AND (gb.time - make_interval(mins => :warmup)) > t.start_time
          AND (gb.time - make_interval(mins => :warmup)) < t.original_end_time
      )
  `, { warmup: WARMUP_MINUTES })

  // ── Pass 1b: un-cancel auto-cancelled trainings no longer covered ─────────
  const uncancelled = await database.raw(`
    WITH ${GAME_BLOCK_CTE}
    UPDATE trainings t
    SET cancelled = false,
        auto_shortened_by_game = NULL
    WHERE t.auto_shortened_by_game IS NOT NULL
      AND t.original_end_time IS NULL
      AND t.cancelled = true
      AND t.date >= CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1 FROM game_block gb
        WHERE gb.game_id = t.auto_shortened_by_game
          AND gb.hall_id = t.hall AND gb.date = t.date
          AND gb.kscw_team IS DISTINCT FROM t.team AND gb.sport = (SELECT sport FROM teams WHERE id = t.team)
          AND (gb.time - make_interval(mins => :warmup)) <= t.start_time
          AND (gb.time + make_interval(mins => :gameMinutes)) >= t.end_time
      )
  `, { warmup: WARMUP_MINUTES, gameMinutes: GAME_MINUTES })

  // ── Pass 2: cancel trainings fully inside a game block (any of its halls) ─
  const cancelled = await database.raw(`
    WITH ${GAME_BLOCK_CTE},
    cover AS (
      SELECT t.id AS training_id,
             (array_agg(gb.game_id ORDER BY gb.time ASC))[1] AS game_id
      FROM trainings t
      JOIN game_block gb
        ON gb.hall_id = t.hall AND gb.date = t.date
       AND gb.kscw_team IS DISTINCT FROM t.team AND gb.sport = (SELECT sport FROM teams WHERE id = t.team)
      WHERE t.date >= CURRENT_DATE
        AND t.cancelled = false
        AND (gb.time - make_interval(mins => :warmup)) <= t.start_time
        AND (gb.time + make_interval(mins => :gameMinutes)) >= COALESCE(t.original_end_time, t.end_time)
      GROUP BY t.id
    )
    UPDATE trainings t
    SET cancelled = true,
        auto_shortened_by_game = c.game_id,
        original_end_time = NULL,
        end_time = COALESCE(t.original_end_time, t.end_time)
    FROM cover c
    WHERE t.id = c.training_id
  `, { warmup: WARMUP_MINUTES, gameMinutes: GAME_MINUTES })

  // ── Pass 3: shorten trainings whose start is before the block cuts in ─────
  const shortened = await database.raw(`
    WITH ${GAME_BLOCK_CTE},
    cand AS (
      SELECT t.id AS training_id,
             min(gb.time - make_interval(mins => :warmup)) AS new_end,
             (array_agg(gb.game_id ORDER BY gb.time ASC))[1] AS game_id
      FROM trainings t
      JOIN game_block gb
        ON gb.hall_id = t.hall AND gb.date = t.date
       AND gb.kscw_team IS DISTINCT FROM t.team AND gb.sport = (SELECT sport FROM teams WHERE id = t.team)
      WHERE t.date >= CURRENT_DATE
        AND t.cancelled = false
        AND (gb.time - make_interval(mins => :warmup)) > t.start_time
        AND (gb.time - make_interval(mins => :warmup)) < COALESCE(t.original_end_time, t.end_time)
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
  const nUncancelled = uncancelled?.rowCount || 0
  const nCancelled = cancelled?.rowCount || 0
  const nShortened = shortened?.rowCount || 0
  if (nRestored || nUncancelled || nCancelled || nShortened) {
    log.info(`[game-training-shorten] restored=${nRestored} uncancelled=${nUncancelled} cancelled=${nCancelled} shortened=${nShortened}`)
  }
  return { restored: nRestored, uncancelled: nUncancelled, cancelled: nCancelled, shortened: nShortened }
}
