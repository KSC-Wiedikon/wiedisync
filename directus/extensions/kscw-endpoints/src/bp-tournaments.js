/**
 * Basketplan tournaments → games (youth tournament teams: DU12, HU12, MU10, MU8…).
 *
 * These teams play no league. They are signed up (by the club, on Basketplan)
 * for tournaments, and the per-team page bp-sync reads (findTeamById.do) shows
 * nothing until the tournament's own game plan exists — days before, if at
 * all. So a parent saw "no games" for a team that was booked for four
 * Sundays. This sync reads the tournament pages instead: every tournament day
 * a KSCW team is registered for becomes an away `games` row for that team.
 *
 * SOURCE OF TRUTH is Basketplan: a team withdrawn there loses the row on the
 * next run (future days only — history stays). Rows carry source
 * `basketplan_tournament`, game_id `bpt_<tournamentId>_<yyyymmdd>`.
 *
 * Once Basketplan publishes the tournament's real games, bp-sync imports them
 * as ordinary `basketplan` rows; the placeholder for that team and day is then
 * dropped here so the day is not listed twice.
 *
 * ACCESS: the tournament registrations are only visible logged in, with the
 * club's own account (BASKETPLAN_USERNAME / BASKETPLAN_PASSWORD, container env).
 * ⚠ Basketplan withdraws a team with a plain GET link
 * (withdrawTeamFromTournament.do). This module may only request the four
 * read pages in ALLOWED_PATHS — bpFetch refuses anything else, so no parsing
 * slip can ever follow that link.
 *
 * PRIVACY: a tournament page lists every club's coach with e-mail and phone.
 * Only the team ids are extracted; nothing else of those rows is kept or logged.
 */

import { createHash } from 'node:crypto'
import { sweepGameAutoConfirm } from './game-auto-confirm-sweep.js'

const BP_BASE = 'https://www.basketplan.ch'
export const SOURCE = 'basketplan_tournament'
const ALLOWED_PATHS = new Set(['/showLogin.do', '/authenticate.do', '/findAllTournaments.do', '/findTournamentById.do'])
const DETAIL_DELAY_MS = 300

const clean = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const cellsOf = (rowHtml) => [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => clean(m[1]))

/** 'dd.mm.yyyy' or 'dd.mm.yy' → 'yyyy-mm-dd', else null. */
export function bpDate(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/.exec(String(s ?? '').trim())
  if (!m) return null
  const y = m[3].length === 2 ? `20${m[3]}` : m[3]
  return `${y}-${m[2]}-${m[1]}`
}

const hhmm = (s) => (/^\d{2}:\d{2}$/.test(String(s ?? '').trim()) ? String(s).trim() : null)

/** findAllTournaments.do → [{ id, date, club, hall, from, to, status }] (one row per tournament). */
export function parseTournamentList(html) {
  const out = []
  const seen = new Set()
  for (const m of String(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const row = m[1]
    const id = /findTournamentById\.do\?tournamentId=(\d+)/.exec(row)?.[1]
    if (!id || seen.has(id)) continue
    const c = cellsOf(row)
    const date = bpDate(c[0])
    if (!date) continue
    seen.add(id)
    out.push({ id: Number(id), date, club: c[1] || null, hall: c[3] || null, from: hhmm(c[4]), to: hhmm(c[5]), status: c[8] || c[7] || null })
  }
  return out
}

/**
 * findTournamentById.do → { club, deadline, leagues, open, days: [{date, from, to, hall}], teamIds: [bp team id] }.
 * leagues = the "Ligen" table's codes (DU12Tu, MixU10M…); open = the page offers
 * "Anmelden". teamIds come only from the team links of the registrations table.
 */
export function parseTournamentDetail(html) {
  const s = String(html)
  const club = clean(/>\s*Verein\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/.exec(s)?.[1]) || null
  const deadline = bpDate(/name="deadline"[^>]*value="([^"]*)"/.exec(s)?.[1])
  const open = /selectTeamForClubRegistration\.do/.test(s)

  const aStart = s.indexOf('Austragungen')
  const rStart = s.indexOf('<!-- registrations')
  const lStart = s.search(/>\s*Ligen\s*</)
  const leagues = []
  if (lStart !== -1 && aStart > lStart) {
    for (const m of s.slice(lStart, aStart).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const code = cellsOf(m[1])[0]
      if (code && code !== 'Name' && code !== 'Ligen' && !leagues.includes(code)) leagues.push(code)
    }
  }
  const days = []
  if (aStart !== -1) {
    const seg = s.slice(aStart, rStart > aStart ? rStart : undefined)
    for (const m of seg.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const c = cellsOf(m[1])
      const date = bpDate(c[0])
      if (date) days.push({ date, from: hhmm(c[1]), to: hhmm(c[2]), hall: c[3] || null })
    }
  }

  const teamIds = []
  if (rStart !== -1) {
    for (const m of s.slice(rStart).matchAll(/findTeamById\.do\?teamId=(\d+)/g)) {
      const id = String(m[1])
      if (!teamIds.includes(id)) teamIds.push(id)
    }
  }
  return { club, deadline, leagues, open, days, teamIds }
}

