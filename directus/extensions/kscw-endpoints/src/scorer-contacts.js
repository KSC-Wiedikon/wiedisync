/**
 * Scorer Official Contacts
 * GET /kscw/scorer/official-contacts
 *
 * Returns email/phone of the officials (scorer / scoreboard / BB officials)
 * assigned to games where the CALLER's led team (coach or team-responsible)
 * holds the scorekeeping duty — and ONLY those.
 *
 * Why a custom endpoint instead of a Directus permission row:
 * the grant is "members who are assigned as officials on a game my team has
 * duty for". Expressing that as a Directus field-level filter would require
 * walking games→members o2m aliases inside a policy filter — the documented
 * "deep filter + policy walk = silent empty" trap (CLAUDE.md). Authorising
 * per-game in code is robust and keeps coaches from bulk-reading contacts via
 * the items API (members.read for the LEADER policy stays scoped to own-team
 * members only). This is a READ — no audit/actor capture required.
 *
 * Admins (global + sport) already read member contacts via the items API, so
 * they don't need this endpoint; a caller with no led teams gets {}.
 */

// Per-role duty-team FK + assigned-member FK columns on `games`.
const VB_ROLES = [
  { duty: 'scorer_duty_team', member: 'scorer_member' },
  { duty: 'scoreboard_duty_team', member: 'scoreboard_member' },
  { duty: 'scorer_scoreboard_duty_team', member: 'scorer_scoreboard_member' },
]
// Basketball role-specific duty cols fall back to the umbrella `bb_duty_team`.
const BB_ROLES = [
  { duty: 'bb_scorer_duty_team', member: 'bb_scorer_member' },
  { duty: 'bb_timekeeper_duty_team', member: 'bb_timekeeper_member' },
  { duty: 'bb_24s_duty_team', member: 'bb_24s_official' },
]
const ALL_DUTY_COLS = [...VB_ROLES.map((r) => r.duty), ...BB_ROLES.map((r) => r.duty), 'bb_duty_team']

export function registerScorerContacts(router, { database, logger }) {
  const log = logger.child({ endpoint: 'scorer-contacts' })

  router.get('/scorer/official-contacts', async (req, res) => {
    try {
      const userId = req.accountability?.user
      if (!userId && !req.accountability?.admin) {
        return res.status(401).json({ error: 'Authentication required' })
      }

      // Resolve the caller's member id, then the teams they lead (coach or TR).
      const member = userId
        ? await database('members').where('user', userId).first('id')
        : null
      let ledTeamIds = []
      if (member) {
        const [coachRows, trRows] = await Promise.all([
          database('teams_coaches').where('members_id', member.id).pluck('teams_id'),
          database('teams_responsibles').where('members_id', member.id).pluck('teams_id'),
        ])
        ledTeamIds = [...new Set(
          [...coachRows, ...trRows].filter((t) => t != null).map(Number),
        )]
      }

      // No led teams → nothing to expose (admins use the items API instead).
      if (ledTeamIds.length === 0) {
        return res.json({ data: {} })
      }
      const ledSet = new Set(ledTeamIds)

      // Home games where one of the caller's led teams holds ANY duty.
      const games = await database('games')
        .where('type', 'home')
        .where((qb) => {
          for (const col of ALL_DUTY_COLS) qb.orWhereIn(col, ledTeamIds)
        })
        .select('*')

      // Collect the assigned-member id for each duty role the caller's team
      // actually owns — don't leak the official of a role another team is
      // responsible for on the same game.
      const officialIds = new Set()
      for (const g of games) {
        for (const r of VB_ROLES) {
          if (g[r.member] && ledSet.has(Number(g[r.duty]))) officialIds.add(g[r.member])
        }
        for (const r of BB_ROLES) {
          const duty = g[r.duty] ?? g.bb_duty_team
          if (g[r.member] && ledSet.has(Number(duty))) officialIds.add(g[r.member])
        }
      }

      if (officialIds.size === 0) {
        return res.json({ data: {} })
      }

      const rows = await database('members')
        .whereIn('id', [...officialIds])
        .select('id', 'phone', 'email', 'hide_phone', 'hide_email')

      // Return raw values + hide flags, matching what the items API hands admins.
      // The UI (AssignmentEditor) gates display on the hide flags.
      const data = {}
      for (const r of rows) {
        data[String(r.id)] = {
          phone: r.phone || null,
          email: r.email || null,
          hide_phone: !!r.hide_phone,
          hide_email: !!r.hide_email,
        }
      }
      res.json({ data })
    } catch (err) {
      log.error({
        msg: `scorer/official-contacts: ${err.message}`,
        endpoint: 'scorer/official-contacts',
        userId: req.accountability?.user || null,
        method: req.method,
        stack: err.stack,
      })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
