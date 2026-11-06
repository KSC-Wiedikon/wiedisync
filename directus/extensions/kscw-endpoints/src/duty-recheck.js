/**
 * Moved home games: the questions and the empty seats (migration 451, owner 06.11.2026).
 *
 *   GET  /kscw/duty-recheck/home             what the home page shows this member
 *   POST /kscw/duty-recheck/:id/answer       { answer: 'yes' | 'no' } — the person asked
 *   GET  /kscw/duty-recheck/candidates       ?game=&role=&q= — the game team's leaders
 *   POST /kscw/duty-recheck/invite           { game, role, member } — the game team's leaders
 *   POST /kscw/admin/duty-recheck/release    { send } — admin, for a held batch
 *
 * "No" empties the seat at once, and from then on the seat is open to every member with
 * the licence it needs (duty-claim in scorer-claim.js). The game team's coaches and team
 * responsibles look for somebody; whoever they pick has to accept, as with a delegation.
 *
 * Why endpoints and not the items API: members have no games.update, and "only the seat
 * you were asked about" is not something a policy filter can say. Raw knex, so every
 * write logs its actor (CLAUDE.md audit rule).
 */
import { writeUserLog } from './activity-log.js'
import {
  CLAIM_DEFS, LICENCE_COLS, hasSeatLicence, findDutyClash, otherDutyClash, playsThisGame, seatOpenToAll,
  moveSeatTeam, closeSeatInvites,
} from './duty-seats.js'
import { loadGame, notifyDuty, notifySeatRefused, notifySeatFilled, gameVars, memberName, whenLabel } from './duty-recheck-core.js'

const CANDIDATE_LIMIT = 30

function gameJson(game) {
  return {
    game: game.id,
    home_team: game.home_team,
    away_team: game.away_team,
    date: game.date_ch,
    time: game.time_ch,
    hall: game.hall_label,
    team: game.team_name,
  }
}

async function ledTeamIds(database, memberId) {
  const [coaches, responsibles] = await Promise.all([
    database('teams_coaches').join('teams', 'teams.id', 'teams_coaches.teams_id')
      .where('teams_coaches.members_id', memberId).where('teams.active', true).pluck('teams_coaches.teams_id'),
    database('teams_responsibles').join('teams', 'teams.id', 'teams_responsibles.teams_id')
      .where('teams_responsibles.members_id', memberId).where('teams.active', true).pluck('teams_responsibles.teams_id'),
  ])
  return [...new Set([...coaches, ...responsibles].filter((x) => x != null).map(Number))]
}