const ymdKey = (d) => String(d).replace(/-/g, '')

/**
 * Desired game rows from the parsed tournaments. Pure — unit-tested.
 *   tournaments: [{ id, club, hall, from, to, days, teamIds }]
 *   teamsByBpId: { [bpTeamId]: { id, name, league, season } }
 */
export function planTournamentGames(tournaments, teamsByBpId) {
  const rows = []
  for (const t of tournaments) {
    const ours = t.teamIds.map((bp) => teamsByBpId[bp]).filter(Boolean)
    if (!ours.length) continue
    const days = t.days.length ? t.days : [{ date: t.date, from: t.from, to: t.to, hall: t.hall }]
    for (const d of days) {
      if (!d.date) continue
      for (const team of ours) {
        rows.push({
          game_id: `bpt_${t.id}_${ymdKey(d.date)}`,
          source: SOURCE,
          kscw_team: team.id,
          type: 'away',
          home_team: `Turnier · ${t.club || 'Basketplan'}`,
          away_team: team.name,
          date: d.date,
          time: d.from || t.from || '08:00',
          league: team.league || null,
          season: team.season || null,
          status: 'scheduled',
          // The list names the hall in full ("Kreisschule Mutschellen 1"), the
          // day row often short ("Kreisschule 1"): one-day tournaments take the
          // list's; a multi-day one keeps each day's own hall.
          away_hall_json: JSON.stringify({ name: (days.length === 1 ? t.hall || d.hall : d.hall || t.hall) || '' }),
        })
      }
    }
  }
  return rows
}

/**
 * bb_tournaments rows (migration 398) from the parsed tournaments. Pure.
 * `open` comes from the list's action column ("Anmelden") or, failing that,
 * the detail page's own Anmelden link.
 */
export function planTournamentRows(tournaments, kscwBpIds) {
  const ours = new Set([...kscwBpIds].map(String))
  return tournaments.map((t) => {
    const days = (t.days || []).map((d) => d.date).filter(Boolean).sort()
    return {
      id: t.id,
      date: days[0] || t.date,
      end_date: days.length > 1 ? days[days.length - 1] : null,
      host_club: t.club || null,
      hall: t.hall || t.days?.[0]?.hall || null,
      time_from: t.from || t.days?.[0]?.from || null,
      time_to: t.to || t.days?.[0]?.to || null,
      leagues: t.leagues || [],
      deadline: t.deadline || null,
      registration_open: t.status ? /^Anmelden$/i.test(t.status) : !!t.open,
      registered_count: (t.teamIds || []).length,
      kscw_bp_team_ids: (t.teamIds || []).filter((id) => ours.has(String(id))),
    }
  })
}

/** Upsert the mirror. Tournaments that left the list are kept (picks hang off them). */
async function writeTournamentRows(db, rows) {
  const now = new Date()
  for (const r of rows) {
    await db('bb_tournaments').insert({ ...r, first_seen_at: now, last_seen_at: now })
      .onConflict('id').merge({ ...r, last_seen_at: now })
  }
}

const COMPARE = ['home_team', 'away_team', 'date', 'time', 'league', 'season', 'away_hall_json', 'type']
const norm = (f, v) => {
  if (v == null) return ''
  if (f === 'date') return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)
  if (f === 'time') return String(v).slice(0, 5)
  if (f === 'away_hall_json') return typeof v === 'string' ? v : JSON.stringify(v)
  return String(v)
}

