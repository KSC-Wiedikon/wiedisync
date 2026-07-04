/**
 * Poll results — identity-free aggregate counts.
 *
 * Audit 2026-07-02 (#5 / #14, MEDIUM): anonymous poll votes always persist
 * `member`, and the manager `poll_votes` reads (LEADER + Vorstand + Sport Admin)
 * returned the voter identity for anonymous polls too — anonymity was a UI-only
 * toggle (PollCard hides `votedBy`), trivially defeated via the items API or
 * React devtools. Those manager reads are now scoped to non-anonymous polls at
 * the data layer (setup-permissions.mjs), so anonymous vote rows are no longer
 * identity-readable by any non-admin role. This endpoint gives the aggregate —
 * per-option counts, NO identity — computed on the system connection.
 *
 *   GET /kscw/polls/:id/results  ->  { counts: { [optionIndex]: n }, totalVotes }
 *
 * Who may call it (migration 171 widened this beyond managers):
 *   - managers: admin / sport-admin / vorstand / coach / TR of the poll's team
 *     — the audience that can see live results before the deadline;
 *   - the poll's creator (matters for chat polls, where the creator is usually
 *     a regular member);
 *   - when the poll was created with `results_visible`: anyone who can see the
 *     poll at all — the team roster (team polls) or the conversation members
 *     (chat polls).
 * Everyone else gets 403 (they still read their own vote via the OWN_MEMBER
 * poll_votes read). Voter identity never leaves this endpoint regardless.
 */

/** Manager, creator, or — for visible-results polls — team/conversation member. */
async function authorizePollViewer(db, req, poll) {
  if (req.accountability?.admin === true) return true
  if (!req.accountability?.user) return false
  const caller = await db('members').where('user', req.accountability.user).select('id', 'role').first()
  if (!caller) return false
  const roles = Array.isArray(caller.role)
    ? caller.role
    : (caller.role ? (() => { try { return JSON.parse(caller.role) } catch { return [] } })() : [])
  if (roles.includes('admin') || roles.includes('superuser')
    || roles.includes('vb_admin') || roles.includes('bb_admin')
    || roles.includes('vorstand')) return true
  if (poll.team) {
    const [coach, tr] = await Promise.all([
      db('teams_coaches').where('teams_id', poll.team).where('members_id', caller.id).first(),
      db('teams_responsibles').where('teams_id', poll.team).where('members_id', caller.id).first(),
    ])
    if (coach || tr) return true
  }
  if (poll.created_by != null && String(poll.created_by) === String(caller.id)) return true
  if (poll.results_visible) {
    if (poll.team) {
      const roster = await db('member_teams').where('team', poll.team).where('member', caller.id).first()
      if (roster) return true
    }
    if (poll.conversation) {
      const participant = await db('conversation_members')
        .where('conversation', poll.conversation).where('member', caller.id).first()
      if (participant) return true
    }
  }
  return false
}

export function registerPollResults(router, { database, logger }, helpers) {
  const { logEndpointError, requireAuth } = helpers
  const log = logger.child({ endpoint: 'poll-results' })

  router.get('/polls/:id/results', async (req, res) => {
    try {
      requireAuth(req, log)
      const poll = await database('polls').where('id', req.params.id)
        .select('id', 'team', 'conversation', 'anonymous', 'created_by', 'results_visible').first()
      if (!poll) { res.status(404).json({ error: 'Poll not found' }); return }
      if (!(await authorizePollViewer(database, req, poll))) {
        res.status(403).json({ error: 'Not authorised for this poll' }); return
      }
      const rows = await database('poll_votes').where('poll', poll.id).select('selected_options')
      const counts = {}
      let totalVotes = 0
      for (const r of rows) {
        totalVotes++
        let sel = r.selected_options
        if (typeof sel === 'string') { try { sel = JSON.parse(sel) } catch { sel = [] } }
        if (!Array.isArray(sel)) sel = []
        for (const idx of sel) counts[idx] = (counts[idx] || 0) + 1
      }
      res.json({ counts, totalVotes })
    } catch (err) {
      logEndpointError(log, 'polls/results', err, req)
      if (!res.headersSent) res.status(500).json({ error: 'Internal error' })
    }
  })

  log.info('Poll results endpoint loaded (identity-free counts; manager/creator + visible-results audiences)')
}
