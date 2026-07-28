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
 * OWN-TEAM game-day cancel (migration 261, 2026-07-28): a team's own training
 * on a day that team has ANY scheduled game — home or away, hall irrelevant —
 * is cancelled outright (pass 4): the squad is at the game, so the calendar
 * must not advertise a training. Same marker + restore machinery as above
 * (pass 1b's NOT EXISTS gains an own-team arm). Two deliberate softenings:
 *   - notifications only for cancellations within OWN_TEAM_NOTIFY_DAYS; the
 *     far-future bulk (a whole season of game days on the first sweep) is
 *     silenced via the kscw.skip_trainings_notify GUC — members see the
 *     cancelled training on the calendar next to the game, no push storm.
 *   - a manual reinstate is sticky: un-cancelling in the app leaves the
 *     marker in place (no trigger clears auto_shortened_by_game), and pass 4
 *     skips marker-carrying non-shortened rows — that state can only mean "a
 *     human un-cancelled an auto-cancel", so the sweep stops fighting it.
 *     Pass 1c clears the marker again once the marker game stops covering,
 *     re-arming the training for future games.
 *
 * PER-MEMBER game-clash decline (sweepGameClashDeclines, migration 261): a
 * member playing in two teams is auto-declined from team B's training when
 * their other team A has a same-day scheduled game (note "Game <team A>",
 * marker participations.auto_declined_by_game). Mirrors the absence
 * auto-decline machinery: UPDATE flips only never-user-touched rows
 * (last_status_edited_by IS NULL — auto-confirms), INSERT seeds missing rows
 * with the 1970-01-01 waitlisted_at sentinel, unwind DELETEs created rows and
 * reverts overridden ones when the game moves/cancels/vanishes. Members who
 * already declined the game itself are left alone (they're free that evening),
 * and the migration-261 trigger detaches the marker on any manual RSVP flip.
 *
 * UPDATEs fire trg_trainings_notify ('training_updated' / cancellation push);
 * the value-change guards keep re-runs silent.
 */

export const WARMUP_MINUTES = 45
export const MIN_REMAINING_MINUTES = 30
// Own-team game-day cancellations further out than this many days are made
// silently (GUC-suppressed) — the calendar shows them; push is for near-term.
export const OWN_TEAM_NOTIFY_DAYS = 14
// Sentinel stamped on rows the clash-decline INSERT created (vs pre-existing
// rows the UPDATE overrode) — same convention as the absence auto-decline.
const CLASH_CREATED_SENTINEL = '1970-01-01 00:00:00+00'
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
  // A cancelled marker row stays cancelled while EITHER justification holds:
  // the marker game's hall block fully covers it (pass 2), or the marker game
  // is the training team's own same-day game (pass 4). Restore only when
  // neither does — a dangling marker (game deleted) matches neither arm.
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
      AND NOT EXISTS (
        SELECT 1 FROM games g
        WHERE g.id = t.auto_shortened_by_game
          AND g.status = 'scheduled'
          AND g.kscw_team = t.team
          AND g.date = t.date
      )
  `, { warmup: WARMUP_MINUTES, gameMinutes: GAME_MINUTES })

  // ── Pass 1c: clear dangling markers on manually reinstated trainings ──────
  // Un-cancelling in the app leaves the auto_shortened_by_game marker in
  // place (marker + cancelled=false + no original_end_time can arise no other
  // way), and pass 4 treats that signature as "human said the training
  // happens" and stops fighting it. Once the marker game no longer covers the
  // training under either rule, drop the marker so future games can act again.
  await database.raw(`
    WITH ${GAME_BLOCK_CTE}
    UPDATE trainings t
    SET auto_shortened_by_game = NULL
    WHERE t.auto_shortened_by_game IS NOT NULL
      AND t.original_end_time IS NULL
      AND t.cancelled = false
      AND t.date >= CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1 FROM game_block gb
        WHERE gb.game_id = t.auto_shortened_by_game
          AND gb.hall_id = t.hall AND gb.date = t.date
          AND gb.kscw_team IS DISTINCT FROM t.team AND gb.sport = (SELECT sport FROM teams WHERE id = t.team)
      )
      AND NOT EXISTS (
        SELECT 1 FROM games g
        WHERE g.id = t.auto_shortened_by_game
          AND g.status = 'scheduled'
          AND g.kscw_team = t.team
          AND g.date = t.date
      )
  `)

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

  // ── Pass 4: cancel a team's OWN training on its game days ────────────────
  // Any scheduled game of the training's team on the same date — home or
  // away, hall and kickoff time irrelevant (an evening away game empties the
  // slot just as surely; timeless games still mean the squad is playing).
  // Skip the manual-reinstate signature (marker set, not shortened,
  // cancelled=false — see pass 1c). A previously SHORTENED training
  // (original_end_time set) is upgraded to cancelled: its own game outranks
  // another team's hall block. Earliest game of the day wins the marker.
  const ownTeamCancelSql = (dateClause) => `
    WITH own_cover AS (
      SELECT t.id AS training_id,
             (array_agg(g.id ORDER BY g.time ASC NULLS LAST, g.id ASC))[1] AS game_id
      FROM trainings t
      JOIN games g ON g.kscw_team = t.team AND g.date = t.date
      WHERE g.status = 'scheduled'
        AND t.cancelled = false
        AND t.date >= CURRENT_DATE
        AND (t.auto_shortened_by_game IS NULL OR t.original_end_time IS NOT NULL)
        AND ${dateClause}
      GROUP BY t.id
    )
    UPDATE trainings t
    SET cancelled = true,
        auto_shortened_by_game = c.game_id,
        original_end_time = NULL,
        end_time = COALESCE(t.original_end_time, t.end_time)
    FROM own_cover c
    WHERE t.id = c.training_id
  `
  // Near-term cancellations push a notification; the far-future bulk is
  // silenced (transaction-scoped GUC — same silencer slot-cascade uses) so
  // the first sweep over a freshly synced season doesn't blast every team.
  const ownNear = await database.raw(
    ownTeamCancelSql(`t.date < CURRENT_DATE + make_interval(days => :notifyDays)`),
    { notifyDays: OWN_TEAM_NOTIFY_DAYS },
  )
  let ownFarCount = 0
  await database.transaction(async (trx) => {
    await trx.raw("SELECT set_config('kscw.skip_trainings_notify', 'on', true)")
    const ownFar = await trx.raw(
      ownTeamCancelSql(`t.date >= CURRENT_DATE + make_interval(days => :notifyDays)`),
      { notifyDays: OWN_TEAM_NOTIFY_DAYS },
    )
    ownFarCount = ownFar?.rowCount || 0
  })

  const nRestored = restored?.rowCount || 0
  const nUncancelled = uncancelled?.rowCount || 0
  const nCancelled = cancelled?.rowCount || 0
  const nShortened = shortened?.rowCount || 0
  const nOwnCancelled = (ownNear?.rowCount || 0) + ownFarCount
  if (nRestored || nUncancelled || nCancelled || nShortened || nOwnCancelled) {
    log.info(`[game-training-shorten] restored=${nRestored} uncancelled=${nUncancelled} cancelled=${nCancelled} shortened=${nShortened} ownCancelled=${nOwnCancelled}`)
  }
  return { restored: nRestored, uncancelled: nUncancelled, cancelled: nCancelled, shortened: nShortened, ownCancelled: nOwnCancelled }
}

/**
 * Per-member game-clash decline (migration 261). A member who plays in two
 * teams is auto-declined from team B's training when their other team A has a
 * scheduled game the same day — note "Game <team A>", marker
 * participations.auto_declined_by_game.
 *
 * Idempotent, future-only, safe to run nightly and on games/trainings actions.
 * Mirrors the absence auto-decline machinery:
 *   1. UNWIND — marker rows whose game no longer clashes (game gone, moved,
 *      not scheduled, member left the game team) go back: sentinel-created
 *      rows are DELETEd, overridden auto-confirms revert to 'confirmed'.
 *   2. UPDATE — flips only never-user-touched rows (last_status_edited_by IS
 *      NULL — i.e. auto-confirm seeds; the migration-047 filter stamps every
 *      user write). A member who explicitly confirmed the training keeps it —
 *      maybe they're skipping the game — and the migration-261 trigger
 *      detaches the marker on any later manual flip so re-runs never fight it.
 *   3. INSERT — seeds a declined row for clashing members with no RSVP row
 *      at all (teams with auto-confirm off), stamped with the 1970-01-01
 *      waitlisted_at sentinel so the unwind knows to DELETE rather than
 *      revert.
 * Members who already DECLINED the game itself are skipped everywhere except
 * the unwind (they said they're not travelling, so the training stays open to
 * them; an existing auto-decline is theirs to flip back manually). Guests of
 * the game team (guest_level > 0) never count as "playing"; on the training
 * side the per-training excluded_guest_levels are honoured like the absence
 * writers do. Earliest game of the day wins the marker + note.
 */
export async function sweepGameClashDeclines(database, log) {
  // Still-clashing condition for a marker row, used by the unwind.
  const STILL_CLASHES = `
    SELECT 1 FROM games g
    JOIN member_teams mta ON mta.team = g.kscw_team AND mta.member = p.member AND mta.guest_level = 0
    WHERE g.id = p.auto_declined_by_game
      AND g.status = 'scheduled'
      AND g.date = t.date
      AND g.kscw_team IS DISTINCT FROM t.team`

  // ── Pass 1: unwind stale clash-declines ──────────────────────────────────
  const del = await database.raw(`
    DELETE FROM participations p
    USING trainings t
    WHERE p.activity_type = 'training' AND p.activity_id = t.id::text
      AND p.auto_declined_by_game IS NOT NULL
      AND p.waitlisted_at = :sentinel::timestamptz
      AND t.date >= CURRENT_DATE
      AND t.cancelled = false
      AND NOT EXISTS (${STILL_CLASHES})
  `, { sentinel: CLASH_CREATED_SENTINEL })
  const rev = await database.raw(`
    UPDATE participations p
    SET status = 'confirmed', auto_declined_by_game = NULL, note = ''
    FROM trainings t
    WHERE p.activity_type = 'training' AND p.activity_id = t.id::text
      AND p.auto_declined_by_game IS NOT NULL
      AND (p.waitlisted_at IS NULL OR p.waitlisted_at <> :sentinel::timestamptz)
      AND t.date >= CURRENT_DATE
      AND t.cancelled = false
      AND NOT EXISTS (${STILL_CLASHES})
  `, { sentinel: CLASH_CREATED_SENTINEL })

  // ── Pass 2: override auto-confirmed rows for clashing members ────────────
  const upd = await database.raw(`
    WITH clash AS (
      SELECT DISTINCT ON (p.id) p.id, g.id AS game_id, tm.name AS team_name
      FROM participations p
      JOIN trainings t ON p.activity_type = 'training' AND p.activity_id = t.id::text
      JOIN games g ON g.date = t.date AND g.status = 'scheduled'
                  AND g.kscw_team IS NOT NULL AND g.kscw_team IS DISTINCT FROM t.team
      JOIN member_teams mta ON mta.team = g.kscw_team AND mta.member = p.member AND mta.guest_level = 0
      JOIN teams tm ON tm.id = g.kscw_team
      WHERE t.date >= CURRENT_DATE
        AND t.cancelled = false
        AND p.status IN ('confirmed', 'tentative', 'waitlisted')
        AND p.is_staff = false
        AND p.last_status_edited_by IS NULL
        AND p.auto_declined_by IS NULL
        AND p.auto_declined_by_game IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM participations pg
          WHERE pg.activity_type = 'game' AND pg.activity_id = g.id::text
            AND pg.member = p.member AND pg.status = 'declined'
        )
      ORDER BY p.id, g.time ASC NULLS LAST, g.id ASC
    )
    UPDATE participations p
    SET status = 'declined', note = 'Game ' || c.team_name, auto_declined_by_game = c.game_id
    FROM clash c
    WHERE p.id = c.id
  `)

  // ── Pass 3: seed declined rows for clashing members with no RSVP row ─────
  const ins = await database.raw(`
    INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff, auto_declined_by_game, waitlisted_at)
    SELECT DISTINCT ON (mtb.member, t.id)
           mtb.member, 'training', t.id::text, 'declined', 'Game ' || tm.name, 0, false, g.id, :sentinel::timestamptz
    FROM trainings t
    JOIN member_teams mtb ON mtb.team = t.team
    JOIN games g ON g.date = t.date AND g.status = 'scheduled'
                AND g.kscw_team IS NOT NULL AND g.kscw_team IS DISTINCT FROM t.team
    JOIN member_teams mta ON mta.team = g.kscw_team AND mta.member = mtb.member AND mta.guest_level = 0
    JOIN teams tm ON tm.id = g.kscw_team
    WHERE t.date >= CURRENT_DATE
      AND t.cancelled = false
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(t.excluded_guest_levels, '[]'::jsonb)) ex(val)
        WHERE ex.val::int = mtb.guest_level
      )
      AND NOT EXISTS (
        SELECT 1 FROM participations pg
        WHERE pg.activity_type = 'game' AND pg.activity_id = g.id::text
          AND pg.member = mtb.member AND pg.status = 'declined'
      )
      AND NOT EXISTS (
        SELECT 1 FROM participations p
        WHERE p.activity_type = 'training' AND p.activity_id = t.id::text AND p.member = mtb.member
      )
    ORDER BY mtb.member, t.id, g.time ASC NULLS LAST, g.id ASC
    ON CONFLICT DO NOTHING
  `, { sentinel: CLASH_CREATED_SENTINEL })

  const nDeleted = del?.rowCount || 0
  const nReverted = rev?.rowCount || 0
  const nOverridden = upd?.rowCount || 0
  const nSeeded = ins?.rowCount || 0
  if (nDeleted || nReverted || nOverridden || nSeeded) {
    log.info(`[game-clash-decline] deleted=${nDeleted} reverted=${nReverted} overridden=${nOverridden} seeded=${nSeeded}`)
  }
  return { deleted: nDeleted, reverted: nReverted, overridden: nOverridden, seeded: nSeeded }
}
