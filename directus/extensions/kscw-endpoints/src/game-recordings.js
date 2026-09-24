/**
 * Game recordings — video links attached to a game (migration 375).
 *
 *   GET  /kscw/games/:id/recordings          — any logged-in user; ALL links + can_edit
 *   POST /kscw/games/:id/recordings          — coach/TR of the playing team, or admin;
 *                                              replaces the game's full list
 *   GET  /kscw/public/games/:id/recordings   — anonymous; only show_on_website=true
 *                                              (:id = games.id or games.game_id)
 *
 * `show_on_website` is the only thing separating a member-only link from a public
 * one, so the public route selects on it server-side and returns nothing else about
 * the row. The website never sees a member-only URL.
 *
 * Who may edit mirrors the frontend's `canManageTeam`: coach or TR of games.kscw_team,
 * a full admin/superuser, or the sport admin (vb_admin/bb_admin) of the team's sport.
 * (The frontend additionally requires admin mode for the admin half — the server
 * cannot see that toggle, same as every other admin-mode-gated endpoint.)
 */

import { writeUserLog } from './activity-log.js'

const MAX_RECORDINGS = 10
const MAX_URL = 1000
const MAX_TITLE = 120

/** https only — the URL lands in an <a href> on the public site (and the app's
 *  sanitizeUrl() drops anything else, 2026-05-12 audit #16). */
export function normalizeRecordingUrl(raw) {
  const s = String(raw ?? '').trim()
  if (!s || s.length > MAX_URL || /\s/.test(s)) return null
  let u
  try { u = new URL(s) } catch { return null }
  if (u.protocol !== 'https:') return null
  return u.toString()
}

/** Validate a POST body → clean rows, or throw a 400. */
export function parseRecordings(body) {
  const list = Array.isArray(body?.recordings) ? body.recordings : null
  if (!list) throw Object.assign(new Error('recordings must be an array'), { status: 400 })
  if (list.length > MAX_RECORDINGS) {
    throw Object.assign(new Error(`At most ${MAX_RECORDINGS} recordings per game`), { status: 400 })
  }
  return list.map((r, i) => {
    const url = normalizeRecordingUrl(r?.url)
    if (!url) throw Object.assign(new Error(`Invalid URL at position ${i + 1}`), { status: 400, code: 'invalid_url' })
    const title = String(r?.title ?? '').trim().slice(0, MAX_TITLE) || null
    return { url, title, show_on_website: r?.show_on_website === true, sort: i }
  })
}

const gameIdParam = (v) => (/^\d+$/.test(String(v ?? '')) ? Number(v) : null)

