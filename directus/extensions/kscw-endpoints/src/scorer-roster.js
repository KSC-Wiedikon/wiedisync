/**
 * Home-team roster for the assigned Schreiber (scorer).
 * GET /kscw/scorer/game/:gameId/roster
 *
 * Returns the HOME (playing) team's match sheet — jersey number, last name,
 * first initial, and FULL date of birth for every CONFIRMED player, plus the
 * team's coaches, so the scorer can fill the eligibility line-up. Only players
 * who RSVP'd "confirmed" are listed (the real line-up, not the full squad); the
 * captain is flagged. This is the ONE sanctioned place that exposes full DoB
 * (including minors): the club's public team API strips under-18 PII in three
 * layers, but the scorer legitimately needs ages at the table. It is therefore
 * triple-gated:
 *   1. caller must be the assigned Schreiber on this game — the SCORER roles
 *      only (scorer / scorer_scoreboard / bb_scorer). The pure Täfeler /
 *      timekeeper / 24s roles do NOT get the roster.
 *   2. now ∈ [kickoff − 40min, kickoff + 3h] — opens once RSVPs are final,
 *      stays for the length of the match.
 *   3. home games only (kscw_team is the home/playing team we have data for).
 * Directus admins bypass 1 + 2 for support. The read is audit-logged
 * (writeUserLog) precisely because it surfaces minor PII — an exception to the
 * "reads need no actor capture" rule.
 */

import { writeUserLog } from './activity-log.js'

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
function gameStartMs(game) {
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

      // Who's actually playing: only members who RSVP'd "confirmed" for this game
      // (confirmed guests included — they play too). The match sheet lists the
      // real line-up, not the full squad.
      const confirmedRows = await database('participations')
        .where('activity_type', 'game')
        .where('activity_id', String(gameId))
        .where('status', 'confirmed')
        .select('member')
      const confirmedIds = new Set(confirmedRows.map((r) => Number(r.member)))

      // Captain (M2O scalar on teams) — flagged with a badge on the sheet.
      const teamRow = await database('teams').where('id', game.kscw_team).first('captain')
      const captainId = teamRow?.captain != null ? Number(teamRow.captain) : null

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
          number: r.number ?? null,
          last_name: r.last_name || '',
          first_initial: firstInitial(r.first_name),
          birthdate: r.birthdate ? dateYMD(r.birthdate) : null,
          is_captain: captainId != null && Number(r.id) === captainId,
        }))
        // Jersey number descending; unnumbered players (staff, late entries) last.
        .sort((a, b) => (b.number == null ? -Infinity : b.number) - (a.number == null ? -Infinity : a.number))

      // Coaches (staff) — always on the sheet, no RSVP needed. Read via the
      // teams_coaches junction (teams_id / members_id).
      const coachRows = await database('teams_coaches')
        .join('members', 'members.id', 'teams_coaches.members_id')
        .where('teams_coaches.teams_id', game.kscw_team)
        .select(
          'members.first_name as first_name',
          'members.last_name as last_name',
          'members.birthdate as birthdate',
        )
      const coaches = coachRows.map((r) => ({
        last_name: r.last_name || '',
        first_initial: firstInitial(r.first_name),
        birthdate: r.birthdate ? dateYMD(r.birthdate) : null,
      }))

      // Audit the sensitive read (who saw which game's roster, how many rows).
      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'read',
        collection: 'games',
        recordId: gameId,
        data: { what: 'home_roster', team: game.kscw_team, season, count: roster.length, coaches: coaches.length },
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
          roster,
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