/** A tiny cookie-carrying client restricted to ALLOWED_PATHS. */
export function bpClient(fetchImpl = fetch) {
  let cookie = ''
  const take = (res) => {
    const set = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean)
    for (const c of set) {
      const m = /^(JSESSIONID=[^;]+)/.exec(c)
      if (m) cookie = m[1]
    }
  }
  async function bpFetch(pathAndQuery, init = {}) {
    const url = new URL(pathAndQuery, BP_BASE)
    if (url.origin !== new URL(BP_BASE).origin || !ALLOWED_PATHS.has(url.pathname.replace(/;jsessionid=.*$/i, ''))) {
      throw new Error(`bp-tournaments: refusing ${url.pathname}`)
    }
    const res = await fetchImpl(url.toString(), {
      ...init,
      redirect: 'manual',
      headers: { 'User-Agent': 'KSCW-Sync/1.0', ...(cookie ? { Cookie: cookie } : {}), ...(init.headers || {}) },
    })
    take(res)
    return res
  }
  async function login(username, password) {
    await bpFetch('/showLogin.do')
    const body = new URLSearchParams({
      j_username: username,
      j_password: createHash('md5').update(password).digest('hex'), // Basketplan hashes client-side
      p_password: '',
      deviceFingerprint: '',
    })
    const res = await bpFetch('/authenticate.do', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    const html = await res.text()
    // Success redirects to the club page; a failed login re-renders the form.
    if (res.status >= 400 || /name="j_username"/.test(html)) throw new Error('bp-tournaments: Basketplan login failed')
  }
  async function getHtml(path) {
    const res = await bpFetch(path)
    if (!res.ok) throw new Error(`bp-tournaments: ${path} → ${res.status}`)
    const html = await res.text()
    if (!/Logout/.test(html)) throw new Error('bp-tournaments: not logged in (session lost)')
    return html
  }
  return { login, getHtml }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function syncBpTournaments(db, log, {
  fetchImpl = fetch,
  username = process.env.BASKETPLAN_USERNAME,
  password = process.env.BASKETPLAN_PASSWORD,
  today = new Date().toISOString().slice(0, 10),
  delayMs = DETAIL_DELAY_MS,
} = {}) {
  if (!username || !password) {
    log.warn('[BP Tournaments] BASKETPLAN_USERNAME/PASSWORD not set — skipped')
    return { skipped: 'no_credentials' }
  }

  const teams = await db('teams')
    .where('sport', 'basketball').where('active', true).whereNot('bb_source_id', '')
    .select('id', 'name', 'league', 'season', 'bb_source_id', 'features_enabled')
  const teamsByBpId = Object.fromEntries(teams.map((t) => [String(t.bb_source_id), { ...t, name: `KSC Wiedikon ${t.name}` }]))

  const client = bpClient(fetchImpl)
  await client.login(username, password)
  const list = parseTournamentList(await client.getHtml('/findAllTournaments.do'))

  const tournaments = []
  for (const t of list) {
    try {
      const d = parseTournamentDetail(await client.getHtml(`/findTournamentById.do?tournamentId=${t.id}`))
      tournaments.push({ ...t, club: d.club || t.club, days: d.days, teamIds: d.teamIds, deadline: d.deadline, leagues: d.leagues, open: d.open })
    } catch (e) {
      // One unreadable tournament must not wipe the others' rows: abort before any write.
      throw new Error(`tournament ${t.id}: ${e.message}`)
    }
    if (delayMs) await sleep(delayMs)
  }

  // The picking page's copy (migration 398). Written first: it is harmless on
  // its own, and a failure here must not leave half-updated game rows.
  await writeTournamentRows(db, planTournamentRows(tournaments, Object.keys(teamsByBpId)))

  const desired = planTournamentGames(tournaments, teamsByBpId)

  // A day Basketplan already publishes real games for (bp-sync, source
  // 'basketplan') needs no placeholder.
  const real = await db('games').where('source', 'basketplan').whereIn('kscw_team', teams.map((t) => t.id))
    .where('date', '>=', today).select('kscw_team', 'date')
  const realKeys = new Set(real.map((r) => `${r.kscw_team}:${norm('date', r.date)}`))
  const wanted = desired.filter((r) => !realKeys.has(`${r.kscw_team}:${r.date}`))

  const existing = await db('games').where('source', SOURCE)
    .select('id', 'game_id', 'kscw_team', ...COMPARE)
  const key = (r) => `${r.game_id}:${r.kscw_team}`
  const existingByKey = new Map(existing.map((r) => [key(r), r]))
  const wantedKeys = new Set(wanted.map(key))

  let created = 0, updated = 0, unchanged = 0, removed = 0
  for (const row of wanted) {
    const cur = existingByKey.get(key(row))
    if (cur) {
      if (COMPARE.every((f) => norm(f, cur[f]) === norm(f, row[f]))) { unchanged++; continue }
      await db('games').where('id', cur.id).update({ ...row, date_updated: new Date() })
      updated++
    } else {
      const team = teams.find((t) => t.id === row.kscw_team)
      const fe = typeof team?.features_enabled === 'string' ? JSON.parse(team.features_enabled || '{}') : (team?.features_enabled || {})
      const extra = {}
      if (fe?.game_respond_by_days > 0) {
        extra.respond_by = new Date(Date.parse(`${row.date}T12:00:00Z`) - fe.game_respond_by_days * 86400000).toISOString().slice(0, 10)
      }
      await db('games').insert({ ...row, ...extra, referees_json: '[]', date_created: new Date(), date_updated: new Date() })
      created++
    }
  }
  // Withdrawn on Basketplan, or superseded by the real games: drop future rows only.
  const stale = existing.filter((r) => !wantedKeys.has(key(r)) && norm('date', r.date) >= today)
  if (stale.length) {
    removed = await db('games').whereIn('id', stale.map((r) => r.id)).del()
  }

  log.info(`[BP Tournaments] ${list.length} tournaments, ${desired.length} KSCW days → ${created} created, ${updated} updated, ${unchanged} unchanged, ${removed} removed`)
  if (created > 0) await sweepGameAutoConfirm(db, log)
  return { tournaments: list.length, kscwDays: desired.length, created, updated, unchanged, removed }
}