export function registerDutyRecheck(router, ctx) {
  const { database, logger } = ctx
  const log = logger.child({ endpoint: 'duty-recheck' })
  const notifyCtx = { ...ctx, logger: log }

  const fail = (res, where, err, req) => {
    log.error({ msg: `${where}: ${err?.message}`, stack: err?.stack, userId: req.accountability?.user || null })
    res.status(500).json({ error: 'Internal error' })
  }

  const memberOf = (req) => database('members').where('user', req.accountability.user)
    .first('id', 'first_name', 'last_name', 'kscw_membership_active', ...LICENCE_COLS)

  /** Upcoming, still played at home, and its seat empty with a refusal behind it. */
  async function openSeats() {
    const { rows } = await database.raw(`
      SELECT DISTINCT r.game, r.role
        FROM duty_rechecks r JOIN games g ON g.id = r.game
       WHERE r.kind = 'ask' AND r.status = 'refused' AND g.type = 'home'
         AND COALESCE(g.status, 'scheduled') NOT IN ('completed', 'cancelled', 'postponed')
         AND ((g.date + g.time) AT TIME ZONE 'Europe/Zurich') > now()`)
    const out = []
    for (const { game: gameId, role } of rows) {
      const game = await loadGame(database, gameId)
      const def = CLAIM_DEFS[role]
      if (game && def && game[def.member] == null) out.push({ game, role, def })
    }
    return out.sort((a, b) => `${a.game.date_ch}`.split('.').reverse().join().localeCompare(`${b.game.date_ch}`.split('.').reverse().join()))
  }

  router.get('/duty-recheck/home', async (req, res) => {
    try {
      if (!req.accountability?.user) return res.status(401).json({ error: 'Authentication required' })
      const empty = { questions: [], open_seats: [], to_fill: [] }
      // Duty is personal: nothing here applies while acting for a linked member.
      if (req.accountability.kscwGuardian) return res.json(empty)
      const member = await memberOf(req)
      if (!member || !member.kscw_membership_active) return res.json(empty)

      const asked = await database.raw(`
        SELECT r.id, r.kind, r.role, r.game, r.invited_by,
               to_char(r.old_date, 'DD.MM.YYYY') AS old_date_ch, to_char(r.old_time, 'HH24:MI') AS old_time_ch, r.old_hall
          FROM duty_rechecks r
         WHERE r.member = ? AND r.status = 'pending' AND r.notified_at IS NOT NULL AND r.kind IN ('ask', 'invite')
         ORDER BY r.id`, [member.id])
      const questions = []
      for (const r of asked.rows) {
        const game = await loadGame(database, r.game)
        const def = CLAIM_DEFS[r.role]
        if (!game || !game.live || game.started || !def) continue
        const holds = Number(game[def.member]) === Number(member.id)
        if (r.kind === 'ask' ? !holds : game[def.member] != null) continue
        questions.push({
          id: Number(r.id),
          kind: r.kind,
          role: r.role,
          was: r.kind === 'ask' ? whenLabel(r.old_date_ch, r.old_time_ch, r.old_hall) : null,
          by: r.kind === 'invite' && r.invited_by != null ? await memberName(database, r.invited_by) : null,
          clash: !!(await otherDutyClash(database, game, member.id)),
          ...gameJson(game),
        })
      }

      const seats = await openSeats()
      const open_seats = []
      for (const { game, role, def } of seats) {
        if (!hasSeatLicence(def, member)) continue
        if (await playsThisGame(database, game, member.id)) continue
        if (await otherDutyClash(database, game, member.id)) continue
        open_seats.push({ role, ...gameJson(game) })
      }

      const led = await ledTeamIds(database, member.id)
      const to_fill = []
      if (led.length) {
        for (const { game, role } of seats) {
          if (!led.includes(Number(game.kscw_team))) continue
          const invites = await database('duty_rechecks as r').join('members as m', 'm.id', 'r.member')
            .where({ 'r.game': game.id, 'r.role': role, 'r.kind': 'invite', 'r.status': 'pending' })
            .select('m.id', 'm.first_name', 'm.last_name')
          to_fill.push({
            role, state: 'open', ...gameJson(game),
            invited: invites.map((i) => ({ id: i.id, name: [i.first_name, i.last_name].filter(Boolean).join(' ') })),
          })
        }
        const silent = await database.raw(`
          SELECT r.game, r.role, r.member FROM duty_rechecks r JOIN games g ON g.id = r.game
           WHERE r.kind = 'ask' AND r.status = 'pending' AND r.leaders_warned_at IS NOT NULL
             AND g.kscw_team = ANY(?::int[])`, [led])
        for (const s of silent.rows) {
          const game = await loadGame(database, s.game)
          const def = CLAIM_DEFS[s.role]
          if (!game || !game.live || game.started || !def || Number(game[def.member]) !== Number(s.member)) continue
          to_fill.push({ role: s.role, state: 'silent', holder: await memberName(database, s.member), ...gameJson(game), invited: [] })
        }
      }
      res.json({ questions, open_seats, to_fill })
    } catch (err) { fail(res, 'home', err, req) }
  })

  router.post('/duty-recheck/:id/answer', async (req, res) => {
    try {
      if (!req.accountability?.user) return res.status(401).json({ error: 'Authentication required' })
      if (req.accountability.kscwGuardian) {
        return res.status(403).json({ error: 'Not available while using another account', code: 'acting_forbidden' })
      }
      const answer = req.body?.answer
      if (answer !== 'yes' && answer !== 'no') return res.status(400).json({ error: 'Invalid answer' })
      if (!/^\d{1,18}$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid question' })

      const member = await memberOf(req)
      const r = await database('duty_rechecks').where('id', req.params.id).first()
      if (!member || !r || !['ask', 'invite'].includes(r.kind)) return res.status(404).json({ error: 'Question not found' })
      if (Number(r.member) !== Number(member.id)) return res.status(403).json({ error: 'Only the person asked can answer' })
      if (r.status !== 'pending') return res.status(409).json({ error: 'Already answered', code: 'not_open' })

      const game = await loadGame(database, r.game)
      const def = CLAIM_DEFS[r.role]
      if (!game || !def) return res.status(404).json({ error: 'Game not found' })
      if (!game.live || game.started) return res.status(409).json({ error: 'Game is no longer open', code: 'not_open' })

      const answered = { answered_at: new Date(), status: answer === 'yes' ? 'confirmed' : 'refused' }
      const audit = (what, data = {}) => writeUserLog(database, log, {
        accountability: req.accountability, action: 'duty-recheck',
        collection: 'games', recordId: game.id, data: { what, role: r.role, question: Number(r.id), ...data },
      })

      if (r.kind === 'ask') {
        if (Number(game[def.member]) !== Number(member.id)) {
          await database('duty_rechecks').where('id', r.id).update({ status: 'superseded' })
          return res.status(409).json({ error: 'You no longer hold this seat', code: 'seat_taken' })
        }
        if (answer === 'yes') {
          await database('duty_rechecks').where('id', r.id).where('status', 'pending').update(answered)
          await audit('confirmed')
          return res.json({ ok: true, status: 'confirmed' })
        }
        await database.transaction(async (trx) => {
          const n = await trx('games').where('id', game.id).where(def.member, member.id)
            .update({ [def.member]: null, [def.name]: null, [def.at]: null })
          if (!n) { const e = new Error('Seat changed meanwhile'); e.status = 409; throw e }
          await trx('duty_rechecks').where('id', r.id).update(answered)
          // A hand-over they had open cannot complete any more: they hold nothing to hand over.
          await trx('scorer_delegations').where({ game: game.id, role: r.role, from_member: member.id, status: 'pending' })
            .update({ status: 'expired' })
        })
        await audit('refused')
        await notifySeatRefused(notifyCtx, game, r.role, member.id)
        return res.json({ ok: true, status: 'refused' })
      }

      // A request to take an empty seat.
      if (answer === 'no') {
        await database('duty_rechecks').where('id', r.id).where('status', 'pending').update(answered)
        await audit('invite_refused')
        if (r.invited_by != null) {
          await notifyDuty(notifyCtx, [r.invited_by], 'inviteRefused', {
            ...gameVars(game), roleKey: r.role, name: await memberName(database, member.id),
          }, { gameId: game.id, tag: `duty-recheck-invite-${game.id}-${r.role}-${member.id}` })
        }
        return res.json({ ok: true, status: 'refused' })
      }
      if (game[def.member] != null) {
        await database('duty_rechecks').where('id', r.id).update({ status: 'superseded' })
        return res.status(409).json({ error: 'Role already taken', code: 'seat_taken' })
      }
      if (!member.kscw_membership_active) return res.status(403).json({ error: 'Not an active member' })
      if (!hasSeatLicence(def, member)) return res.status(403).json({ error: 'Missing licence for this role', code: 'missing_licence' })
      if (await otherDutyClash(database, game, member.id)) {
        return res.status(409).json({ error: 'You already have a duty at that time', code: 'duty_clash' })
      }
      const name = [member.first_name, member.last_name].filter(Boolean).join(' ').trim() || null
      const n = await database('games').where('id', game.id).whereNull(def.member)
        .update({ [def.member]: member.id, [def.name]: name, [def.at]: new Date().toISOString() })
      if (!n) return res.status(409).json({ error: 'Role already taken', code: 'seat_taken' })
      await database('duty_rechecks').where('id', r.id).update(answered)
      await moveSeatTeam(database, game, r.role, member.id)
      await closeSeatInvites(database, game.id, r.role)
      await audit('invite_accepted')
      await notifySeatFilled(notifyCtx, game.id, r.role, member.id)
      res.json({ ok: true, status: 'confirmed' })
    } catch (err) {
      if (err?.status === 409) return res.status(409).json({ error: err.message, code: 'seat_taken' })
      fail(res, 'answer', err, req)
    }
  })

  /** Caller may look for somebody on this game: a leader of the playing team, or an admin. */
  async function authorizeLeader(req, gameId) {
    if (!req.accountability?.user) { const e = new Error('Authentication required'); e.status = 401; throw e }
    if (req.accountability.kscwGuardian) { const e = new Error('Not available while using another account'); e.status = 403; e.code = 'acting_forbidden'; throw e }
    if (!/^\d{1,9}$/.test(String(gameId ?? ''))) { const e = new Error('Invalid game'); e.status = 400; throw e }
    const game = await loadGame(database, gameId)
    if (!game) { const e = new Error('Game not found'); e.status = 404; throw e }
    const actor = await memberOf(req)
    const led = actor ? await ledTeamIds(database, actor.id) : []
    if (!req.accountability.admin && !led.includes(Number(game.kscw_team))) {
      const e = new Error('Only the coach or team responsible of the playing team'); e.status = 403; e.code = 'not_team_leader'; throw e
    }
    return { game, actor }
  }

  const replyErr = (res, where, err, req) => {
    if (err?.status && err.status < 500) return res.status(err.status).json({ error: err.message, code: err.code })
    return fail(res, where, err, req)
  }

  router.get('/duty-recheck/candidates', async (req, res) => {
    try {
      const { game } = await authorizeLeader(req, req.query.game)
      const role = String(req.query.role || '')
      const def = CLAIM_DEFS[role]
      if (!def) return res.status(400).json({ error: 'Invalid role' })
      const q = String(req.query.q ?? '').trim()
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

      const rows = await database('members as m')
        .where('m.kscw_membership_active', true)
        .where((qb) => { if (def.lic.length) qb.where((w) => { for (const l of def.lic) w.orWhere(`m.${l}`, true) }) })
        .where((qb) => {
          if (q) {
            qb.whereILike('m.first_name', like).orWhereILike('m.last_name', like)
              .orWhereRaw(`(m.first_name || ' ' || m.last_name) ILIKE ?`, [like])
          }
        })
        .orderBy(['m.last_name', 'm.first_name'])
        .limit(CANDIDATE_LIMIT * 3)
        .select('m.id', 'm.first_name', 'm.last_name',
          database.raw(`(SELECT string_agg(t.name, ', ' ORDER BY t.name) FROM member_teams mt JOIN teams t ON t.id = mt.team
                          WHERE mt.member = m.id AND t.active AND COALESCE(mt.guest_level, 0) = 0) AS teams`))

      const sameDay = await database('games')
        .whereRaw('date::date = (SELECT g2.date::date FROM games g2 WHERE g2.id = ?)', [game.id])
        .whereNot('id', game.id)
        .select('id', 'date', 'time', ...Object.values(CLAIM_DEFS).map((d) => d.member))
      const pending = new Set((await database('duty_rechecks')
        .where({ game: game.id, role, kind: 'invite', status: 'pending' }).pluck('member')).map(Number))

      const data = []
      for (const m of rows) {
        if (data.length >= CANDIDATE_LIMIT) break
        if (await playsThisGame(database, game, m.id)) continue
        data.push({
          id: Number(m.id),
          first_name: m.first_name || '',
          last_name: m.last_name || '',
          teams: m.teams || '',
          clash: !!findDutyClash(game, m.id, sameDay),
          invited: pending.has(Number(m.id)),
        })
      }
      res.json({ data })
    } catch (err) { replyErr(res, 'candidates', err, req) }
  })

  router.post('/duty-recheck/invite', async (req, res) => {
    try {
      const { game, actor } = await authorizeLeader(req, req.body?.game)
      const role = String(req.body?.role || '')
      const def = CLAIM_DEFS[role]
      if (!def) return res.status(400).json({ error: 'Invalid role' })
      const targetId = Number(req.body?.member)
      if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Invalid member' })
      if (!game.live || game.started) return res.status(409).json({ error: 'Game is no longer open', code: 'not_open' })
      if (game[def.member] != null) return res.status(409).json({ error: 'Role already taken', code: 'seat_taken' })
      if (!(await seatOpenToAll(database, game.id, role))) {
        return res.status(409).json({ error: 'This seat is not looking for anybody', code: 'not_open' })
      }
      const target = await database('members').where('id', targetId).first('id', 'kscw_membership_active', ...LICENCE_COLS)
      if (!target || !target.kscw_membership_active) return res.status(400).json({ error: 'Not an active member', code: 'invalid_target' })
      if (!hasSeatLicence(def, target)) return res.status(400).json({ error: 'Missing licence for this role', code: 'missing_licence' })
      if (await playsThisGame(database, game, target.id)) return res.status(409).json({ error: 'Plays in this game', code: 'plays_this_game' })
      if (await otherDutyClash(database, game, target.id)) return res.status(409).json({ error: 'Already has a duty at that time', code: 'duty_clash' })

      const already = await database('duty_rechecks').where({ game: game.id, role, member: target.id, status: 'pending' }).first('id')
      if (already) return res.json({ ok: true, id: Number(already.id) })
      const [row] = await database('duty_rechecks').insert({
        game: game.id, role, member: target.id, invited_by: actor?.id ?? null,
        kind: 'invite', reason: 'invited', status: 'pending',
        home_team: game.home_team, away_team: game.away_team, new_date: game.date, new_time: game.time, new_hall: game.hall_label,
        send_after: new Date(),
      }).returning('id')
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'duty-recheck',
        collection: 'games', recordId: game.id, data: { what: 'invite', role, member: target.id },
      })
      res.json({ ok: true, id: Number(row.id ?? row) })
    } catch (err) { replyErr(res, 'invite', err, req) }
  })

  router.post('/admin/duty-recheck/release', async (req, res) => {
    try {
      if (!req.accountability?.admin) return res.status(403).json({ error: 'Admin access required' })
      const send = req.body?.send === true
      const q = database('duty_rechecks').whereNull('notified_at').whereNotNull('held_at')
      const n = send
        ? await q.update({ held_at: null, released_at: new Date(), send_after: new Date() })
        : await q.update({ held_at: null, released_at: new Date(), notified_at: new Date(), status: database.raw(`CASE WHEN status = 'pending' THEN 'superseded' ELSE status END`) })
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'duty-recheck',
        collection: 'duty_rechecks', data: { what: send ? 'release_send' : 'release_drop', rows: n },
      })
      res.json({ ok: true, rows: n })
    } catch (err) { fail(res, 'release', err, req) }
  })
}
