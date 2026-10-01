/**
 * Scorer duty self-claim — POST /kscw/games/:id/duty-claim  { role }
 *
 * Lets a regular MEMBER sign themselves up for an OPEN scorer/Täfeler/referee /
 * BB-official duty on a game their team is on duty for. Regular members have no
 * games.update permission (by design — the items API can't express "set only
 * yourself for your team's open duty": games.*_member holds MEMBER ids while a
 * permission filter only knows the directus-user id). So the sign-up goes
 * through this endpoint, which resolves the caller's member, validates exactly
 * what the frontend `canSelfAssign` checks, and writes via raw knex (bypassing
 * perms) + stamps the confirmed-by pair (the confirm hook only fires on
 * items-API writes). writeUserLog per the CLAUDE.md audit rule.
 *
 * Guards: role open (race-safe via whereNull), caller is an active member IN the
 * role's duty team, holds the required licence. Never lets a member set anyone
 * but themselves, or touch any non-member field.
 *
 * ⚠ "in the duty team" is `teamPeopleSql` (players ∪ coaches ∪ team
 * responsibles), NOT a bare `member_teams` lookup — staff have no roster row.
 */

import { writeUserLog } from './activity-log.js'
import { teamPeopleSql } from './activity-roster-sql.js'
import { gameStartMs } from './scorer-roster.js'
import { sendLocalizedPush } from './push-i18n.js'
import { sendPushToMembers } from './web-push.js'
import { FRONTEND_URL } from './email-template.js'

