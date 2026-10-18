/**
 * WiePlay bridge — login and team data for WiePlay, the club's video-analysis app (separate
 * service at wieplay.kscw.ch; repo KSC-Wiedikon/wieplay, docs/PLAN.md §4). WiePlay was called
 * Nomal until 17.10.2026.
 *
 *   GET /kscw/wieplay/v1/authorize?state=&return=  browser, Wiedisync session → 302 back to
 *                                                  WiePlay with a 60 s, single-use, Ed25519 JWT
 *   GET /kscw/wieplay/v1/teams                     service: every team of the current and the
 *                                                  previous season, metadata only
 *   GET /kscw/wieplay/v1/sync?teams=1,2            service: rosters, games and trainings of the
 *                                                  requested teams only (the WiePlay-enabled ones);
 *                                                  marks those teams in teams.wieplay_enabled
 *   GET /kscw/wieplay/v1/adult-check?team=&date=   service: does every rostered person pass the
 *                                                  adults-only rule on that date? Birthdates
 *                                                  never leave Wiedisync.
 *
 * The pre-rename names (the /kscw/nomal/v1/* routes, aud "nomal", the X-Nomal-Service-Token
 * header and the NOMAL_* env keys) were removed on 18.10.2026, after WiePlay's cutover: they
 * now get 404, 401 and "not configured" like any other unknown route, header or key.
 *
 * Which teams use WiePlay is decided inside WiePlay (by full admins). The only state kept here is
 * its mirror: every /sync call names exactly WiePlay's enabled team rows, and the bridge records
 * them in `teams.wieplay_enabled` (migration 423), which the member app reads to link those
 * teams' games to WiePlay's game page.
 * Service routes need `X-WiePlay-Service-Token` (its SHA-256 must equal WIEPLAY_SYNC_TOKEN_HASH)
 * and answer 404 to anything that came through Cloudflare: WiePlay calls them over the VPS's
 * internal network only. (Not `Authorization: Bearer` — Directus would try to read that as
 * one of its own tokens and refuse the request first.)
 *
 * Env (unset → 503 wieplay_not_configured):
 *   WIEPLAY_JWT_PRIVATE_KEY  Ed25519 private key, PKCS#8 PEM (newlines may be written as \n)
 *   WIEPLAY_JWT_KID          key id, sent in the token header; WiePlay picks the public key by it
 *   WIEPLAY_RETURN_URLS      comma-separated exact callback URLs, e.g.
 *                            https://wieplay.kscw.ch/api/auth/callback
 *   WIEPLAY_SYNC_TOKEN_HASH  hex SHA-256 of the service token WiePlay sends
 *   WIEPLAY_JWT_ISSUER       optional; default wiedisync-prod / wiedisync-dev from PUBLIC_URL
 *   WIEPLAY_LOGIN_URL        optional; where to log in first (default FRONTEND_URL + /login)
 */

import crypto from 'crypto'
import { writeUserLog } from './activity-log.js'
import { currentSeasonShort } from './season.js'
import { FRONTEND_URL } from './email-template.js'

const TOKEN_TTL_SECONDS = 60
const MAX_SYNC_TEAMS = 20
const SPORTS = ['volleyball', 'basketball']

/** Route base under /kscw. */
export const BRIDGE_BASE = '/wieplay/v1'

/** Audience of the login token; WiePlay verifies it. */
export const TOKEN_AUDIENCE = 'wieplay'

/** The only header the service routes read the token from (Express lower-cases names). */
export const SERVICE_TOKEN_HEADER = 'x-wieplay-service-token'

const b64url = (input) => Buffer.from(input).toString('base64url')

/** Compact JWS with EdDSA (Ed25519): header.payload.signature. */
export function signWieplayToken(payload, { privateKeyPem, kid }) {
  const header = { alg: 'EdDSA', typ: 'JWT', kid }
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const signature = crypto.sign(null, Buffer.from(input), crypto.createPrivateKey(privateKeyPem))
  return `${input}.${b64url(signature)}`
}

/** "2026/27" → "2025/26" */
export function previousSeasonShort(season) {
  const y = Number(String(season).slice(0, 4)) - 1
  return `${y}/${String(y + 1).slice(2)}`
}

