/**
 * Basketball youth tournaments — coaches pick, the sport admin registers.
 *
 * Youth teams (DU12, HU12, MU10, MU8…) play one-day tournaments hosted by other
 * clubs and published on Basketplan. bp-sync mirrors the list into
 * bb_tournaments (bp-tournaments.js, migration 398). Here a team's coach / TR
 * ticks the tournaments the team should play; a basketball admin sees every
 * team's picks and registers them on Basketplan. No approval step — the club
 * decided the choice is the coach's (04.10.2026).
 *
 * "Registered" is never stored on a pick: it is read from what Basketplan says
 * (bb_tournaments.kscw_bp_team_ids, refreshed daily), so the page cannot claim
 * a registration Basketplan does not have.
 *
 * WHO:
 *   - coach / TR of an active basketball team whose league is a tournament
 *     league → their own teams;
 *   - bb_admin, admin, superuser, admin_access → every tournament team.
 *   Everyone else gets an empty list (the nav entry hides on that).
 *
 * Endpoint-only, like carpools: the tables have no /items grant. Every write
 * calls writeUserLog (raw knex bypasses the items audit hook) and the pick
 * keeps picked_by / picked_by_name.
 *
 * Routes:
 *   GET    /bb-tournaments                     → { admin, teams, tournaments }
 *   POST   /bb-tournaments/:id/picks/:teamId   → pick (body: { note? })
 *   DELETE /bb-tournaments/:id/picks/:teamId   → un-pick
 *   POST   /bb-tournaments/wishes/:teamId      → weekend wish (body: { date }) — migration 400
 *   DELETE /bb-tournaments/wishes/:wishId      → drop a wish (its pick, if any, stays)
 *   POST   /bb-tournaments/teams/:teamId/prefs → { avoid?: string[] } (coach/admin), { hidden?: bool } (admin)
 *   GET    /bb-tournaments/worker              → worker settings + journal (admin)
 *   POST   /bb-tournaments/worker              → mode / opening window (admin)
 *   POST   /admin/bb-register-tick             → per-minute cron (bb-tournament-worker.js)
 */

import { writeUserLog } from './activity-log.js'
import { createBbTournamentWorker, MODES } from './bb-tournament-worker.js'
import { addDays, latestAttempts, leagueKey, teamFits, weekStart, wishState, ymd, zurichToday } from './bb-tournament-wishes.js'

export { leagueKey, teamFits, zurichToday }

const httpError = (status, message, code) => Object.assign(new Error(message), { status, code })
const idParam = (v) => (/^\d+$/.test(String(v ?? '')) ? Number(v) : null)
const MAX_NOTE = 300
/** A tournament that left Basketplan's list is hidden after this many days unseen. */
const STALE_DAYS = 3
const ADMIN_ROLES = ['bb_admin', 'admin', 'superuser']
const MAX_WISHES = 20
const MAX_AVOID = 15
/** Wishes further ahead than this make no sense (one season). */
const WISH_HORIZON_DAYS = 300

const hm = (v) => (v == null ? null : String(v).slice(0, 5))

export function parseRoles(raw) {
  if (Array.isArray(raw)) return raw
  if (!raw) return []
  try { const r = JSON.parse(raw); return Array.isArray(r) ? r : [] } catch { return [] }
}

/**
 * Pick state for one team on one tournament. Pure.
 *   status: registered (Basketplan has it) | picked (wanted, not yet in) | none
 *   canPick: a new pick still makes sense — deadline not past, sign-up not closed.
 */
export function pickState(team, tournament, pick, today, attempt = null) {
  const registered = (tournament.kscw_bp_team_ids || []).map(String).includes(String(team.bb_source_id))
  const deadline = ymd(tournament.deadline)
  // Closed = past the deadline, or Basketplan says so. A tournament listed but
  // not open YET stays pickable — the worker registers it the moment it opens.
  const closed = (deadline != null && deadline < today)
    || (!tournament.registration_open && /abgelaufen|geschlossen|voll/i.test(tournament.list_status || ''))
  return {
    team: Number(team.id),
    status: registered ? 'registered' : pick ? 'picked' : 'none',
    picked: !!pick,
    picked_by_name: pick?.picked_by_name ?? null,
    note: pick?.note ?? null,
    canPick: !closed,
    // Latest registration-worker attempt (migration 399), if any.
    attempt: attempt ? { result: attempt.result, message: attempt.message ?? null, at: attempt.attempted_at ?? null } : null,
  }
}

