/**
 * The duty seats of a game and who may sit on one. Shared by the self-claim
 * (scorer-claim.js) and the questions after a home game moved (duty-recheck.js).
 */

import { gameStartMs } from './scorer-roster.js'
import { teamPeopleSql } from './activity-roster-sql.js'

// role → assignee column, duty-team column, confirmed-by pair, required licence
// (any-of), and whether BB roles fall back to the shared bb_duty_team.
// A higher licence always covers a lower seat (OTN > OTR2 > OTR1): Basketplan
// records only the highest one, so an OTR2 holder often has no otr1_bb flag.
// `lic` is evaluated any-of (`.some()`), so the 24s row lists both OTN levels
// from migration 228: Basketplan distinguishes OTN 1 from OTN 2 and either one
// opens the desk. (The coarse `otn_bb` flag that used to sit beside them was
// dropped by migration 303 — every one of its holders was confirmed OTN 2, so
// nobody lost the claim button.)
export const CLAIM_DEFS = {
  scorer:            { member: 'scorer_member',            duty: 'scorer_duty_team',            name: 'scorer_confirmed_by_name',            at: 'scorer_confirmed_at',            lic: ['scorer_vb'],          bbFallback: false },
  scoreboard:        { member: 'scoreboard_member',        duty: 'scoreboard_duty_team',        name: 'scoreboard_confirmed_by_name',        at: 'scoreboard_confirmed_at',        lic: [],                     bbFallback: false },
  scorer_scoreboard: { member: 'scorer_scoreboard_member', duty: 'scorer_scoreboard_duty_team', name: 'scorer_scoreboard_confirmed_by_name', at: 'scorer_scoreboard_confirmed_at', lic: [],                     bbFallback: false },
  referee:           { member: 'referee_member',           duty: 'referee_duty_team',           name: 'referee_confirmed_by_name',           at: 'referee_confirmed_at',           lic: [],                     bbFallback: false },
  bb_scorer:         { member: 'bb_scorer_member',         duty: 'bb_scorer_duty_team',         name: 'bb_scorer_confirmed_by_name',         at: 'bb_scorer_confirmed_at',         lic: ['otr1_bb', 'otr2_bb', 'otn1_bb', 'otn2_bb'], bbFallback: true },
  bb_timekeeper:     { member: 'bb_timekeeper_member',     duty: 'bb_timekeeper_duty_team',     name: 'bb_timekeeper_confirmed_by_name',     at: 'bb_timekeeper_confirmed_at',     lic: ['otr1_bb', 'otr2_bb', 'otn1_bb', 'otn2_bb'], bbFallback: true },
  bb_24s_official:   { member: 'bb_24s_official',          duty: 'bb_24s_duty_team',            name: 'bb_24s_confirmed_by_name',            at: 'bb_24s_confirmed_at',            lic: ['otr2_bb', 'otn1_bb', 'otn2_bb'], bbFallback: true },
}


/**
 * Teams on duty for one seat. Basketball: the seat's own (legacy) team ∪ every
 * game duty team — bb_duty_team plus bb_extra_duty_teams (migration 371). Twin
 * of bbSeatDutyTeamIds() in src/modules/scorer/lib/bbDutyTeams.ts.
 */
export function seatDutyTeams(game, def) {
  if (!def.bbFallback) return game[def.duty] != null ? [Number(game[def.duty])] : []
  let extra = game.bb_extra_duty_teams
  if (typeof extra === 'string') { try { extra = JSON.parse(extra) } catch { extra = [] } }
  return [...new Set([game[def.duty], game.bb_duty_team, ...(Array.isArray(extra) ? extra : [])]
    .filter((x) => x != null).map(Number))]
}

/** Two duties whose games start less than this apart cannot both be served. */
export const DUTY_CLASH_MS = 2 * 60 * 60 * 1000

/**
 * Does `memberId` already hold a seat that clashes with `game`? Any other seat
 * on the SAME game always clashes (one person, one seat); a seat on another
 * game clashes when both kick-off times are known and lie < DUTY_CLASH_MS
 * apart — back-to-back games two hours apart stay claimable, which basketball
 * duty teams do routinely. `sameDayGames` = games on the same date (any seat).
 */
