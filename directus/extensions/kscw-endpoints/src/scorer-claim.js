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
import { CLAIM_DEFS, seatDutyTeams, findDutyClash, seatOpenToAll, playsThisGame, closeSeatInvites, moveSeatTeam } from './duty-seats.js'
import { notifySeatFilled } from './duty-recheck-core.js'
import { sendLocalizedPush } from './push-i18n.js'
import { sendPushToMembers } from './web-push.js'
import { FRONTEND_URL } from './email-template.js'

export { findDutyClash, DUTY_CLASH_MS } from './duty-seats.js'

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

      // The holder of this seat refused it after the game moved (migration 451): from
      // then on any member may take it, not just the duty team. The licence above and
      // the clash below still apply, and nobody officiates a game they play in.
      const openToAll = await seatOpenToAll(database, game.id, role)
      if (openToAll) {
        if (await playsThisGame(database, game, member.id)) {
          return res.status(409).json({ error: 'You play in this game', code: 'plays_this_game' })
        }
      } else {
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

      }

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
        collection: 'games', recordId: game.id, data: { role, member: member.id, open_to_all: openToAll },
      })
      if (openToAll) {
        await moveSeatTeam(database, game, role, member.id)
        await closeSeatInvites(database, game.id, role)
        await notifySeatFilled(ctx, game.id, role, member.id)
      }
      res.json({ ok: true, member: member.id, confirmed_by_name: fullName, confirmed_at: now })
    } catch (err) {
      log.error({ msg: `duty-claim: ${err?.message}`, stack: err?.stack, userId: req.accountability?.user || null })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  /**
   * POST /kscw/games/:id/duty-assign  { role, member }  — BASKETBALL ONLY.
   *
   * The coach / team responsible of a basketball team that is on duty for this
   * game puts one of the team's licensed players on a table seat — at once, no
   * acceptance step — swaps them, or clears the seat with `member: null`.
   * Started with the juniors (HU16 request, 01.10.2026: they do not answer
   * delegations, the TR organises the table anyway); opened to every BB team
   * on 15.10.2026. Volleyball keeps the self-claim / delegation-accept path.
   *
   * Guards: BB seat only; caller is staff (teams_coaches / teams_responsibles)
   * of an ACTIVE BB team in the seat's duty pool; target is an active core
   * player (guest_level 0) of that same team with the seat's licence and no
   * clashing duty; a seat held by anyone outside the caller's teams is never
   * touched (a seat a player claimed themselves IS replaceable). Actor captured
   * in confirmed_by_* + user_logs; the new holder and a removed holder are
   * notified.
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

      // The BB team(s) in this seat's pool that the caller coaches / is TR of.
      const pool = seatDutyTeams(game, def)
      const myTeams = pool.length
        ? await database('teams as t')
          .whereIn('t.id', pool).where('t.active', true).where('t.sport', 'basketball')
          .where((qb) => qb
            .whereExists(database('teams_coaches').whereRaw('teams_coaches.teams_id = t.id').where('members_id', actor.id))
            .orWhereExists(database('teams_responsibles').whereRaw('teams_responsibles.teams_id = t.id').where('members_id', actor.id)))
          .pluck('t.id').then((ids) => ids.map(Number))
        : []
      if (!myTeams.length) return res.status(403).json({ error: 'Only the coach or team responsible of a team on duty', code: 'not_duty_staff' })

      const corePlayerOf = async (memberId) => {
        const row = await database('member_teams').whereIn('team', myTeams).where('member', memberId)
          .where((qb) => qb.whereNull('guest_level').orWhere('guest_level', 0)).first('team')
        return row ? Number(row.team) : null
      }

      // A seat held by someone who is not one of these players stays untouched.
      const current = game[def.member]
      const currentTeam = current != null ? await corePlayerOf(current) : null
      if (current != null && currentTeam == null) {
        return res.status(409).json({ error: 'Role already taken', code: 'seat_taken' })
      }

      const date = String(game.date instanceof Date ? game.date.toISOString() : game.date).slice(0, 10).split('-').reverse().join('.')
      const matchup = `${game.home_team ?? ''} - ${game.away_team ?? ''}`.trim()
      const by = actor.first_name || actor.last_name || ''
      // In-app + push. Best-effort: the seat is already written.
      const notify = async (memberId, team, type, pushKey) => {
        try {
          await database('notifications').insert({
            member: memberId, type, title: type,
            body: JSON.stringify({ by, game: matchup, date }),
            activity_type: 'scorer_duty', activity_id: String(game.id), team, read: false,
          })
          sendLocalizedPush(
            database, [memberId],
            (ids, title, body) => sendPushToMembers(database, ids, title, body, `${FRONTEND_URL}/scorer`, `${type}-${game.id}-${role}`, log),
            `${pushKey}.title`, `${pushKey}.body`, { by, game: matchup, date },
          ).catch(() => {})
        } catch (err) {
          log.warn({ msg: `${type} notify failed: ${err?.message}`, gameId: game.id })
        }
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
        await notify(current, currentTeam, 'duty_unassigned', 'dutyUnassigned')
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

      await notify(target.id, team, 'duty_assigned', 'dutyAssigned')
      if (current != null) await notify(current, currentTeam, 'duty_unassigned', 'dutyUnassigned')

      res.json({ ok: true, member: target.id, confirmed_by_name: byName, confirmed_at: now })
    } catch (err) {
      log.error({ msg: `duty-assign: ${err?.message}`, stack: err?.stack, userId: req.accountability?.user || null })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