/** The page's payload. Pure — unit-tested. */
export function buildOverview(tournaments, teams, picks, today, attempts = []) {
  const pickBy = new Map(picks.map((p) => [`${p.tournament}:${p.team}`, p]))
  // attempts arrive newest first; keep the first per pair.
  const attemptBy = new Map()
  for (const a of attempts) {
    const k = `${a.tournament}:${a.team}`
    if (!attemptBy.has(k)) attemptBy.set(k, a)
  }
  const rows = []
  for (const t of tournaments) {
    const fits = teams.filter((team) => teamFits(team, t))
    if (!fits.length) continue
    rows.push({
      id: Number(t.id),
      date: ymd(t.date),
      end_date: ymd(t.end_date),
      host_club: t.host_club,
      hall: t.hall,
      time_from: hm(t.time_from),
      time_to: hm(t.time_to),
      leagues: t.leagues || [],
      deadline: ymd(t.deadline),
      registration_open: !!t.registration_open,
      registered_count: t.registered_count ?? null,
      teams: fits.map((team) => pickState(team, t, pickBy.get(`${t.id}:${team.id}`), today, attemptBy.get(`${t.id}:${team.id}`))),
    })
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))
  return rows
}

/** Each current wish with its state (bb-tournament-wishes.js). Pure. */
export function buildWishes(wishes, teams, tournaments, picks, attempts, today) {
  const teamBy = new Map(teams.map((t) => [Number(t.id), t]))
  const pickBy = new Map(picks.map((p) => [`${p.tournament}:${p.team}`, p]))
  const attemptBy = latestAttempts(attempts)
  const out = []
  for (const w of wishes) {
    const team = teamBy.get(Number(w.team))
    if (!team) continue
    const st = wishState(w, team, tournaments, pickBy, attemptBy, today)
    if (st.state === 'past') continue
    out.push({ id: Number(w.id), team: Number(w.team), week_start: ymd(w.week_start), wished_by_name: w.wished_by_name ?? null, ...st })
  }
  out.sort((a, b) => (a.week_start < b.week_start ? -1 : a.week_start > b.week_start ? 1 : a.team - b.team))
  return out
}

/** Places to avoid from a request body: trimmed, 2–60 chars, unique, at most MAX_AVOID. */
export function cleanAvoid(raw) {
  if (!Array.isArray(raw)) return null
  const out = []
  for (const v of raw) {
    const w = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
    if (w.length >= 2 && !out.some((o) => o.toLowerCase() === w.toLowerCase())) out.push(w)
  }
  return out.slice(0, MAX_AVOID)
}

