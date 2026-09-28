/**
 * "Is this member a participant of this game?" — shared by live scoring
 * (live-scoring.js) and result entry (game-result.js).
 *
 * Both features answer the same question with the same people, so it lives once:
 *   - anyone on the game's sheet: the coach's saved match sheet, else the Einsatzliste
 *     filed in Volleymanager, else confirmed RSVPs — `gameSheetMemberIds`, the SAME
 *     definition the scorer's match sheet uses, so the three cannot drift;
 *   - a coach / TR of the team, or of a team the game was opened to;
 *   - HOME games only: the assigned duty members (Schreiber, Täfeler, both-in-one).
 *     An away game's scorer duty is the opponent's, and our members on it are none.
 * Full Directus admins bypass eligibility AND the time window.
 *
 * The Einsatzliste is read from Volleymanager on the SHARED account, so it is only
 * consulted for someone who could be on it (squadLinked); anyone else is decided from
 * the saved sheet, the confirmed RSVPs, the staff and the duty seats.
 *
 * The window is relative to kickoff: allowed while
 *   start - beforeMs <= now <= start + afterMs.
 * `beforeMs` may be NEGATIVE — result entry passes −3 h, i.e. it opens three hours
 * AFTER kickoff, when the match is certainly over.
 */

import { gameStartMs, gameSheetMemberIds, isTeamLeader, isGuestTeamLeader } from './scorer-roster.js'

// Home-game duty seats. Volleyball only for now; the BB seats are listed so switching
// basketball on later is a sport check, not a hunt for columns.
const DUTY_COLS = ['scorer_member', 'scoreboard_member', 'scorer_scoreboard_member',
  'bb_scorer_member', 'bb_timekeeper_member', 'bb_24s_official']
const ELIGIBLE_TTL_MS = 10 * 60 * 1000
// A refusal is cached too, but briefly: a coach adding someone to the sheet should not
// lock them out for long, and without it every refused poll repeats the whole check.
const NOT_ELIGIBLE_TTL_MS = 2 * 60 * 1000

const DEFAULT_MESSAGES = {
  sport: 'Only volleyball games are supported',
  no_member: 'Only club members can do this',
  outside_window: 'This is not open at this time',
  not_participant: 'Only the players, staff and duty of this game can do this',
}

/**
 * → { game, member, isAdmin } or { status, error, code }.
 *
 * @param {object} opts
 * @param {number} opts.beforeMs  how long before kickoff it opens (negative = after)
 * @param {number} opts.afterMs   how long after kickoff it stays open
 * @param {boolean} [opts.requireVolleyball=true]
 * @param {Map<string, number>} [opts.cache]  `${gameId}:${memberId}` → expiry of a yes
 *   (10 min), `${gameId}:${memberId}:no` → expiry of a no (2 min): the check can read
 *   Volleymanager, and a scorer taps every rally.
 * @param {boolean} [opts.vmOnlyForSquad=true]  consult the VM Einsatzliste only for a
 *   member of the team's squad or a called-up guest of this game (see squadLinked).
 * @param {object} [opts.messages]  per-feature wording of the refusal texts (codes fixed)
 */
export async function authorizeGameParticipant(database, log, req, {
  beforeMs, afterMs, requireVolleyball = true, cache = null, vmOnlyForSquad = true, messages = {},
} = {}) {
  const msg = { ...DEFAULT_MESSAGES, ...messages }
  const isAdmin = req.accountability?.admin === true
  const userId = req.accountability?.user
  if (!userId && !isAdmin) return { status: 401, error: 'Authentication required', code: 'auth' }

  const game = await database('games').where('id', req.params.gameId).first('*')
  if (!game) return { status: 404, error: 'Game not found', code: 'not_found' }
  if (game.kscw_team == null) return { status: 422, error: 'Game has no KSCW team', code: 'no_team' }
  if (requireVolleyball) {
    const team = await database('teams').where('id', game.kscw_team).first('sport')
    if (team?.sport !== 'volleyball') return { status: 422, error: msg.sport, code: 'sport' }
  }
  if (game.status === 'cancelled' || game.status === 'postponed') {
    return { status: 422, error: 'Game is not being played', code: 'not_played' }
  }

  const member = userId ? await database('members').where('user', userId).first('id', 'first_name', 'last_name') : null
  if (isAdmin) return { game, member, isAdmin }
  if (!member) return { status: 403, error: msg.no_member, code: 'no_member' }

  const startMs = gameStartMs(game)
  if (startMs == null) return { status: 403, error: 'Game has no scheduled time', code: 'no_time' }
  const now = Date.now()
  if (now < startMs - beforeMs || now > startMs + afterMs) {
    return { status: 403, error: msg.outside_window, code: 'outside_window' }
  }

  const memberId = Number(member.id)
  const key = `${game.id}:${memberId}`
  const refused = { status: 403, error: msg.not_participant, code: 'not_participant' }
  if (cache && (cache.get(key) ?? 0) > now) return { game, member, isAdmin }
  if (cache && (cache.get(`${key}:no`) ?? 0) > now) return refused

  const onDuty = game.type === 'home' && DUTY_COLS.some((c) => game[c] != null && Number(game[c]) === memberId)
  const ok = onDuty
    || await isTeamLeader(database, memberId, game.kscw_team)
    || await isGuestTeamLeader(database, memberId, game.id)
    || (await gameSheetMemberIds(database, log, game, {
      vm: !vmOnlyForSquad || await squadLinked(database, memberId, game),
    })).has(memberId)
  if (!ok) {
    if (cache) cache.set(`${key}:no`, now + NOT_ELIGIBLE_TTL_MS)
    return refused
  }
  if (cache) cache.set(key, now + ELIGIBLE_TTL_MS)
  return { game, member, isAdmin }
}

/**
 * Could this member be on the game's Einsatzliste at all? A roster row on the playing
 * team (active teams only — an archived season's squad plays nothing now), or a
 * called-up guest of this game. Anyone else — any logged-in member can open any game
 * modal — is decided without a VM login: reading the list takes the SHARED account,
 * and a stranger's modal must not be what holds it while vm_sync or svrz_rc wants it.
 */
export async function squadLinked(database, memberId, game) {
  if (memberId == null || game?.kscw_team == null) return false
  const [rostered, guest] = await Promise.all([
    database('member_teams')
      .join('teams', 'teams.id', 'member_teams.team')
      .where('member_teams.team', game.kscw_team)
      .where('member_teams.member', memberId)
      .where('teams.active', true)
      .first('member_teams.id'),
    database('game_guests').where({ game: game.id, member: memberId }).first('id'),
  ])
  return !!rostered || !!guest
}