export function registerGameRecordings(router, { database, logger }) {
  const log = logger.child({ endpoint: 'game-recordings' })

  async function canEdit(accountability, game) {
    if (accountability?.admin === true) return true
    const userId = accountability?.user
    if (!userId) return false
    const m = await database('members').where('user', userId).first('id', 'role')
    if (!m) return false

    let roles = m.role
    if (typeof roles === 'string') { try { roles = JSON.parse(roles) } catch { roles = [] } }
    roles = Array.isArray(roles) ? roles : []
    if (roles.includes('admin') || roles.includes('superuser')) return true

    const teamId = game.kscw_team != null ? Number(game.kscw_team) : null
    if (teamId == null) return false

    const team = await database('teams').where('id', teamId).first('sport')
    if (team?.sport === 'volleyball' && roles.includes('vb_admin')) return true
    if (team?.sport === 'basketball' && roles.includes('bb_admin')) return true

    const [coach, tr] = await Promise.all([
      database('teams_coaches').where({ teams_id: teamId, members_id: m.id }).first('id'),
      database('teams_responsibles').where({ teams_id: teamId, members_id: m.id }).first('id'),
    ])
    return !!coach || !!tr
  }

  const listFor = (gameId) => database('game_recordings')
    .where('game', gameId)
    .orderBy([{ column: 'sort' }, { column: 'id' }])
    .select('id', 'url', 'title', 'show_on_website', 'created_by_name', 'date_created')

  const fail = (res, err, route) => {
    const status = err?.status || 500
    if (status >= 500) log.error({ msg: `${route} failed: ${err?.message}`, stack: err?.stack })
    res.status(status).json({ error: status >= 500 ? 'Internal error' : err.message, code: err?.code })
  }

  router.get('/games/:id/recordings', async (req, res) => {
    try {
      if (!req.accountability?.user && !req.accountability?.admin) {
        return res.status(401).json({ error: 'Authentication required' })
      }
      const gameId = gameIdParam(req.params.id)
      if (gameId == null) return res.status(400).json({ error: 'Invalid game id' })
      const game = await database('games').where('id', gameId).first('id', 'kscw_team')
      if (!game) return res.status(404).json({ error: 'Game not found' })
      const [data, editable] = await Promise.all([listFor(gameId), canEdit(req.accountability, game)])
      res.json({ data, can_edit: editable })
    } catch (err) { fail(res, err, 'GET recordings') }
  })

  router.post('/games/:id/recordings', async (req, res) => {
    try {
      if (!req.accountability?.user && !req.accountability?.admin) {
        return res.status(401).json({ error: 'Authentication required' })
      }
      const gameId = gameIdParam(req.params.id)
      if (gameId == null) return res.status(400).json({ error: 'Invalid game id' })
      const game = await database('games').where('id', gameId).first('id', 'kscw_team')
      if (!game) return res.status(404).json({ error: 'Game not found' })
      if (!(await canEdit(req.accountability, game))) return res.status(403).json({ error: 'Forbidden' })

      const rows = parseRecordings(req.body)
      const actor = req.accountability?.user
        ? await database('members').where('user', req.accountability.user).first('first_name', 'last_name', 'email')
        : null
      const actorName = actor ? `${actor.first_name ?? ''} ${actor.last_name ?? ''}`.trim() || null : null

      await database.transaction(async (trx) => {
        // Keep the original creator on links that survive the edit (matched by URL).
        const before = await trx('game_recordings').where('game', gameId).select('url', 'created_by_name', 'created_by_email', 'date_created')
        const prev = new Map(before.map((r) => [r.url, r]))
        await trx('game_recordings').where('game', gameId).del()
        if (rows.length) {
          await trx('game_recordings').insert(rows.map((r) => {
            const p = prev.get(r.url)
            return {
              ...r,
              game: gameId,
              created_by_name: p ? p.created_by_name : actorName,
              created_by_email: p ? p.created_by_email : (actor?.email ?? null),
              date_created: p ? p.date_created : new Date(),
              date_updated: new Date(),
            }
          }))
        }
      })

      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'update',
        collection: 'game_recordings',
        recordId: gameId,
        data: { recordings: rows.map(({ url, show_on_website }) => ({ url, show_on_website })) },
      })

      res.json({ data: await listFor(gameId), can_edit: true })
    } catch (err) { fail(res, err, 'POST recordings') }
  })

  // `:id` is either our numeric games.id or the federation key games.game_id
  // (`vb_…` / `bb_…`) — the website's team pages only carry the latter. An intra-club
  // derby is TWO games rows sharing one game_id, so that form returns the public
  // links of both sides.
  router.get('/public/games/:id/recordings', async (req, res) => {
    try {
      const raw = String(req.params.id ?? '')
      let gameIds
      if (gameIdParam(raw) != null) gameIds = [gameIdParam(raw)]
      else if (/^(vb|bb)_[A-Za-z0-9_-]{1,60}$/.test(raw)) gameIds = await database('games').where('game_id', raw).pluck('id')
      else return res.status(400).json({ error: 'Invalid game id' })

      const rows = gameIds.length
        ? await database('game_recordings')
          .whereIn('game', gameIds).where('show_on_website', true)
          .orderBy([{ column: 'game' }, { column: 'sort' }, { column: 'id' }])
          .select('url', 'title')
        : []
      const seen = new Set()
      const data = rows.filter((r) => !seen.has(r.url) && seen.add(r.url))
      res.set('Cache-Control', 'public, max-age=300')
      res.json({ data })
    } catch (err) { fail(res, err, 'GET public recordings') }
  })
}