export function registerBbTournamentPicks(router, { database, logger }) {
  const log = logger.child({ endpoint: 'bb-tournaments' })
  const worker = createBbTournamentWorker({ database, log })
  /** After a pick: try it now rather than at the next 10-minute mark. Best effort. */
  const kick = () => { worker.run({ force: true }).catch((e) => log.warn(`[BB Worker] kick: ${e.message}`)) }

  const fail = (res, err, route) => {
    const status = err?.status || 500
    if (status >= 500) log.error({ msg: `${route} failed: ${err?.message}`, stack: err?.stack })
    res.status(status).json({ error: status >= 500 ? 'Internal error' : err.message, code: err?.code })
  }

  async function caller(req) {
    const userId = req.accountability?.user
    if (!userId && !req.accountability?.admin) throw httpError(401, 'Authentication required')
    const m = userId ? await database('members').where('user', userId).first('id', 'first_name', 'last_name', 'role') : null
    const roles = parseRoles(m?.role)
    return {
      id: m?.id ?? null,
      name: m ? [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || null : null,
      admin: req.accountability?.admin === true || ADMIN_ROLES.some((r) => roles.includes(r)),
    }
  }

  /** Active basketball teams playing tournaments = league seen on a current tournament. */
  async function tournamentTeams(tournaments) {
    const keys = new Set(tournaments.flatMap((t) => (t.leagues || []).map(leagueKey)))
    const teams = await database('teams').where('sport', 'basketball').where('active', true)
      .select('id', 'name', 'league', 'bb_source_id')
    const fit = teams.filter((t) => keys.has(leagueKey(t.league)))
    const prefs = fit.length ? await database('bb_tournament_team_prefs').whereIn('team', fit.map((t) => t.id)).select('team', 'hidden', 'avoid') : []
    const prefBy = new Map(prefs.map((p) => [Number(p.team), p]))
    return fit.map((t) => ({ ...t, hidden: !!prefBy.get(Number(t.id))?.hidden, avoid: prefBy.get(Number(t.id))?.avoid || [] }))
  }

  /** The tournament teams this caller may pick for. */
  async function myTeams(me, teams) {
    if (me.admin) return teams
    if (!me.id) return []
    const ids = teams.map((t) => t.id)
    if (!ids.length) return []
    const [coach, tr] = await Promise.all([
      database('teams_coaches').where('members_id', me.id).whereIn('teams_id', ids).pluck('teams_id'),
      database('teams_responsibles').where('members_id', me.id).whereIn('teams_id', ids).pluck('teams_id'),
    ])
    const mine = new Set([...coach, ...tr].map(Number))
    return teams.filter((t) => mine.has(Number(t.id)))
  }

  async function currentTournaments(today) {
    const seenSince = new Date(Date.now() - STALE_DAYS * 86400000)
    return database('bb_tournaments')
      .where((q) => q.where('date', '>=', today).orWhere('end_date', '>=', today))
      .where('last_seen_at', '>=', seenSince)
      .orderBy('date')
  }

  router.get('/bb-tournaments', async (req, res) => {
    try {
      const me = await caller(req)
      const today = zurichToday()
      const tournaments = await currentTournaments(today)
      const all = await myTeams(me, await tournamentTeams(tournaments))
      // A hidden team (MU8 organises elsewhere) is listed for admins only, to show it again.
      const teams = all.filter((t) => !t.hidden)
      const picks = teams.length
        ? await database('bb_tournament_picks').whereIn('team', teams.map((t) => t.id))
          .whereIn('tournament', tournaments.map((t) => t.id))
          .select('tournament', 'team', 'picked_by_name', 'note')
        : []
      const attempts = teams.length
        ? await database('bb_tournament_registrations').whereIn('team', teams.map((t) => t.id))
          .whereIn('tournament', tournaments.map((t) => t.id))
          .orderBy('attempted_at', 'desc').select('tournament', 'team', 'result', 'message', 'attempted_at')
        : []
      const wishes = teams.length
        ? await database('bb_tournament_wishes').whereIn('team', teams.map((t) => t.id))
          .where('week_start', '>=', addDays(today, -6)).select('id', 'team', 'week_start', 'wished_by_name')
        : []
      const teamPicks = teams.length
        ? await database('bb_tournament_picks').whereIn('team', teams.map((t) => t.id)).select('tournament', 'team')
        : []
      res.json({
        admin: me.admin,
        teams: teams.map((t) => ({ id: Number(t.id), name: t.name, league: t.league, avoid: t.avoid })),
        hidden_teams: me.admin ? all.filter((t) => t.hidden).map((t) => ({ id: Number(t.id), name: t.name })) : [],
        tournaments: teams.length ? buildOverview(tournaments, teams, picks, today, attempts) : [],
        wishes: buildWishes(wishes, teams, tournaments, teamPicks, attempts, today),
      })
    } catch (e) { fail(res, e, 'GET /bb-tournaments') }
  })

  /** Shared guard for both writes: caller may manage the team, team fits the tournament. */
  async function target(req) {
    const me = await caller(req)
    const tid = idParam(req.params.id)
    const teamId = idParam(req.params.teamId)
    if (tid == null || teamId == null) throw httpError(400, 'Invalid id')
    const tournament = await database('bb_tournaments').where('id', tid).first()
    if (!tournament) throw httpError(404, 'Tournament not found')
    const team = await database('teams').where('id', teamId).where('sport', 'basketball').where('active', true)
      .first('id', 'name', 'league', 'bb_source_id')
    if (!team) throw httpError(404, 'Team not found')
    const allowed = await myTeams(me, [team])
    if (!allowed.length) throw httpError(403, 'Only the team\'s coach or team responsible can pick tournaments', 'not_team_lead')
    if (!teamFits(team, tournament)) throw httpError(409, 'This tournament is not for this team\'s age group', 'wrong_league')
    return { me, tournament, team }
  }

  router.post('/bb-tournaments/:id/picks/:teamId', async (req, res) => {
    try {
      const { me, tournament, team } = await target(req)
      const today = zurichToday()
      if (!pickState(team, tournament, null, today).canPick) {
        throw httpError(409, 'Sign-up for this tournament is closed', 'closed')
      }
      const raw = req.body?.note
      const note = raw == null || String(raw).trim() === '' ? null : String(raw).trim().slice(0, MAX_NOTE)
      const now = new Date()
      const [row] = await database('bb_tournament_picks')
        .insert({ tournament: tournament.id, team: team.id, picked_by: me.id, picked_by_name: me.name, note, date_created: now, date_updated: now })
        .onConflict(['tournament', 'team'])
        .merge({ note, date_updated: now })
        .returning(['id'])
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'create', collection: 'bb_tournament_picks',
        recordId: row?.id ?? row, data: { tournament: tournament.id, team: team.id, note },
      })
      kick()
      res.json({ ok: true })
    } catch (e) { fail(res, e, 'POST /bb-tournaments/:id/picks/:teamId') }
  })

  router.delete('/bb-tournaments/:id/picks/:teamId', async (req, res) => {
    try {
      const { tournament, team } = await target(req)
      const row = await database('bb_tournament_picks').where({ tournament: tournament.id, team: team.id }).first('id')
      if (row) {
        await database('bb_tournament_picks').where('id', row.id).del()
        await writeUserLog(database, log, {
          accountability: req.accountability, action: 'delete', collection: 'bb_tournament_picks',
          recordId: row.id, data: { tournament: tournament.id, team: team.id },
        })
      }
      res.json({ ok: true })
    } catch (e) { fail(res, e, 'DELETE /bb-tournaments/:id/picks/:teamId') }
  })

  // ── Weekend wishes + team preferences (migration 400) ─────────────────────

  /** The caller may manage this active basketball team. */
  async function teamTarget(req, teamIdRaw) {
    const me = await caller(req)
    const teamId = idParam(teamIdRaw)
    if (teamId == null) throw httpError(400, 'Invalid id')
    const team = await database('teams').where('id', teamId).where('sport', 'basketball').where('active', true)
      .first('id', 'name', 'league', 'bb_source_id')
    if (!team) throw httpError(404, 'Team not found')
    if (!(await myTeams(me, [team])).length) throw httpError(403, 'Only the team\'s coach or team responsible can do this', 'not_team_lead')
    return { me, team }
  }

  router.post('/bb-tournaments/wishes/:teamId', async (req, res) => {
    try {
      const { me, team } = await teamTarget(req, req.params.teamId)
      const today = zurichToday()
      const week = weekStart(req.body?.date)
      if (!week) throw httpError(400, 'Invalid date')
      if (addDays(week, 6) < today) throw httpError(400, 'This weekend is over', 'past')
      if (week > addDays(today, WISH_HORIZON_DAYS)) throw httpError(400, 'Too far ahead', 'too_far')
      const [{ n }] = await database('bb_tournament_wishes').where('team', team.id).where('week_start', '>=', addDays(today, -6)).count('* as n')
      if (Number(n) >= MAX_WISHES) throw httpError(409, `At most ${MAX_WISHES} weekends per team`, 'too_many')
      const rows = await database('bb_tournament_wishes')
        .insert({ team: team.id, week_start: week, wished_by: me.id, wished_by_name: me.name, date_created: new Date() })
        .onConflict(['team', 'week_start']).ignore()
        .returning('id')
      const id = rows[0]?.id ?? rows[0]
      if (id != null) {
        await writeUserLog(database, log, {
          accountability: req.accountability, action: 'create', collection: 'bb_tournament_wishes',
          recordId: id, data: { team: team.id, week_start: week },
        })
        kick()
      }
      res.json({ ok: true, week_start: week })
    } catch (e) { fail(res, e, 'POST /bb-tournaments/wishes/:teamId') }
  })

  router.delete('/bb-tournaments/wishes/:wishId', async (req, res) => {
    try {
      const wishId = idParam(req.params.wishId)
      if (wishId == null) throw httpError(400, 'Invalid id')
      const wish = await database('bb_tournament_wishes').where('id', wishId).first('id', 'team', 'week_start')
      if (!wish) return res.json({ ok: true })
      await teamTarget(req, wish.team)
      await database('bb_tournament_wishes').where('id', wish.id).del()
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'delete', collection: 'bb_tournament_wishes',
        recordId: wish.id, data: { team: Number(wish.team), week_start: ymd(wish.week_start) },
      })
      res.json({ ok: true })
    } catch (e) { fail(res, e, 'DELETE /bb-tournaments/wishes/:wishId') }
  })

  router.post('/bb-tournaments/teams/:teamId/prefs', async (req, res) => {
    try {
      const { me, team } = await teamTarget(req, req.params.teamId)
      const b = req.body || {}
      const patch = {}
      if (b.avoid !== undefined) {
        const avoid = cleanAvoid(b.avoid)
        if (!avoid) throw httpError(400, 'avoid must be a list')
        patch.avoid = avoid
      }
      if (b.hidden !== undefined) {
        if (!me.admin) throw httpError(403, 'Basketball admins only', 'not_admin')
        patch.hidden = b.hidden === true
      }
      if (!Object.keys(patch).length) throw httpError(400, 'Nothing to change')
      const now = new Date()
      await database('bb_tournament_team_prefs')
        .insert({ team: team.id, ...patch, updated_by_name: me.name, date_updated: now })
        .onConflict('team').merge({ ...patch, updated_by_name: me.name, date_updated: now })
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'update', collection: 'bb_tournament_team_prefs', recordId: team.id, data: patch,
      })
      if (patch.avoid) kick()
      res.json({ ok: true })
    } catch (e) { fail(res, e, 'POST /bb-tournaments/teams/:teamId/prefs') }
  })

  // ── Registration worker (migration 399) ────────────────────────────────────

  async function requireAdmin(req) {
    const me = await caller(req)
    if (!me.admin) throw httpError(403, 'Basketball admins only', 'not_admin')
    return me
  }

  router.get('/bb-tournaments/worker', async (req, res) => {
    try {
      await requireAdmin(req)
      const s = await database('bb_tournament_worker').where('id', 1).first()
      const journal = await database('bb_tournament_registrations as r')
        .join('bb_tournaments as t', 't.id', 'r.tournament')
        .join('teams as tm', 'tm.id', 'r.team')
        .orderBy('r.attempted_at', 'desc').limit(50)
        .select('r.id', 'r.tournament', 'r.team', 'r.mode', 'r.result', 'r.message', 'r.attempted_at',
          't.date as tournament_date', 't.host_club', 'tm.name as team_name')
      res.json({
        mode: s?.mode ?? 'off',
        live_allowed: worker.liveAllowed,
        rush_from: s?.rush_from ?? null,
        rush_until: s?.rush_until ?? null,
        poll_seconds: s?.poll_seconds ?? 30,
        updated_by_name: s?.updated_by_name ?? null,
        date_updated: s?.date_updated ?? null,
        journal: journal.map((j) => ({ ...j, tournament_date: j.tournament_date instanceof Date ? zurichToday(j.tournament_date) : j.tournament_date })),
      })
    } catch (e) { fail(res, e, 'GET /bb-tournaments/worker') }
  })

  router.post('/bb-tournaments/worker', async (req, res) => {
    try {
      const me = await requireAdmin(req)
      const b = req.body || {}
      const patch = {}
      if (b.mode !== undefined) {
        if (!MODES.includes(b.mode)) throw httpError(400, 'Invalid mode')
        patch.mode = b.mode
      }
      if (b.rush_from !== undefined || b.rush_until !== undefined) {
        if (b.rush_from == null || b.rush_until == null) {
          patch.rush_from = null
          patch.rush_until = null
        } else {
          const from = new Date(b.rush_from)
          const until = new Date(b.rush_until)
          if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime()) || until <= from) throw httpError(400, 'Invalid window')
          if (until - from > 3 * 3600000) throw httpError(400, 'The window can be at most 3 hours', 'window_too_long')
          if (until < new Date()) throw httpError(400, 'The window is in the past', 'window_past')
          patch.rush_from = from
          patch.rush_until = until
        }
      }
      if (b.poll_seconds !== undefined) {
        const n = Number(b.poll_seconds)
        if (!Number.isInteger(n) || n < 20 || n > 300) throw httpError(400, 'Poll every 20–300 seconds')
        patch.poll_seconds = n
      }
      if (!Object.keys(patch).length) throw httpError(400, 'Nothing to change')
      await database('bb_tournament_worker').where('id', 1)
        .update({ ...patch, updated_by_name: me.name, date_updated: new Date() })
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'update', collection: 'bb_tournament_worker', recordId: 1, data: patch,
      })
      res.json({ ok: true })
    } catch (e) { fail(res, e, 'POST /bb-tournaments/worker') }
  })

  // Per-minute cron (kscw-hooks). Admin token only.
  router.post('/admin/bb-register-tick', async (req, res) => {
    try {
      if (req.accountability?.admin !== true) throw httpError(403, 'Admin only')
      res.json(await worker.run())
    } catch (e) { fail(res, e, 'POST /admin/bb-register-tick') }
  })
}
