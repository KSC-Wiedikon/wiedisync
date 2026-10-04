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
 */

import { writeUserLog } from './activity-log.js'

const httpError = (status, message, code) => Object.assign(new Error(message), { status, code })
const idParam = (v) => (/^\d+$/.test(String(v ?? '')) ? Number(v) : null)
const MAX_NOTE = 300
/** A tournament that left Basketplan's list is hidden after this many days unseen. */
const STALE_DAYS = 3
const ADMIN_ROLES = ['bb_admin', 'admin', 'superuser']

/** 'MixU 8M' and 'mixu8m' are the same league. */
export const leagueKey = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase()

export function zurichToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(now)
}

const ymd = (v) => (v == null ? null : v instanceof Date ? zurichToday(v) : String(v).slice(0, 10))
const hm = (v) => (v == null ? null : String(v).slice(0, 5))

export function parseRoles(raw) {
  if (Array.isArray(raw)) return raw
  if (!raw) return []
  try { const r = JSON.parse(raw); return Array.isArray(r) ? r : [] } catch { return [] }
}

/** Does the team's league appear in the tournament's leagues? */
export function teamFits(team, tournament) {
  const k = leagueKey(team.league)
  return !!k && (tournament.leagues || []).some((l) => leagueKey(l) === k)
}

/**
 * Pick state for one team on one tournament. Pure.
 *   status: registered (Basketplan has it) | picked (wanted, not yet in) | none
 *   canPick: a new pick still makes sense — sign-up open, deadline not past.
 */
export function pickState(team, tournament, pick, today) {
  const registered = (tournament.kscw_bp_team_ids || []).map(String).includes(String(team.bb_source_id))
  const deadline = ymd(tournament.deadline)
  const closed = !tournament.registration_open || (deadline != null && deadline < today)
  return {
    team: Number(team.id),
    status: registered ? 'registered' : pick ? 'picked' : 'none',
    picked: !!pick,
    picked_by_name: pick?.picked_by_name ?? null,
    note: pick?.note ?? null,
    canPick: !closed,
  }
}

/** The page's payload. Pure — unit-tested. */
export function buildOverview(tournaments, teams, picks, today) {
  const pickBy = new Map(picks.map((p) => [`${p.tournament}:${p.team}`, p]))
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
      teams: fits.map((team) => pickState(team, t, pickBy.get(`${t.id}:${team.id}`), today)),
    })
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))
  return rows
}

export function registerBbTournamentPicks(router, { database, logger }) {
  const log = logger.child({ endpoint: 'bb-tournaments' })

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
    return teams.filter((t) => keys.has(leagueKey(t.league)))
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
      const teams = await myTeams(me, await tournamentTeams(tournaments))
      const picks = teams.length
        ? await database('bb_tournament_picks').whereIn('team', teams.map((t) => t.id))
          .whereIn('tournament', tournaments.map((t) => t.id))
          .select('tournament', 'team', 'picked_by_name', 'note')
        : []
      res.json({
        admin: me.admin,
        teams: teams.map((t) => ({ id: Number(t.id), name: t.name, league: t.league })),
        tournaments: teams.length ? buildOverview(tournaments, teams, picks, today) : [],
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
}