/** Exact callback URLs; https only, except localhost for development. */
export function parseReturnUrls(raw) {
  const out = new Set()
  for (const part of String(raw ?? '').split(',')) {
    const value = part.trim()
    if (!value) continue
    let url
    try { url = new URL(value) } catch { continue }
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
    if (url.protocol === 'https:' || local) out.add(url.toString())
  }
  return out
}

/** `WIEPLAY_<key>`, trimmed; '' when unset. */
export function wieplayEnv(env, key) {
  return String(env[`WIEPLAY_${key}`] ?? '').trim()
}

export function wieplayConfig(env = process.env) {
  const privateKeyPem = wieplayEnv(env, 'JWT_PRIVATE_KEY').replace(/\\n/g, '\n').trim()
  const publicUrl = String(env.PUBLIC_URL ?? '')
  return {
    privateKeyPem,
    kid: wieplayEnv(env, 'JWT_KID'),
    issuer: wieplayEnv(env, 'JWT_ISSUER')
      || (publicUrl.includes('directus-dev') ? 'wiedisync-dev' : 'wiedisync-prod'),
    returnUrls: parseReturnUrls(wieplayEnv(env, 'RETURN_URLS')),
    syncTokenHash: wieplayEnv(env, 'SYNC_TOKEN_HASH').toLowerCase(),
    loginUrl: wieplayEnv(env, 'LOGIN_URL') || `${FRONTEND_URL}/login`,
    publicUrl,
  }
}

export function serviceTokenOk(provided, expectedHashHex) {
  if (typeof provided !== 'string' || !provided || !/^[0-9a-f]{64}$/.test(expectedHashHex)) return false
  const actual = crypto.createHash('sha256').update(provided).digest()
  return crypto.timingSafeEqual(actual, Buffer.from(expectedHashHex, 'hex'))
}

export function parseStringList(raw) {
  let list = raw
  if (typeof list === 'string') { try { list = JSON.parse(list) } catch { list = [] } }
  return Array.isArray(list) ? list.filter((r) => typeof r === 'string') : []
}

export function sportAdminScopes(roles) {
  const out = []
  if (roles.includes('vb_admin')) out.push('volleyball')
  if (roles.includes('bb_admin')) out.push('basketball')
  return out
}

/** "1,2,3" → [1, 2, 3]; 400 on junk or too many. */
export function parseTeamIds(raw) {
  const parts = String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!parts.length || parts.length > MAX_SYNC_TEAMS || !parts.every((p) => /^\d+$/.test(p))) {
    throw Object.assign(new Error(`teams must be 1–${MAX_SYNC_TEAMS} numeric ids`), { status: 400 })
  }
  return [...new Set(parts.map(Number))]
}