// role → assignee column, duty-team column, confirmed-by pair, required licence
// (any-of), and whether BB roles fall back to the shared bb_duty_team.
// A higher licence always covers a lower seat (OTN > OTR2 > OTR1): Basketplan
// records only the highest one, so an OTR2 holder often has no otr1_bb flag.
// `lic` is evaluated any-of (`.some()`), so the 24s row lists both OTN levels
// from migration 228: Basketplan distinguishes OTN 1 from OTN 2 and either one
// opens the desk. (The coarse `otn_bb` flag that used to sit beside them was
// dropped by migration 303 — every one of its holders was confirmed OTN 2, so
// nobody lost the claim button.)
const CLAIM_DEFS = {
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
function seatDutyTeams(game, def) {
  if (!def.bbFallback) return game[def.duty] != null ? [Number(game[def.duty])] : []
  let extra = game.bb_extra_duty_teams
  if (typeof extra === 'string') { try { extra = JSON.parse(extra) } catch { extra = [] } }
  return [...new Set([game[def.duty], game.bb_duty_team, ...(Array.isArray(extra) ? extra : [])]
    .filter((x) => x != null).map(Number))]
}

/** Same convention as game-scheduling.js isJuniorTeam: "HU16", "DU18 Fire", "MU10". */
export const isJuniorTeamName = (name) => /u\d/i.test(String(name || ''))

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

export function registerScorerClaim(router, ctx) {
  const { database, logger } = ctx
  const log = logger.child({ endpoint: 'scorer-claim' })

  router.post('/games/:id/duty-claim', async (req, res) => {
    try {
      const userId = req.accountability?.user
      if (!userId) return res.status(401).json({ error: 'Authentication required' })
      // Scorer duty is personal — same rule as scorer-delegation accept/decline
      // (index.js): a main account acting as a linked member must not sign them
      // up for one. Refused before any DB read.
      if (req.accountability?.kscwGuardian) {
        return res.status(403).json({ error: 'Not available while using another account', code: 'acting_forbidden' })
      }

      // Every column named in any CLAIM_DEFS.lic must be selected here — a
      // missing one reads as undefined and silently denies the claim.
      const member = await database('members').where('user', userId)
        .first('id', 'first_name', 'last_name', 'kscw_membership_active', 'scorer_vb', 'otr1_bb', 'otr2_bb', 'otn1_bb', 'otn2_bb')
      if (!member || !member.kscw_membership_active) return res.status(403).json({ error: 'Not an active member' })

      const role = String(req.body?.role || '')
      const def = CLAIM_DEFS[role]
      if (!def) return res.status(400).json({ error: 'Invalid role' })

      const game = await database('games').where('id', req.params.id).first()
      if (!game) return res.status(404).json({ error: 'Game not found' })
      if (game[def.member] != null) return res.status(409).json({ error: 'Role already taken' })
      // No signing up for a game that has already started (the UI hides past
      // games and the button after kickoff; this closes the direct POST).
      const startMs = gameStartMs(game)
      if (startMs != null && startMs <= Date.now()) return res.status(409).json({ error: 'Game has already started' })

      if (def.lic.length && !def.lic.some((l) => member[l])) {
        return res.status(403).json({ error: 'Missing licence for this role' })
      }

      const dutyTeams = seatDutyTeams(game, def)
      if (!dutyTeams.length) return res.status(409).json({ error: 'No duty team assigned for this role' })
      // `teamPeopleSql`, not a bare `member_teams` join — coaches and team
      // responsibles have no roster row, so the bare join denied a staff-only
      // coach their OWN team's duty (the frontend claim button was equally
      // blind; both now union the staff junctions).
      // ⚠ teamPeopleSql interpolates its team expression TWICE (roster branch +
      // staff branch) — hence the duplicated binding.
      let inTeam = false
      for (const dutyTeam of dutyTeams) {
        const { rows } = await database.raw(
          `SELECT 1 FROM ${teamPeopleSql('?')} p WHERE p.member = ? LIMIT 1`,
          [dutyTeam, dutyTeam, member.id],
        )
        if (rows.length) { inTeam = true; break }
      }
      if (!inTeam) return res.status(403).json({ error: 'You are not in the duty team for this role' })

      // One person cannot sit two tables at once (Anja, 01.10.2026: two
      // timekeeper seats on overlapping games, both accepted).
      // Date compared in SQL — a JS Date round-trip can shift it across midnight.
      const sameDay = await database('games')
        .whereRaw('date::date = (SELECT g2.date::date FROM games g2 WHERE g2.id = ?)', [game.id])
        .select('id', 'date', 'time', ...Object.values(CLAIM_DEFS).map((d) => d.member))
      const clash = findDutyClash(game, member.id, sameDay)
      if (clash) {
        return res.status(409).json({ error: 'You already have a duty at that time', code: 'duty_clash', game: clash.id })
      }

      const now = new Date().toISOString()
      const fullName = [member.first_name, member.last_name].filter(Boolean).join(' ').trim() || null
      // Race-safe: only claim if still open (whereNull). affected=0 → someone beat us.
      const affected = await database('games').where('id', game.id).whereNull(def.member)
        .update({ [def.member]: member.id, [def.name]: fullName, [def.at]: now })
      if (!affected) return res.status(409).json({ error: 'Role already taken' })

      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'duty-claim',
        collection: 'games', recordId: game.id, data: { role, member: member.id },
      })
      res.json({ ok: true, member: member.id, confirmed_by_name: fullName, confirmed_at: now })
    } catch (err) {
      log.error({ msg: `duty-claim: ${err?.message}`, stack: err?.stack, userId: req.accountability?.user || null })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  /**
   * POST /kscw/games/:id/duty-assign  { role, member }  — BASKETBALL JUNIORS ONLY.
   *
   * The coach / team responsible of a JUNIOR basketball team that is on duty
   * for this game puts one of the team's licensed players on an open table
   * seat — at once, no acceptance step (HU16 request, 01.10.2026: the juniors
   * do not answer delegations, the TR organises the table anyway). `member:
   * null` clears a seat held by one of that team's players (wrong kid picked).
   * Everything else keeps the self-claim / delegation-accept path.
   *
   * Guards: BB seat only; caller is staff (teams_coaches / teams_responsibles)
   * of an ACTIVE junior BB team in the seat's duty pool; target is an active
   * core player (guest_level 0) of that same team with the seat's licence and no
   * clashing duty; a seat held by anyone else is never touched. Actor captured
   * in confirmed_by_* + user_logs.
   */
  router.post('/games/:id/duty-assign', async (req, res) => {
    try {
      const userId = req.accountability?.user
      if (!userId) return res.status(401).json({ error: 'Authentication required' })
      if (req.accountability?.kscwGuardian) {
        return res.status(403).json({ error: 'Not available while using another account', code: 'acting_forbidden' })
      }
      const role = String(req.body?.role || '')
      const def = CLAIM_DEFS[role]
      if (!def || !def.bbFallback) return res.status(400).json({ error: 'Invalid role' })
      const rawTarget = req.body?.member
      const targetId = rawTarget == null || rawTarget === '' ? null : Number(rawTarget)
      if (targetId !== null && !Number.isInteger(targetId)) return res.status(400).json({ error: 'Invalid member' })

      const actor = await database('members').where('user', userId).first('id', 'first_name', 'last_name')
      if (!actor) return res.status(403).json({ error: 'Not a member' })

      const game = await database('games').where('id', req.params.id).first()
      if (!game) return res.status(404).json({ error: 'Game not found' })
      const startMs = gameStartMs(game)
      if (startMs != null && startMs <= Date.now()) return res.status(409).json({ error: 'Game has already started' })

      // The junior BB team(s) in this seat's pool that the caller coaches / is TR of.
      const pool = seatDutyTeams(game, def)
      const staffTeams = pool.length
        ? await database('teams as t')
          .whereIn('t.id', pool).where('t.active', true).where('t.sport', 'basketball')
          .where((qb) => qb
            .whereExists(database('teams_coaches').whereRaw('teams_coaches.teams_id = t.id').where('members_id', actor.id))
            .orWhereExists(database('teams_responsibles').whereRaw('teams_responsibles.teams_id = t.id').where('members_id', actor.id)))
          .select('t.id', 't.name')
        : []
      const myTeams = staffTeams.filter((t) => isJuniorTeamName(t.name)).map((t) => Number(t.id))
      if (!myTeams.length) return res.status(403).json({ error: 'Only the coach or team responsible of a junior team on duty', code: 'not_junior_staff' })

      const corePlayerOf = async (memberId) => {
        const row = await database('member_teams').whereIn('team', myTeams).where('member', memberId)
          .where((qb) => qb.whereNull('guest_level').orWhere('guest_level', 0)).first('team')
        return row ? Number(row.team) : null
      }

      // A seat held by someone who is not one of these players stays untouched.
      const current = game[def.member]
      if (current != null && (await corePlayerOf(current)) == null) {
        return res.status(409).json({ error: 'Role already taken', code: 'seat_taken' })
      }

      if (targetId === null) {
        if (current == null) return res.json({ ok: true })
        const n = await database('games').where('id', game.id).where(def.member, current)
          .update({ [def.member]: null, [def.name]: null, [def.at]: null })
        if (!n) return res.status(409).json({ error: 'Seat changed meanwhile', code: 'seat_taken' })
        await writeUserLog(database, log, {
          accountability: req.accountability, action: 'duty-unassign',
          collection: 'games', recordId: game.id, data: { role, member: current, by: actor.id },
        })
        return res.json({ ok: true, member: null })
      }

      if (current != null && Number(current) === targetId) return res.json({ ok: true, member: targetId })

      const target = await database('members').where('id', targetId)
        .first('id', 'first_name', 'kscw_membership_active', 'otr1_bb', 'otr2_bb', 'otn1_bb', 'otn2_bb')
      if (!target || !target.kscw_membership_active) return res.status(400).json({ error: 'Not an active member', code: 'invalid_target' })
      const team = await corePlayerOf(target.id)
      if (team == null) return res.status(400).json({ error: 'Not a player of your team', code: 'invalid_target' })
      if (def.lic.length && !def.lic.some((l) => target[l])) {
        return res.status(400).json({ error: 'Missing licence for this role', code: 'missing_licence' })
      }
      const sameDay = await database('games')
        .whereRaw('date::date = (SELECT g2.date::date FROM games g2 WHERE g2.id = ?)', [game.id])
        .select('id', 'date', 'time', ...Object.values(CLAIM_DEFS).map((d) => d.member))
      if (findDutyClash(game, target.id, sameDay)) {
        return res.status(409).json({ error: 'Already has a duty at that time', code: 'duty_clash' })
      }

      const now = new Date().toISOString()
      const byName = [actor.first_name, actor.last_name].filter(Boolean).join(' ').trim() || null
      const q = database('games').where('id', game.id)
      const n = await (current == null ? q.whereNull(def.member) : q.where(def.member, current))
        .update({ [def.member]: target.id, [def.name]: byName, [def.at]: now })
      if (!n) return res.status(409).json({ error: 'Seat changed meanwhile', code: 'seat_taken' })

      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'duty-assign',
        collection: 'games', recordId: game.id, data: { role, member: target.id, replaced: current ?? null, team, by: actor.id },
      })

      // Tell the junior (in-app + push). Best-effort: the seat is already set.
      try {
        const date = String(game.date instanceof Date ? game.date.toISOString() : game.date).slice(0, 10).split('-').reverse().join('.')
        const matchup = `${game.home_team ?? ''} - ${game.away_team ?? ''}`.trim()
        await database('notifications').insert({
          member: target.id, type: 'duty_assigned', title: 'duty_assigned',
          body: JSON.stringify({ by: actor.first_name || byName || '', game: matchup, date }),
          activity_type: 'scorer_duty', activity_id: String(game.id), team, read: false,
        })
        sendLocalizedPush(
          database, [target.id],
          (ids, title, body) => sendPushToMembers(database, ids, title, body, `${FRONTEND_URL}/scorer`, `duty-assign-${game.id}-${role}`, log),
          'dutyAssigned.title', 'dutyAssigned.body', { by: actor.first_name || '', game: matchup, date },
        ).catch(() => {})
      } catch (err) {
        log.warn({ msg: `duty-assign notify failed: ${err?.message}`, gameId: game.id })
      }

      res.json({ ok: true, member: target.id, confirmed_by_name: byName, confirmed_at: now })
    } catch (err) {
      log.error({ msg: `duty-assign: ${err?.message}`, stack: err?.stack, userId: req.accountability?.user || null })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