export function findDutyClash(game, memberId, sameDayGames) {
  const mine = (g) => Object.values(CLAIM_DEFS).some((d) => g[d.member] != null && Number(g[d.member]) === Number(memberId))
  const start = gameStartMs(game)
  for (const g of sameDayGames) {
    if (!mine(g)) continue
    if (String(g.id) === String(game.id)) return g
    const other = gameStartMs(g)
    if (start != null && other != null && Math.abs(start - other) < DUTY_CLASH_MS) return g
  }
  return null
}

/** Every column named in any CLAIM_DEFS.lic: a missing one reads as undefined and denies the seat. */
export const LICENCE_COLS = ['scorer_vb', 'otr1_bb', 'otr2_bb', 'otn1_bb', 'otn2_bb']

export function hasSeatLicence(def, member) {
  return !def.lic.length || def.lic.some((l) => member[l])
}

/** The clash without this game's own seat: for somebody who is on this game already. */
export async function otherDutyClash(database, game, memberId) {
  const sameDay = await database('games')
    .whereRaw('date::date = (SELECT g2.date::date FROM games g2 WHERE g2.id = ?)', [game.id])
    .whereNot('id', game.id)
    .select('id', 'date', 'time', ...Object.values(CLAIM_DEFS).map((d) => d.member))
  return findDutyClash(game, memberId, sameDay)
}

/**
 * A seat is open to every member once its holder refused it after the game moved
 * (migration 451) and while it stays empty. The caller checks that it is empty.
 */
export async function seatOpenToAll(database, gameId, role) {
  const row = await database('duty_rechecks').where({ game: gameId, role, kind: 'ask', status: 'refused' }).first('id')
  return !!row
}

/**
 * Does this member play in this game? Same answer as the season health check
 * `duty_official_plays_this_game`: a confirmed RSVP, a call-up, or the squad and staff of
 * either playing team, unless they said No to the game. An intra-club game has a second row.
 */
export async function playsThisGame(database, game, memberId) {
  const siblings = game.game_id
    ? await database('games').where('game_id', game.game_id).whereNotNull('kscw_team').select('id', 'kscw_team')
    : []
  const rows = [{ id: game.id, kscw_team: game.kscw_team }, ...siblings.filter((g) => Number(g.id) !== Number(game.id))]
  for (const row of rows) {
    const declined = await database('participations')
      .where({ activity_type: 'game', activity_id: String(row.id), member: memberId, status: 'declined' })
      .whereNull('session_id').first('id')
    if (declined) continue
    const rsvp = await database('participations')
      .where({ activity_type: 'game', activity_id: String(row.id), member: memberId, status: 'confirmed' }).first('id')
    if (rsvp) return true
    const guest = await database('game_guests').where({ game: row.id, member: memberId }).first('id')
    if (guest) return true
    if (row.kscw_team != null) {
      const { rows: people } = await database.raw(
        `SELECT 1 FROM ${teamPeopleSql('?')} p WHERE p.member = ? AND p.guest_level = 0 LIMIT 1`,
        [row.kscw_team, row.kscw_team, memberId],
      )
      if (people.length) return true
    }
  }
  return false
}

/**
 * Somebody outside the seat's duty team took it: the duty follows the person, as it does
 * for an accepted delegation, so a no-show fine and the duty count land on their team.
 * Somebody with no active team leaves it where it was.
 */
export async function moveSeatTeam(database, game, role, memberId) {
  const def = CLAIM_DEFS[role]
  for (const team of seatDutyTeams(game, def)) {
    const { rows } = await database.raw(
      `SELECT 1 FROM ${teamPeopleSql('?')} p WHERE p.member = ? AND p.guest_level = 0 LIMIT 1`,
      [team, team, memberId],
    )
    if (rows.length) return
  }
  const sport = game.kscw_team != null
    ? (await database('teams').where('id', game.kscw_team).first('sport'))?.sport ?? null
    : null
  const { rows } = await database.raw(
    `SELECT t.id FROM teams t
      WHERE t.active AND EXISTS (SELECT 1 FROM ${teamPeopleSql('t.id')} p WHERE p.member = ? AND p.guest_level = 0)
      ORDER BY (t.sport IS NOT DISTINCT FROM ?) DESC, t.id LIMIT 1`,
    [memberId, sport],
  )
  if (rows[0]) await database('games').where('id', game.id).update({ [def.duty]: rows[0].id })
}

/** The seat is taken: any request still out for it is void. */
export async function closeSeatInvites(database, gameId, role) {
  await database('duty_rechecks')
    .where({ game: gameId, role, kind: 'invite', status: 'pending' })
    .update({ status: 'superseded' })
}
