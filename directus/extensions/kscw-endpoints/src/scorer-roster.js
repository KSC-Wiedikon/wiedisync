/**
 * Home-team roster for the assigned Schreiber (scorer).
 * GET /kscw/scorer/game/:gameId/roster
 *
 * Returns the HOME (playing) team's match sheet — jersey number, last name,
 * first initial, and FULL date of birth for every player, plus the team's
 * coaches, so the scorer can fill the eligibility line-up. This is the ONE
 * sanctioned place that exposes full DoB (including minors): the club's public
 * team API strips under-18 PII in three layers, but the scorer legitimately
 * needs ages at the table. It is therefore triple-gated:
 *   1. caller must be the assigned Schreiber on this game — the SCORER roles
 *      only (scorer / scorer_scoreboard / bb_scorer). The pure Täfeler /
 *      timekeeper / 24s roles do NOT get the roster.
 *   2. now ∈ [kickoff − 40min, kickoff + 3h] — opens once RSVPs are final,
 *      stays for the length of the match.
 *   3. home games only (kscw_team is the home/playing team we have data for).
 * Directus admins bypass 1 + 2 for support. The read is audit-logged
 * (writeUserLog) precisely because it surfaces minor PII — an exception to the
 * "reads need no actor capture" rule.
 *
 * TWO SOURCES, in order:
 *   - `vm`   — the Einsatzliste the team filed in Volleymanager. This is the
 *              legal document the scorer copies onto the match sheet, so it wins
 *              whenever it exists: a nominated player who never RSVP'd still
 *              belongs on the sheet. Teams must close it ~40 min before kickoff,
 *              i.e. as this endpoint's window opens. VM carries no jersey number
 *              and no captain, so those are merged in from `members` by joining
 *              VM's person.associationId to members.license_nr.
 *   - `rsvp` — fallback: confirmed RSVPs for the game (confirmed guests included).
 *              Used for basketball (no VM), for volleyball games whose list is
 *              empty or unfiled, and whenever VM is slow, down or unauthenticated.
 * The chosen source is returned as `source` so the UI can caption the sheet.
 */

import { writeUserLog } from './activity-log.js'
import { fetchHomeNominationList } from './vm-nomination-list.js'

// SCORER roles → assigned-member FK on `games`. Täfeler/timekeeper/24s excluded
// on purpose — they don't fill the match sheet, so they don't get the roster.
const ROSTER_ROLE_COLS = ['scorer_member', 'scorer_scoreboard_member', 'bb_scorer_member']

// Match-sheet window: opens 40 min before kickoff (RSVPs are final by then) and
// stays until ~3h after (covers a full match). Admins bypass it entirely.
const ROSTER_WINDOW_BEFORE_MS = 40 * 60 * 1000
const ROSTER_WINDOW_AFTER_MS = 3 * 60 * 60 * 1000

const dateYMD = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10))

// Offset (localZurich − UTC) in ms at a given UTC instant.
function zurichOffsetMs(instantMs) {
  const p = {}
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
  for (const x of dtf.formatToParts(new Date(instantMs))) p[x.type] = x.value
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - instantMs
}

