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
 */

import { writeUserLog } from './activity-log.js'

// role → assignee column, duty-team column, confirmed-by pair, required licence
// (any-of), and whether BB roles fall back to the shared bb_duty_team.
// `lic` is evaluated any-of (`.some()`), so the 24s row lists the coarse
// `otn_bb` AND both levels from migration 228: Basketplan distinguishes OTN 1
// from OTN 2, but ClubDesk historically could only express a single level-less
// "OTN", so `otn_bb` is retained as the coarse "holds some OTN" flag and stays
// in the list — otherwise the 6 pre-split holders would lose the claim button.
const CLAIM_DEFS = {
  scorer:            { member: 'scorer_member',            duty: 'scorer_duty_team',            name: 'scorer_confirmed_by_name',            at: 'scorer_confirmed_at',            lic: ['scorer_vb'],          bbFallback: false },
  scoreboard:        { member: 'scoreboard_member',        duty: 'scoreboard_duty_team',        name: 'scoreboard_confirmed_by_name',        at: 'scoreboard_confirmed_at',        lic: [],                     bbFallback: false },
  scorer_scoreboard: { member: 'scorer_scoreboard_member', duty: 'scorer_scoreboard_duty_team', name: 'scorer_scoreboard_confirmed_by_name', at: 'scorer_scoreboard_confirmed_at', lic: [],                     bbFallback: false },
  referee:           { member: 'referee_member',           duty: 'referee_duty_team',           name: 'referee_confirmed_by_name',           at: 'referee_confirmed_at',           lic: [],                     bbFallback: false },
  bb_scorer:         { member: 'bb_scorer_member',         duty: 'bb_scorer_duty_team',         name: 'bb_scorer_confirmed_by_name',         at: 'bb_scorer_confirmed_at',         lic: ['otr1_bb'],            bbFallback: true },
  bb_timekeeper:     { member: 'bb_timekeeper_member',     duty: 'bb_timekeeper_duty_team',     name: 'bb_timekeeper_confirmed_by_name',     at: 'bb_timekeeper_confirmed_at',     lic: ['otr1_bb'],            bbFallback: true },
  bb_24s_official:   { member: 'bb_24s_official',          duty: 'bb_24s_duty_team',            name: 'bb_24s_confirmed_by_name',            at: 'bb_24s_confirmed_at',            lic: ['otr2_bb', 'otn_bb', 'otn1_bb', 'otn2_bb'], bbFallback: true },
}

export function registerScorerClaim(router, ctx) {
  const { database, logger } = ctx
  const log = logger.child({ endpoint: 'scorer-claim' })

  router.post('/games/:id/duty-claim', async (req, res) => {
    try {
      const userId = req.accountability?.user
      if (!userId) return res.status(401).json({ error: 'Authentication required' })

      // Every column named in any CLAIM_DEFS.lic must be selected here — a
      // missing one reads as undefined and silently denies the claim.
      const member = await database('members').where('user', userId)
        .first('id', 'first_name', 'last_name', 'kscw_membership_active', 'scorer_vb', 'otr1_bb', 'otr2_bb', 'otn_bb', 'otn1_bb', 'otn2_bb')
      if (!member || !member.kscw_membership_active) return res.status(403).json({ error: 'Not an active member' })

      const role = String(req.body?.role || '')
      const def = CLAIM_DEFS[role]
      if (!def) return res.status(400).json({ error: 'Invalid role' })

      const game = await database('games').where('id', req.params.id).first()
      if (!game) return res.status(404).json({ error: 'Game not found' })
      if (game[def.member] != null) return res.status(409).json({ error: 'Role already taken' })

      if (def.lic.length && !def.lic.some((l) => member[l])) {
        return res.status(403).json({ error: 'Missing licence for this role' })
      }

      const dutyTeam = game[def.duty] != null ? game[def.duty] : (def.bbFallback ? game.bb_duty_team : null)
      if (dutyTeam == null) return res.status(409).json({ error: 'No duty team assigned for this role' })
      const inTeam = await database('member_teams').where({ member: member.id, team: dutyTeam }).first('id')
      if (!inTeam) return res.status(403).json({ error: 'You are not in the duty team for this role' })

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
}