/** pg returns `date` columns as Date objects at local midnight; keep the calendar day. */
export function isoDate(value) {
  if (value == null) return null
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0')
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  const s = String(value)
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

/** "14:00:00" → "14:00" */
export const hhmm = (value) => (value ? String(value).slice(0, 5) : null)

/** sets_json is [{home, away}, …] (see src/utils/gameResult.ts parseSets) → [[home, away], …]. */
export function normalizeSets(json) {
  let value = json
  if (typeof value === 'string') { try { value = JSON.parse(value) } catch { return null } }
  if (!Array.isArray(value)) return null
  const sets = value
    .filter((s) => s && typeof s === 'object' && 'home' in s && 'away' in s)
    .map((s) => [Number(s.home), Number(s.away)])
    .filter(([h, a]) => Number.isFinite(h) && Number.isFinite(a))
  return sets.length ? sets : null
}

/** Adults-only rule (WiePlay PLAN §5.3): a birthdate must exist and be 18+ years before `on`. */
export function adultOn(birthdate, on) {
  const born = isoDate(birthdate)
  if (!born) return { ok: false, reason: 'no_birthdate' }
  const [by, bm, bd] = born.split('-').map(Number)
  const [y, m, d] = on.split('-').map(Number)
  const had18thBirthday = y - by > 18 || (y - by === 18 && (m > bm || (m === bm && d >= bd)))
  return had18thBirthday ? { ok: true, reason: null } : { ok: false, reason: 'under_18' }
}

/**
 * Merge roster rows into one relation entry per team row:
 * [{ team, season, rel: ['player','captain'], guest }]
 */
export function mergeRelations(rows) {
  const byTeam = new Map()
  for (const { team, season, rel, guest } of rows) {
    const entry = byTeam.get(team) ?? { team, season, rel: [], guest: false }
    if (!entry.rel.includes(rel)) entry.rel.push(rel)
    entry.guest = entry.guest || guest === true
    byTeam.set(team, entry)
  }
  return [...byTeam.values()].map((e) => ({ ...e, rel: e.rel.sort() }))
}

/**
 * Roster relations of the given team rows from the raw junction rows: players (guest when
 * guest_level > 0; a member_teams row of another season is ignored), coaches, team
 * responsibles, and the captain.
 */
export function buildRosterRows(teams, players, coaches, responsibles) {
  const seasonOf = new Map(teams.map((t) => [t.id, t.season]))
  const rows = []
  for (const p of players) {
    if (p.season && p.season !== seasonOf.get(p.team)) continue
    rows.push({ team: p.team, member: p.member, rel: 'player', guest: Number(p.guest_level) > 0 })
  }
  for (const c of coaches) rows.push({ team: c.teams_id, member: c.members_id, rel: 'coach' })
  for (const r of responsibles) rows.push({ team: r.teams_id, member: r.members_id, rel: 'team_responsible' })
  for (const t of teams) if (t.captain != null) rows.push({ team: t.id, member: t.captain, rel: 'captain' })
  return rows.filter((r) => r.member != null && seasonOf.has(r.team))
}

const displayName = (m) => `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim()

/** GUC the guard trigger on teams.wieplay_enabled (migration 423) checks; transaction-local. */
export const WIEPLAY_FLAG_GUC = 'kscw.wieplay_enabled_write'

/**
 * teams.wieplay_enabled := (id in `ids`): true for the team rows WiePlay asked for, false for
 * every other row. Only rows whose flag changes are written. The column is endpoint-owned: its
 * trigger keeps every other writer's value, so this runs in a transaction that sets the GUC.
 * Returns the ids switched on and off (sorted).
 */
export async function markWieplayTeams(database, ids) {
  return database.transaction(async (trx) => {
    await trx.raw('SELECT set_config(?, ?, true)', [WIEPLAY_FLAG_GUC, 'on'])
    const on = await trx('teams').whereIn('id', ids).where('wieplay_enabled', false)
      .update({ wieplay_enabled: true }, ['id'])
    const off = await trx('teams').whereNotIn('id', ids).where('wieplay_enabled', true)
      .update({ wieplay_enabled: false }, ['id'])
    const sorted = (rows) => rows.map((r) => Number(r.id ?? r)).sort((a, b) => a - b)
    return { on: sorted(on), off: sorted(off) }
  })
}

export function registerWieplayBridge(router, { database, logger }) {
  const log = logger.child({ endpoint: 'wieplay-bridge' })

  const fail = (res, err, route) => {
    const status = err?.status || 500
    if (status >= 500) log.error({ msg: `${route} failed: ${err?.message}`, stack: err?.stack })
    res.status(status).json({ error: status >= 500 ? 'Internal error' : err.message, code: err?.code })
  }

  const notConfigured = (res) =>
    res.status(503).json({ error: 'WiePlay is not configured', code: 'wieplay_not_configured' })

  async function rosterRows(teams) {
    const ids = teams.map((t) => t.id)
    const [players, coaches, responsibles] = await Promise.all([
      database('member_teams').whereIn('team', ids).select('member', 'team', 'season', 'guest_level'),
      database('teams_coaches').whereIn('teams_id', ids).select('teams_id', 'members_id'),
      database('teams_responsibles').whereIn('teams_id', ids).select('teams_id', 'members_id'),
    ])
    return buildRosterRows(teams, players, coaches, responsibles)
  }

  // ── Browser: login hand-off ────────────────────────────────────────────────
  const authorize = async (req, res) => {
    res.set('Cache-Control', 'no-store')
    res.set('Referrer-Policy', 'no-referrer')
    try {
      const cfg = wieplayConfig()
      if (!cfg.privateKeyPem || !cfg.kid || !cfg.returnUrls.size) return notConfigured(res)

      const state = String(req.query.state ?? '')
      const back = String(req.query.return ?? '')
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(state)) return res.status(400).json({ error: 'Invalid state' })
      if (!cfg.returnUrls.has(back)) return res.status(400).json({ error: 'Return URL not allowed' })

      const userId = req.accountability?.user
      if (!userId) {
        // Not logged in to Wiedisync: log in there first, then come straight back here.
        const self = `${cfg.publicUrl}/kscw${BRIDGE_BASE}/authorize?${new URLSearchParams({ state, return: back })}`
        return res.redirect(302, `${cfg.loginUrl}?${new URLSearchParams({ next: self })}`)
      }

      const member = await database('members').where('user', userId)
        .first('id', 'uuid', 'first_name', 'last_name', 'role')
      if (!member) return res.status(403).json({ error: 'No member profile for this account' })

      const season = currentSeasonShort()
      const teams = await database('teams')
        .whereIn('season', [season, previousSeasonShort(season)])
        .select('id', 'season', 'captain')
      const mine = (await rosterRows(teams)).filter((r) => r.member === member.id)
      const seasonOf = new Map(teams.map((t) => [t.id, t.season]))
      const roles = parseStringList(member.role)
      const now = Math.floor(Date.now() / 1000)
      const token = signWieplayToken({
        iss: cfg.issuer,
        aud: TOKEN_AUDIENCE,
        sub: String(member.uuid),
        mid: member.id,
        name: displayName(member),
        roles,
        sport_admin: sportAdminScopes(roles),
        teams: mergeRelations(mine.map((r) => ({ ...r, season: seasonOf.get(r.team) }))),
        state,
        jti: crypto.randomBytes(18).toString('base64url'),
        iat: now,
        exp: now + TOKEN_TTL_SECONDS,
      }, cfg)

      writeUserLog(database, log, {
        accountability: req.accountability, action: 'wieplay_login', collection: 'members',
        recordId: member.id, data: { to: new URL(back).host },
      }).catch(() => {})
      res.redirect(302, `${back}?${new URLSearchParams({ token, state })}`)
    } catch (err) { fail(res, err, 'GET wieplay/authorize') }
  }

  // ── Service routes (WiePlay API → here, internal network only) ─────────────
  const service = (route, handler) => async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const cfg = wieplayConfig()
    if (!cfg.syncTokenHash) return notConfigured(res)
    if (req.headers['cf-connecting-ip']) return res.status(404).json({ error: 'Not found' })
    if (!serviceTokenOk(req.headers[SERVICE_TOKEN_HEADER], cfg.syncTokenHash)) {
      return res.status(401).json({ error: 'Invalid service token' })
    }
    try { await handler(req, res) } catch (err) { fail(res, err, route) }
  }

  const teamsRoute = async (_req, res) => {
    const season = currentSeasonShort()
    const seasons = [season, previousSeasonShort(season)]
    const rows = await database('teams').whereIn('season', seasons).whereIn('sport', SPORTS)
      .select('id', 'name', 'sport', 'season', 'league', 'team_id', 'active')
      .orderBy([{ column: 'sport' }, { column: 'name' }])
    res.json({
      version: 1,
      seasons,
      teams: rows.map((t) => ({
        id: t.id, name: t.name, sport: t.sport, season: t.season, league: t.league,
        team_key: t.team_id || null, active: t.active === true,
      })),
    })
  }

  const syncRoute = async (req, res) => {
    const ids = parseTeamIds(req.query.teams)
    const teams = await database('teams').whereIn('id', ids).select('id', 'season', 'captain')
    if (teams.length !== ids.length) return res.status(404).json({ error: 'Unknown team id' })

    // Which teams use WiePlay, for the member app's "Video" links. Never fails the sync: on dev
    // the nightly prod clone drops the column until `npm run db:deploy:dev` (as long as prod
    // lacks it), and the flags catch up at the next hourly sync. A service caller has no user
    // to put in user_logs (writeUserLog skips it), so a change is traced in the container log.
    try {
      const changed = await markWieplayTeams(database, ids)
      if (changed.on.length || changed.off.length) {
        log.info(`wieplay sync: teams.wieplay_enabled on [${changed.on.join(',')}] off [${changed.off.join(',')}]`)
      }
    } catch (err) {
      log.warn({ msg: `wieplay sync: teams.wieplay_enabled not updated: ${err?.message}` })
    }

    const roster = await rosterRows(teams)
    const memberIds = [...new Set(roster.map((r) => r.member))]
    const [members, games, trainings] = await Promise.all([
      memberIds.length
        ? database('members').whereIn('id', memberIds)
          .select('id', 'uuid', 'first_name', 'last_name', 'number', 'position', 'kscw_membership_active')
        : [],
      database('games').whereIn('games.kscw_team', ids)
        .leftJoin('halls', 'halls.id', 'games.hall')
        .select('games.id', 'games.kscw_team', 'games.date', 'games.time', 'games.home_team',
          'games.away_team', 'games.type', 'games.league', 'games.status', 'games.home_score',
          'games.away_score', 'games.sets_json', 'games.away_hall_json', 'halls.name as hall'),
      database('trainings').whereIn('trainings.team', ids).where('trainings.cancelled', false)
        .leftJoin('halls', 'halls.id', 'trainings.hall')
        .select('trainings.id', 'trainings.team', 'trainings.date', 'trainings.start_time',
          'trainings.end_time', 'trainings.hall_name', 'halls.name as hall'),
    ])

    log.info(`wieplay sync: teams ${ids.join(',')} → ${members.length} members, ${games.length} games`)
    res.json({
      version: 1,
      members: members.map((m) => ({
        id: m.id,
        uuid: String(m.uuid),
        name: displayName(m),
        number: m.number ?? null,
        positions: parseStringList(m.position),
        active: m.kscw_membership_active !== false,
      })),
      memberships: roster.map((r) => ({ team: r.team, member: r.member, rel: r.rel, guest: r.guest === true })),
      games: games.map((g) => {
        const official = g.status === 'completed'
        const awayHall = typeof g.away_hall_json === 'object' ? g.away_hall_json?.name : null
        return {
          id: g.id,
          team: g.kscw_team,
          date: isoDate(g.date),
          time: hhmm(g.time),
          home_name: g.home_team,
          away_name: g.away_team,
          our_side: g.type === 'home' || g.type === 'away' ? g.type : null,
          league: g.league,
          hall_name: (g.type === 'away' ? awayHall || g.hall : g.hall || awayHall) || null,
          home_score: official ? g.home_score : null,
          away_score: official ? g.away_score : null,
          sets: official ? normalizeSets(g.sets_json) : null,
        }
      }),
      trainings: trainings.map((t) => ({
        id: t.id,
        team: t.team,
        date: isoDate(t.date),
        start_time: hhmm(t.start_time),
        end_time: hhmm(t.end_time),
        hall_name: t.hall || t.hall_name || null,
      })),
    })
  }

  const adultCheckRoute = async (req, res) => {
    const [teamId] = parseTeamIds(req.query.team)
    const on = String(req.query.date ?? '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' })
    const team = await database('teams').where('id', teamId).first('id', 'season', 'captain')
    if (!team) return res.status(404).json({ error: 'Unknown team id' })

    const memberIds = [...new Set((await rosterRows([team])).map((r) => r.member))]
    const birthdays = memberIds.length
      ? await database('members').whereIn('id', memberIds).select('id', 'birthdate')
      : []
    const people = birthdays.map((m) => ({ member: m.id, ...adultOn(m.birthdate, on) }))
    res.json({
      version: 1,
      team: team.id,
      date: on,
      passed: people.length > 0 && people.every((p) => p.ok),
      failing_count: people.filter((p) => !p.ok).length,
      people,
    })
  }

  router.get(`${BRIDGE_BASE}/authorize`, authorize)
  router.get(`${BRIDGE_BASE}/teams`, service('GET wieplay/teams', teamsRoute))
  router.get(`${BRIDGE_BASE}/sync`, service('GET wieplay/sync', syncRoute))
  router.get(`${BRIDGE_BASE}/adult-check`, service('GET wieplay/adult-check', adultCheckRoute))
}
