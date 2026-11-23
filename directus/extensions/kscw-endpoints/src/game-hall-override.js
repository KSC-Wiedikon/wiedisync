/**
 * POST /kscw/games/:id/hall-source — a synced game's hall: "Sync" or "Overwrite"
 * (migration 455, owner 23.11.2026).
 *
 *   { override: true, hall: 12, additional_halls?: [13] }  → Overwrite with this court set
 *   { override: false }                                    → back to Sync: the official
 *                                                            court set applies at once
 *
 * WHO. Full admins (Directus admin_access, members.role admin / superuser) for every
 * game; a sport admin (vb_admin / bb_admin) only for games of their own sport — the
 * same confinement as every other sport-data endpoint (sport-scope.js, M7). Nobody
 * else, and never while acting for a household member.
 *
 * WHAT. Only games whose hall comes from outside the app (VolleyManager via sv-sync,
 * Basketplan via bp-sync), only home fixtures — for an intra-club derby both rows of
 * the fixture carry our hall and both are switched. The write runs with the GUC that
 * lets trg_games_0_hall_override flip the switch; the trigger keeps the official court
 * set in synced_hall / synced_additional_halls and restores it on the way back.
 *
 * AFTER. When the effective court set changed: the game→training sweeps (a home game
 * shortens or cancels trainings in its hall — the effect has to move with the hall)
 * and the push to the shared KWI hall calendar, both at once instead of at night. The
 * calendar push keeps its own KWI-only rule, so KWI → elsewhere removes the entry,
 * elsewhere → KWI creates it, KWI A → KWI C rewrites the title. The duty recheck
 * (451) and the basketball floor claims (351) follow from their own triggers.
 *
 * NEVER pushed to VolleyManager or Basketplan: they stay the official source; the
 * club only overrides locally (vm-push-game.mjs reads the booking's slot, not games).
 *
 * Raw knex bypasses Directus's revision trail, so the actor is recorded twice: on the
 * row (hall_override_by_name / _at, while the override is on) and in user_logs.
 */

import { writeUserLog } from './activity-log.js'
import { callerSportScope, parseRoles, sportOfTeams } from './sport-scope.js'
import { sportScopeAllows } from './member-sport.js'
import { pushHomeGames } from './gcal-push.js'
import { sweepHallBookings } from './hall-bookings.js'
import { sweepGameTrainingShorten, sweepGameClashDeclines } from '../../kscw-hooks/src/game-training-shorten.js'
import { courtSetKey, HALL_OVERRIDE_GUC, SYNCED_GAME_SOURCES } from './hall-override.js'

const MAX_EXTRA_HALLS = 2
// Another calendar push holding the claim may already have read `games` before this
// change: retry in the background until one run starts after it.
const CALENDAR_RETRY_MS = 20_000
const CALENDAR_RETRIES = 6

/**
 * May a caller with these app roles switch the hall of a game of `teamSport`?
 * Pure; exported for tests.
 */
export function canSwitchGameHall(roles, teamSport, { directusAdmin = false } = {}) {
  if (directusAdmin) return true
  const list = parseRoles(roles)
  if (list.includes('admin') || list.includes('superuser')) return true
  if (!list.includes('vb_admin') && !list.includes('bb_admin')) return false
  return sportScopeAllows(callerSportScope(list), sportOfTeams([teamSport]))
}

/**
 * Validate the request body against the known hall ids.
 * → { ok: true, override: false } | { ok: true, override: true, hall, extra } | { ok: false, code, error }
 * Pure; exported for tests.
 */
export function parseHallSourceBody(body, hallIds) {
  const known = new Set((hallIds || []).map(Number))
  const override = body?.override
  if (override !== true && override !== false) {
    return { ok: false, code: 'invalid_override', error: 'override must be true or false' }
  }
  if (override === false) return { ok: true, override: false }
  const hall = Number(body?.hall)
  if (!Number.isInteger(hall) || !known.has(hall)) {
    return { ok: false, code: 'invalid_hall', error: 'Choose a hall' }
  }
  const rawExtra = body?.additional_halls ?? []
  if (!Array.isArray(rawExtra)) return { ok: false, code: 'invalid_hall', error: 'additional_halls must be a list' }
  const asIds = rawExtra.map(Number)
  if (asIds.some((n) => !Number.isInteger(n) || !known.has(n))) {
    return { ok: false, code: 'invalid_hall', error: 'Unknown additional hall' }
  }
  const extra = [...new Set(asIds)].filter((n) => n !== hall).sort((a, b) => a - b)
  if (extra.length > MAX_EXTRA_HALLS) return { ok: false, code: 'invalid_hall', error: 'Too many halls' }
  return { ok: true, override: true, hall, extra }
}