// Zurich wall-clock (date+time on a game row) → absolute UTC epoch ms.
// Exported: the Einsatzliste cron needs the same kickoff instant, and `games` stores
// date and time as separate DST-naive columns — re-deriving this is how you get a
// job that fires an hour late for half the year.
export function gameStartMs(game) {
  const ymd = dateYMD(game.date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  const [hh, mm] = String(game.time ?? '').split(':')
  if (hh == null || mm == null || hh === '') return null
  const [y, mo, d] = ymd.split('-').map(Number)
  const guess = Date.UTC(y, mo - 1, d, Number(hh), Number(mm))
  const corrected = guess - zurichOffsetMs(guess)
  return guess - zurichOffsetMs(corrected)
}

// Season string ("YYYY/YY") containing a given YYYY-MM-DD — Jun-1 cutover,
// matching dateHelpers.getCurrentSeason() so it lines up with member_teams.season.
function seasonForDate(ymd) {
  const [y, m] = ymd.split('-').map(Number)
  // m is 1-based; Jan–May (m < 6) still belongs to the season that started last year.
  return m < 6 ? `${y - 1}/${String(y).slice(2)}` : `${y}/${String(y + 1).slice(2)}`
}

const firstInitial = (name) => {
  const s = String(name ?? '').trim()
  return s ? s.charAt(0).toUpperCase() + '.' : ''
}

// Jersey 0 is not a legal volleyball number — in `members` it means "never set",
// so render it as blank rather than a column of zeros on the sheet.
const jersey = (n) => (n == null || Number(n) === 0 ? null : Number(n))

// Jersey number descending; unnumbered players (staff, late entries) last.
const byJersey = (a, b) => (b.number == null ? -Infinity : b.number) - (a.number == null ? -Infinity : a.number)

const KSCW_CLUB_ID = '912530'

/**
 * VM game UUID for one of our games — MATCHED BY GAME NUMBER.
 *
 * `games.game_id` is `vb_<SwissVolley gameId>` and `svrz_games.svrz_number` is
 * that same number (the equivalence sv-sync.js already relies on), so the number
 * is the join key — no team-name matching, no UUID guessing. Returns null for
 * basketball (`bb_` prefix, no VM) and for games with no VM fixture.
 */
async function vmGameUuid(database, game) {
  const gid = String(game.game_id ?? '')
  if (!gid.startsWith('vb_')) return null
  const number = Number(gid.slice(3))
  if (!Number.isInteger(number)) return null

  const row = await database('svrz_games')
    .where('svrz_number', number)
    .first('svrz_persistence_id', 'home_club_id')
  if (!row) return null

  // Safety net: VM hands us `nominationListTeamHome`, which is only OUR list if
  // KSCW is actually the home club on that fixture. If a game number ever resolved
  // to someone else's game, this stops us serving an opponent's Einsatzliste.
  if (String(row.home_club_id) !== KSCW_CLUB_ID) return null
  return row.svrz_persistence_id
}

/** Source 1: the Einsatzliste filed in Volleymanager. null → caller falls back to RSVP. */
async function loadVmRoster(database, log, game, captainId) {
  const uuid = await vmGameUuid(database, game)
  if (!uuid) return null
  const nl = await fetchHomeNominationList(uuid, log)
  if (!nl) return null

  // VM has no jersey number and no captain — merge ours in. VM's person.associationId
  // IS members.license_nr (same Swiss Volley licence number), so this is an exact join.
  const licences = nl.players.map((p) => p.license_nr).filter(Boolean)
  const memberRows = licences.length
    ? await database('members').whereIn('license_nr', licences).select('id', 'number', 'license_nr')
    : []
  const byLicence = new Map(memberRows.map((m) => [String(m.license_nr), m]))

  const roster = nl.players
    .map((p) => {
      const m = p.license_nr ? byLicence.get(p.license_nr) : null
      return {
        number: m ? jersey(m.number) : null,
        last_name: p.last_name,
        first_initial: p.first_initial,
        birthdate: p.birthdate,
        is_captain: m != null && captainId != null && Number(m.id) === captainId,
        licence: p.licence,
        eligible: p.eligible,
      }
    })
    .sort(byJersey)

  return { source: 'vm', roster, coaches: nl.coaches, closed_at: nl.closed_at }
}

/** Source 2 (fallback): members who RSVP'd "confirmed" (confirmed guests included). */
async function loadRsvpRoster(database, game, gameId, season, captainId) {
  const confirmedRows = await database('participations')
    .where('activity_type', 'game')
    .where('activity_id', String(gameId))
    .where('status', 'confirmed')
    .select('member')
  const confirmedIds = new Set(confirmedRows.map((r) => Number(r.member)))

  // Full squad for the playing team this season, then keep only the confirmed.
  const rows = await database('member_teams')
    .join('members', 'members.id', 'member_teams.member')
    .where('member_teams.team', game.kscw_team)
    .where('member_teams.season', season)
    .select(
      'members.id as id',
      'members.number as number',
      'members.first_name as first_name',
      'members.last_name as last_name',
      'members.birthdate as birthdate',
    )

  const roster = rows
    .filter((r) => confirmedIds.has(Number(r.id)))
    .map((r) => ({
      number: jersey(r.number),
      last_name: r.last_name || '',
      first_initial: firstInitial(r.first_name),
      birthdate: r.birthdate ? dateYMD(r.birthdate) : null,
      is_captain: captainId != null && Number(r.id) === captainId,
      licence: null,
      eligible: true,
    }))
    .sort(byJersey)

  return { source: 'rsvp', roster, coaches: [], closed_at: null }
}

/** Team coaches from our own DB — the fallback when VM names none. */
async function dbCoaches(database, teamId) {
  const rows = await database('teams_coaches')
    .join('members', 'members.id', 'teams_coaches.members_id')
    .where('teams_coaches.teams_id', teamId)
    .select('members.first_name as first_name', 'members.last_name as last_name', 'members.birthdate as birthdate')
  return rows.map((r) => ({
    last_name: r.last_name || '',
    first_initial: firstInitial(r.first_name),
    birthdate: r.birthdate ? dateYMD(r.birthdate) : null,
  }))
}

export function registerScorerRoster(router, { database, logger }) {
  const log = logger.child({ endpoint: 'scorer-roster' })

  router.get('/scorer/game/:gameId/roster', async (req, res) => {
    try {
      const isAdmin = req.accountability?.admin === true
      const userId = req.accountability?.user
      if (!userId && !isAdmin) {
        return res.status(401).json({ error: 'Authentication required' })
      }

      const gameId = req.params.gameId
      const game = await database('games').where('id', gameId).first('*')
      if (!game) return res.status(404).json({ error: 'Game not found' })

      // Resolve caller → member id (needed for the assignment check + audit).
      const member = userId
        ? await database('members').where('user', userId).first('id')
        : null

      // 1) Assignment: caller must hold a SCORER role on this game.
      const isAssigned = !!member && ROSTER_ROLE_COLS.some(
        (col) => game[col] != null && Number(game[col]) === Number(member.id),
      )
      if (!isAssigned && !isAdmin) {
        return res.status(403).json({ error: 'Not the assigned scorer for this game', code: 'not_scorer' })
      }

      // 2) Time window: ±1h around kickoff. Admins bypass.
      if (!isAdmin) {
        const startMs = gameStartMs(game)
        if (startMs == null) {
          return res.status(403).json({ error: 'Game has no scheduled time', code: 'no_time' })
        }
        const nowMs = Date.now()
        if (nowMs < startMs - ROSTER_WINDOW_BEFORE_MS || nowMs > startMs + ROSTER_WINDOW_AFTER_MS) {
          return res.status(403).json({
            error: 'Roster is only available from 40 minutes before the game until it ends',
            code: 'outside_window',
          })
        }
      }

      // 3) Home games only — kscw_team is the home/playing team whose roster we hold.
      if (game.type !== 'home' || game.kscw_team == null) {
        return res.status(422).json({ error: 'Roster is only available for home games', code: 'not_home' })
      }

      const season = seasonForDate(dateYMD(game.date))

      // Captain (M2O scalar on teams) — flagged with a badge on the sheet.
      const teamRow = await database('teams').where('id', game.kscw_team).first('captain')
      const captainId = teamRow?.captain != null ? Number(teamRow.captain) : null

      // Volleymanager's Einsatzliste is the document the scorer copies, so it wins
      // when it exists; RSVPs stand in whenever it does not (basketball, unfiled
      // list, VM down/slow/unauthenticated).
      const sheet =
        (await loadVmRoster(database, log, game, captainId)) ??
        (await loadRsvpRoster(database, game, gameId, season, captainId))

      // Coaches (staff) — always on the sheet, no RSVP needed. VM names them on the
      // list; fall back to the teams_coaches junction when it does not.
      const coaches = sheet.coaches.length ? sheet.coaches : await dbCoaches(database, game.kscw_team)

      // Audit the sensitive read (who saw which game's roster, how many rows).
      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'read',
        collection: 'games',
        recordId: gameId,
        data: {
          what: 'home_roster',
          team: game.kscw_team,
          season,
          source: sheet.source,
          count: sheet.roster.length,
          coaches: coaches.length,
        },
      })

      res.json({
        data: {
          game: {
            id: game.id,
            home_team: game.home_team,
            away_team: game.away_team,
            date: dateYMD(game.date),
            time: game.time ? String(game.time).slice(0, 5) : null,
          },
          source: sheet.source,
          closed_at: sheet.closed_at,
          roster: sheet.roster,
          coaches,
        },
      })
    } catch (err) {
      log.error({
        msg: `scorer/game/:id/roster: ${err.message}`,
        endpoint: 'scorer/game/:gameId/roster',
        userId: req.accountability?.user || null,
        method: req.method,
        stack: err.stack,
      })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