/** Rows of one fixture that carry OUR hall (home row; a derby's away row too). Pure. */
export function rowsCarryingOurHall(rows) {
  return (rows || []).filter((r) => r.type === 'home' || r.hall != null || r.synced_hall != null)
}

/** What the push did for `gameId`, from pushHomeGames' change lists. Pure. */
export function calendarOutcome(push, gameId) {
  if (!push || push.disabled) return 'disabled'
  if (push.alreadyRunning) return 'queued'
  const c = push.changes || {}
  if (c.created?.includes(gameId)) return 'created'
  if (c.updated?.includes(gameId)) return 'updated'
  if (c.deleted?.includes(gameId)) return 'deleted'
  return 'unchanged'
}

const ROW_FIELDS = [
  'id', 'game_id', 'source', 'type', 'kscw_team', 'hall', 'additional_halls',
  'hall_override', 'synced_hall', 'synced_additional_halls', 'hall_override_by_name', 'hall_override_at',
]

export function registerGameHallOverride(router, { database, logger }) {
  const log = logger.child ? logger.child({ extension: 'kscw-endpoints', endpoint: 'games/:id/hall-source' }) : logger

  async function actorName(accountability) {
    const m = await database('members').where('user', accountability.user).first('first_name', 'last_name', 'role')
    if (m) return { name: [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || null, roles: m.role }
    const u = await database('directus_users').where('id', accountability.user).first('first_name', 'last_name', 'email')
    return { name: [u?.first_name, u?.last_name].filter(Boolean).join(' ').trim() || u?.email || null, roles: null }
  }

  async function runSweeps() {
    // Same order as kscw-hooks runGameTrainingSweeps: the game sweep first (its pass
    // 1b can reinstate a training a booking still covers), then bookings, then the
    // per-member clash declines on what is left.
    for (const [name, fn] of [
      ['game-training-shorten', sweepGameTrainingShorten],
      ['hall-bookings', sweepHallBookings],
      ['game-clash-decline', sweepGameClashDeclines],
    ]) {
      try {
        await fn(database, log)
      } catch (err) {
        log.error({ msg: `[hall-source] ${name} sweep failed: ${err.message}`, event: 'hall_source_sweep_failed', stack: err.stack })
      }
    }
  }

  function retryCalendarLater(gameId, attempt = 1) {
    if (attempt > CALENDAR_RETRIES) {
      log.warn({ msg: `[hall-source] calendar push for ${gameId} still busy after ${CALENDAR_RETRIES} tries — the 04:00 run publishes it`, event: 'hall_source_gcal_gave_up' })
      return
    }
    setTimeout(async () => {
      try {
        const push = await pushHomeGames(database, log)
        if (push.alreadyRunning) return retryCalendarLater(gameId, attempt + 1)
        log.info({ msg: `[hall-source] calendar push for ${gameId}: ${calendarOutcome(push, gameId)}${push.dryRun ? ' (dry run)' : ''}`, event: 'hall_source_gcal_retry' })
      } catch (err) {
        log.error({ msg: `[hall-source] calendar push for ${gameId} failed: ${err.message}`, event: 'hall_source_gcal_failed', stack: err.stack })
      }
    }, CALENDAR_RETRY_MS).unref?.()
  }

  async function pushCalendar(gameId) {
    try {
      const push = await pushHomeGames(database, log)
      if (push.alreadyRunning) retryCalendarLater(gameId)
      return {
        outcome: calendarOutcome(push, gameId),
        dryRun: push.dryRun === true,
        created: push.created ?? 0,
        updated: push.updated ?? 0,
        deleted: push.deleted ?? 0,
      }
    } catch (err) {
      log.error({ msg: `[hall-source] calendar push for ${gameId} failed: ${err.message}`, event: 'hall_source_gcal_failed', stack: err.stack })
      return { outcome: 'failed' }
    }
  }

  router.post('/games/:id/hall-source', async (req, res) => {
    try {
      const accountability = req.accountability
      if (!accountability?.user) return res.status(401).json({ error: 'Authentication required' })
      if (accountability.kscwGuardian) {
        return res.status(403).json({ error: 'Not available while using another account', code: 'acting_forbidden' })
      }
      const id = Number(req.params.id)
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid game id' })

      const game = await database('games as g')
        .leftJoin('teams as t', 't.id', 'g.kscw_team')
        .where('g.id', id)
        .first(...ROW_FIELDS.map((f) => `g.${f}`), 't.sport as team_sport')
      if (!game) return res.status(404).json({ error: 'Game not found' })

      const actor = await actorName(accountability)
      if (!canSwitchGameHall(actor.roles, game.team_sport, { directusAdmin: accountability.admin === true })) {
        return res.status(403).json({ error: 'Only admins and the sport admin of this game can change where its hall comes from', code: 'forbidden' })
      }
      if (!SYNCED_GAME_SOURCES.includes(game.source)) {
        return res.status(400).json({ error: 'This game is not synced from Volleymanager or Basketplan — edit its hall directly', code: 'not_synced' })
      }

      const fixture = game.game_id
        ? await database('games').where({ game_id: game.game_id, source: game.source }).select(ROW_FIELDS)
        : [game]
      const rows = rowsCarryingOurHall(fixture)
      if (!rows.some((r) => r.id === game.id)) {
        return res.status(400).json({ error: 'Only a home game has a hall to overwrite', code: 'not_home_game' })
      }

      const hallIds = (await database('halls').select('id')).map((h) => h.id)
      const parsed = parseHallSourceBody(req.body, hallIds)
      if (!parsed.ok) return res.status(400).json({ error: parsed.error, code: parsed.code })

      const before = rows.map((r) => ({ id: r.id, key: courtSetKey(r.hall, r.additional_halls), override: r.hall_override === true }))
      const targetKey = parsed.override ? courtSetKey(parsed.hall, parsed.extra) : null
      const unchanged = parsed.override
        ? before.every((b) => b.override && b.key === targetKey)
        : before.every((b) => !b.override)
      if (unchanged) {
        return res.json({ status: 'ok', unchanged: true, override: parsed.override, games: rows })
      }

      const now = new Date()
      const patch = parsed.override
        ? {
            hall_override: true,
            hall: parsed.hall,
            additional_halls: parsed.extra.length ? JSON.stringify(parsed.extra.map(String)) : null,
            hall_override_by_name: actor.name,
            hall_override_at: now,
            date_updated: now,
          }
        : { hall_override: false, date_updated: now }

      let after = []
      await database.transaction(async (trx) => {
        await trx.raw('SELECT set_config(?, ?, true)', [HALL_OVERRIDE_GUC, 'on'])
        await trx('games').whereIn('id', rows.map((r) => r.id)).update(patch)
        after = await trx('games').whereIn('id', rows.map((r) => r.id)).select(ROW_FIELDS)
      })

      const effectiveChanged = after.some((a) => {
        const b = before.find((x) => x.id === a.id)
        return !b || b.key !== courtSetKey(a.hall, a.additional_halls)
      })

      await writeUserLog(database, log, {
        accountability,
        action: parsed.override ? 'game_hall_override' : 'game_hall_sync',
        collection: 'games',
        recordId: game.id,
        data: {
          game_id: game.game_id,
          rows: after.map((a) => a.id),
          from: before.map((b) => b.key),
          to: after.map((a) => courtSetKey(a.hall, a.additional_halls)),
          synced: after.map((a) => courtSetKey(a.synced_hall, a.synced_additional_halls)),
        },
      })

      let calendar = { outcome: 'unchanged' }
      if (effectiveChanged) {
        await runSweeps()
        calendar = await pushCalendar(game.game_id)
      }

      log.info({
        msg: `[hall-source] ${game.game_id ?? game.id}: ${parsed.override ? 'overwritten' : 'back to sync'} by ${actor.name ?? accountability.user}`
          + ` — ${before.map((b) => b.key || '–').join(',')} → ${after.map((a) => courtSetKey(a.hall, a.additional_halls) || '–').join(',')}`
          + `, calendar ${calendar.outcome}${calendar.dryRun ? ' (dry run)' : ''}`,
        event: 'hall_source_changed',
      })

      res.json({ status: 'ok', unchanged: false, override: parsed.override, effectiveChanged, calendar, games: after })
    } catch (err) {
      log.error({ msg: `hall-source: ${err.message}`, endpoint: 'games/:id/hall-source', userId: req?.accountability?.user || null, method: req?.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
