/**
 * Moved home games: the trigger, the questions, the empty seats, the follow-ups.
 *
 * The wording tests always run. The rest needs a Postgres holding the real schema, since
 * the rules live in triggers and in SQL that has to agree with them:
 *
 *   docker run -d --rm --name duty-pg -e POSTGRES_PASSWORD=x -p 127.0.0.1:55439:5432 postgres:16
 *   cd directus/scripts
 *   docker exec -i duty-pg psql -U postgres -q -X < SCHEMA.sql      # errors about directus_* are fine
 *   docker exec -i duty-pg psql -U postgres -q -X < 451-duty-rechecks.sql   # plus any newer than SCHEMA.sql
 *   (cd ../extensions/kscw-endpoints && npm i --no-save pg)
 *   DUTY_RECHECK_TEST_PG=postgres://postgres:x@127.0.0.1:55439/postgres \
 *     npx vitest run directus/extensions/kscw-endpoints/src/__tests__/duty-recheck.test.js
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { dutyRecheckEmailContent, roleLabel } from '../duty-recheck-core.js'
import { tPush } from '../push-i18n.js'

const pushes = vi.hoisted(() => [])
vi.mock('../web-push.js', () => ({
  sendPushToMembers: async (_db, ids, title, body, url, tag) => { pushes.push({ ids, title, body, url, tag }) },
  sendPushToMember: async () => {},
}))

const KINDS = ['ask', 'remind', 'invite', 'released', 'postponed', 'hall', 'teamNotice',
  'leaderRefused', 'leaderSilent', 'leaderOpen', 'inviteRefused', 'seatFilled']
const LOCALES = ['de', 'gsw', 'en', 'fr', 'it']

describe('wording', () => {
  const vars = {
    game: 'KSCW H3 – Voléro', date: '17.01.2027', time: '19:00', when: '17.01.2027, 19:00', hall: 'KWI A',
    name: 'Anna Muster', by: 'Bea Coach', team: 'Herren 3', was: '10.01.2027, 20:00 · KWI A', now: '17.01.2027, 19:00 · KWI A',
    role: 'Schreiber',
  }

  it.each(LOCALES)('%s has every message, capitalised, with every placeholder filled', (locale) => {
    for (const kind of KINDS) {
      const title = tPush(locale, `dutyRecheck.${kind}.title`, vars)
      const body = tPush(locale, `dutyRecheck.${kind}.body`, vars)
      expect(title, kind).toMatch(/^\p{Lu}/u)
      expect(body.length, kind).toBeGreaterThan(10)
      expect(body, kind).not.toMatch(/[{}]/)
    }
  })

  it('an email escapes names and carries old and new', () => {
    const c = dutyRecheckEmailContent({
      locale: 'en', kind: 'leaderRefused', vars: { ...vars, name: '<b>Anna</b>' }, firstName: 'Bea', url: 'https://x/',
    })
    expect(c.subject).toBe('WiediSync — Duty needs a replacement: KSCW H3 – Voléro')
    expect(c.html).not.toContain('<b>Anna</b>')
    expect(c.html).toContain('&lt;b&gt;Anna')
    expect(c.text).toContain('Was: 10.01.2027, 20:00 · KWI A')
    expect(c.text).toContain('Now: 17.01.2027, 19:00 · KWI A')
    expect(c.text).toContain('https://x/')
  })

  it('role names follow the language', () => {
    expect(roleLabel('de', 'scoreboard')).toBe('Täfeler')
    expect(roleLabel('en', 'scoreboard')).toBe('Scoreboard')
  })
})

const PG = process.env.DUTY_RECHECK_TEST_PG

describe.skipIf(!PG)('with a real schema', () => {
  /** @type {import('knex').Knex} */
  let db
  let drain, followUps
  const mails = []
  const log = { info() {}, warn() {}, error() {}, child() { return log } }
  class MailService { async send(m) { mails.push(m) } }
  const ctx = () => ({ database: db, logger: log, services: { MailService }, getSchema: async () => ({}) })
  const routes = {}
  const router = {
    get: (p, h) => { routes[`GET ${p}`] = h },
    post: (p, h) => { routes[`POST ${p}`] = h },
    delete: (p, h) => { routes[`DELETE ${p}`] = h },
  }
  const call = async (route, { user, admin = false, guardian = null, body = {}, params = {}, query = {} } = {}) => {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
    await routes[route]({ accountability: { user, admin, kscwGuardian: guardian }, body, params, query, headers: {} }, res)
    return res
  }

  // ids
  const T = { game: 901, duty: 902, other: 903 }
  const M = { holder: 9101, tafeler: 9102, coach: 9103, tr: 9104, dutyCoach: 9105, player: 9106, outsider: 9107, licensed: 9108, inactive: 9109, stranger: 9110 }
  const users = Object.fromEntries(Object.keys(M).map((k) => [k, randomUUID()]))
  const H = { kwiA: 901, kwiB: 902, other: 903 }

  const member = (key, extra = {}) => ({
    id: M[key], first_name: key, last_name: 'Test', email: `${key}@example.test`, user: users[key],
    kscw_membership_active: key !== 'inactive', language: 'english', ...extra,
  })

  const inDays = (n) => db.raw(`(now() AT TIME ZONE 'Europe/Zurich')::date + ?::int`, [n])

  async function makeGame(id, extra = {}) {
    await db('games').insert({
      id, game_id: `t_${id}`, type: 'home', status: 'scheduled', kscw_team: T.game, home_team: 'KSCW T', away_team: 'Gegner',
      date: inDays(30), time: '20:00', hall: H.kwiA, source: 'manual',
      scorer_member: M.holder, scorer_duty_team: T.duty, scoreboard_member: M.tafeler, scoreboard_duty_team: T.duty,
      ...extra,
    })
    return id
  }
  const rechecks = (where = {}) => db('duty_rechecks').where(where).orderBy('id')
  const flush = () => db('duty_rechecks').update({ send_after: db.raw(`now() - interval '1 minute'`) })

  beforeAll(async () => {
    // As in the container: pg hands back a date as local midnight, and the kick-off
    // arithmetic in duty-late.js reads it as UTC.
    process.env.TZ = 'UTC'
    const { default: knex } = await import('knex')
    db = knex({ client: 'pg', connection: PG })
    const hook = await import('../../../kscw-hooks/src/duty-recheck.js')
    drain = hook.drainDutyRechecks
    followUps = hook.sweepDutyRecheckFollowUps
    const { registerDutyRecheck } = await import('../duty-recheck.js')
    const { registerScorerClaim } = await import('../scorer-claim.js')
    const { registerDutyLate } = await import('../duty-late.js')
    const c = ctx()
    registerDutyRecheck(router, c)
    registerScorerClaim(router, c)
    registerDutyLate(router, c)
  })
  afterAll(async () => { await db?.destroy() })

  beforeEach(async () => {
    pushes.length = 0
    mails.length = 0
    await db.raw(`TRUNCATE duty_rechecks, notifications, user_logs RESTART IDENTITY`)
    await db('fines').whereIn('member', Object.values(M)).del()
    await db('games').where('id', '>=', 9000).del()
    await db('duty_rechecks').del()
    await db('scorer_delegations').whereIn('from_member', Object.values(M)).del()
    await db('participations').whereIn('member', Object.values(M)).del()
    await db('member_teams').whereIn('member', Object.values(M)).del()
    await db('teams_coaches').whereIn('members_id', Object.values(M)).del()
    await db('teams_responsibles').whereIn('members_id', Object.values(M)).del()
    await db('members').whereIn('id', Object.values(M)).del()
    await db('teams').whereIn('id', Object.values(T)).del()
    await db('halls').whereIn('id', Object.values(H)).del()

    await db('halls').insert([
      { id: H.kwiA, name: 'KWI A', address: 'Goldbrunnenstrasse 80', city: 'Zürich' },
      { id: H.kwiB, name: 'KWI B', address: 'Goldbrunnenstrasse 80', city: 'Zürich' },
      { id: H.other, name: 'Döltschi', address: 'Döltschiweg 184', city: 'Zürich' },
    ])
    await db('teams').insert([
      { id: T.game, name: 'Game team', sport: 'volleyball', active: true },
      { id: T.duty, name: 'Duty team', sport: 'volleyball', active: true },
      { id: T.other, name: 'Other team', sport: 'volleyball', active: true },
    ])
    await db('members').insert([
      member('holder', { scorer_vb: true, language: 'german' }), member('tafeler'), member('coach'), member('tr'),
      member('dutyCoach'), member('player'), member('outsider'), member('licensed', { scorer_vb: true }), member('inactive'),
      member('stranger'),
    ])
    await db('member_teams').insert([
      { member: M.player, team: T.game }, { member: M.holder, team: T.duty }, { member: M.tafeler, team: T.duty },
      { member: M.outsider, team: T.other }, { member: M.licensed, team: T.other },
    ])
    await db('teams_coaches').insert([{ teams_id: T.game, members_id: M.coach }, { teams_id: T.duty, members_id: M.dutyCoach }])
    await db('teams_responsibles').insert([{ teams_id: T.game, members_id: M.tr }])
  })

  describe('the trigger', () => {
    it('a new date asks everybody on a seat, starting from the old one', async () => {
      await makeGame(9001)
      await db('games').where('id', 9001).update({ date: inDays(37) })
      const rows = await rechecks({ game: 9001, kind: 'ask' })
      expect(rows.map((r) => [r.role, r.member, r.status]).sort()).toEqual([
        ['scoreboard', M.tafeler, 'pending'], ['scorer', M.holder, 'pending'],
      ])
      expect(rows[0].old_time).toBe('20:00:00')
      expect(rows[0].new_hall).toBe('KWI A')
    })

    it('a new time asks; so does another building; the same building is a notice only', async () => {
      await makeGame(9001, { scoreboard_member: null, scoreboard_duty_team: null })
      await db('games').where('id', 9001).update({ time: '20:15' })
      expect(await rechecks({ game: 9001, kind: 'ask' })).toHaveLength(1)
      await db('duty_rechecks').del()

      await db('games').where('id', 9001).update({ hall: H.kwiB })
      const same = await rechecks({ game: 9001 })
      expect(same.map((r) => [r.kind, r.reason])).toEqual([['notice', 'hall_same_site']])
      await db('duty_rechecks').del()

      await db('games').where('id', 9001).update({ hall: H.other })
      const other = await rechecks({ game: 9001 })
      expect(other.map((r) => [r.kind, r.reason, r.old_hall, r.new_hall])).toEqual([['ask', 'moved', 'KWI B', 'Döltschi']])
    })

    it('adding a court in the same building is a notice too', async () => {
      await makeGame(9001, { scoreboard_member: null })
      await db('games').where('id', 9001).update({ additional_halls: JSON.stringify([H.kwiB]) })
      expect((await rechecks({ game: 9001 })).map((r) => r.reason)).toEqual(['hall_same_site'])
    })

    it('a sync rewriting the same values, or anything else, says nothing', async () => {
      await makeGame(9001)
      const g = await db('games').where('id', 9001).first()
      await db('games').where('id', 9001).update({ date: g.date, time: g.time, hall: g.hall, type: g.type, status: g.status, league: '3L' })
      expect(await rechecks()).toEqual([])
    })

    it('leaves away rows, past games and results alone', async () => {
      await makeGame(9001, { type: 'away' })
      await db('games').where('id', 9001).update({ date: inDays(37) })
      await makeGame(9002, { date: inDays(-3) })
      await db('games').where('id', 9002).update({ date: inDays(-2) })
      await makeGame(9003)
      await db('games').where('id', 9003).update({ status: 'completed', date: inDays(37) })
      expect(await rechecks()).toEqual([])
    })

    it('two quick moves are one question from the first date; there and back is none', async () => {
      await makeGame(9001, { scoreboard_member: null, scoreboard_duty_team: null, date: inDays(30) })
      const { date: first } = await db('games').where('id', 9001).first('date')
      await db('games').where('id', 9001).update({ date: inDays(37) })
      await db('games').where('id', 9001).update({ date: inDays(44) })
      const open = await rechecks({ game: 9001, status: 'pending' })
      expect(open).toHaveLength(1)
      expect(open[0].old_date).toEqual(first)

      await db('games').where('id', 9001).update({ date: first })
      expect(await rechecks({ game: 9001, status: 'pending' })).toEqual([])
    })

    it('a move after somebody answered, or after the question went out, asks again', async () => {
      await makeGame(9001, { scoreboard_member: null, scoreboard_duty_team: null })
      await db('games').where('id', 9001).update({ date: inDays(37) })
      await db('duty_rechecks').update({ status: 'confirmed', notified_at: new Date() })
      await db('games').where('id', 9001).update({ date: inDays(44) })
      expect(await rechecks({ status: 'pending' })).toHaveLength(1)

      await db('duty_rechecks').update({ notified_at: new Date() })
      await db('games').where('id', 9001).update({ date: inDays(51) })
      const rows = await rechecks()
      expect(rows.map((r) => r.status)).toEqual(['confirmed', 'superseded', 'pending'])
    })

    it('postponed says so and drops the question; back with a date asks again', async () => {
      await makeGame(9001, { scoreboard_member: null, scoreboard_duty_team: null })
      await db('games').where('id', 9001).update({ date: inDays(37) })
      await db('games').where('id', 9001).update({ status: 'postponed' })
      let rows = await rechecks()
      expect(rows.map((r) => [r.kind, r.reason, r.status])).toEqual([['ask', 'moved', 'superseded'], ['notice', 'postponed', 'info']])

      await db('games').where('id', 9001).update({ status: 'scheduled', date: inDays(50) })
      rows = await rechecks({ status: 'pending' })
      expect(rows.map((r) => r.kind)).toEqual(['ask'])
    })

    it('cancelled and back on, on the same date, asks again', async () => {
      await makeGame(9001, { scoreboard_member: null, scoreboard_duty_team: null })
      await db('games').where('id', 9001).update({ status: 'cancelled' })
      expect((await rechecks()).map((r) => r.reason)).toEqual(['cancelled'])
      await db('games').where('id', 9001).update({ status: 'scheduled' })
      expect(await rechecks({ status: 'pending' })).toHaveLength(1)
    })

    it('a switch to away releases; a row the other team adopts is not a switch', async () => {
      await makeGame(9001, { scoreboard_member: null, scoreboard_duty_team: null })
      await db('games').where('id', 9001).update({ type: 'away' })
      expect((await rechecks()).map((r) => r.reason)).toEqual(['became_away'])
      await db('duty_rechecks').del()

      await makeGame(9002, { scoreboard_member: null, scoreboard_duty_team: null })
      await db('games').where('id', 9002).update({ type: 'away', kscw_team: T.other })
      expect(await rechecks()).toEqual([])
    })

    it('a deleted game still tells its seats, even with the team notification silenced', async () => {
      await makeGame(9001, { scoreboard_member: null, scoreboard_duty_team: null })
      await db.transaction(async (trx) => {
        await trx.raw("SELECT set_config('kscw.skip_games_notify', 'on', true)")
        await trx('games').where('id', 9001).del()
      })
      const rows = await rechecks()
      expect(rows.map((r) => [r.reason, r.game, r.home_team])).toEqual([['deleted', null, 'KSCW T']])
    })

    it('a bulk writer can ask for silence', async () => {
      await makeGame(9001)
      await db.transaction(async (trx) => {
        await trx.raw("SELECT set_config('kscw.skip_duty_recheck', 'on', true)")
        await trx('games').where('id', 9001).update({ date: inDays(37) })
      })
      expect(await rechecks()).toEqual([])
    })

    it('a seat with a duty team and nobody on it tells that team, not the playing team', async () => {
      await makeGame(9001, { scorer_member: null, scoreboard_member: null })
      await db('games').where('id', 9001).update({ date: inDays(37) })
      expect((await rechecks()).map((r) => [r.kind, r.duty_team])).toEqual([['team_notice', T.duty]])

      await db('duty_rechecks').del()
      await makeGame(9002, { scorer_member: null, scoreboard_member: null, scorer_duty_team: T.game, scoreboard_duty_team: T.game })
      await db('games').where('id', 9002).update({ date: inDays(37) })
      expect(await rechecks()).toEqual([])
    })

    it('a broken queue never stops the game from being written', async () => {
      await makeGame(9001)
      await db.raw('ALTER TABLE duty_rechecks RENAME TO duty_rechecks_gone')
      try {
        await db('games').where('id', 9001).update({ time: '21:00' })
        expect((await db('games').where('id', 9001).first('time')).time).toBe('21:00:00')
      } finally {
        await db.raw('ALTER TABLE duty_rechecks_gone RENAME TO duty_rechecks')
      }
    })
  })

  describe('sending', () => {
    it('waits for the quiet period, then sends once, in the language of the person', async () => {
      await makeGame(9001, { scoreboard_member: null, scoreboard_duty_team: null })
      await db('games').where('id', 9001).update({ date: inDays(37) })
      await drain(ctx())
      expect(pushes).toEqual([])

      await flush()
      await drain(ctx())
      expect(pushes).toHaveLength(1)
      expect(pushes[0].ids).toEqual([M.holder])
      expect(pushes[0].title).toBe('Dein Einsatz wurde verschoben')
      expect(pushes[0].body).toContain('Schreiber')
      const bells = await db('notifications').where('member', M.holder)
      expect(bells.map((b) => b.title)).toEqual(['duty_recheck_ask'])
      expect(JSON.parse(bells[0].body).role).toBe('Schreiber')
      expect(mails.map((m) => m.to)).toEqual(['holder@example.test'])

      await flush()
      await drain(ctx())
      expect(pushes).toHaveLength(1)
    })

    it('somebody who handed the seat on before it went out is not asked', async () => {
      await makeGame(9001, { scoreboard_member: null, scoreboard_duty_team: null })
      await db('games').where('id', 9001).update({ date: inDays(37) })
      await db('games').where('id', 9001).update({ scorer_member: M.licensed })
      await flush()
      await drain(ctx())
      expect(pushes).toEqual([])
      expect((await rechecks())[0].status).toBe('superseded')
    })

    it('a switch to away clears the seat when it tells the person', async () => {
      await makeGame(9001, { scoreboard_member: null, scoreboard_duty_team: null })
      await db('games').where('id', 9001).update({ type: 'away' })
      await flush()
      await drain(ctx())
      expect((await db('games').where('id', 9001).first('scorer_member')).scorer_member).toBeNull()
      expect(pushes[0].title).toBe('Dein Einsatz entfällt')
    })

    it('a hall in the same building is a push without an email; postponed and off get an email', async () => {
      await makeGame(9001, { scoreboard_member: null, scoreboard_duty_team: null })
      await db('games').where('id', 9001).update({ hall: H.kwiB })
      await flush()
      await drain(ctx())
      expect(pushes.map((p) => p.title)).toEqual(['Neue Halle für deinen Einsatz'])
      expect(pushes[0].body).toContain('in KWI B')
      expect(mails).toEqual([])

      pushes.length = 0
      await db('games').where('id', 9001).update({ status: 'postponed' })
      await flush()
      await drain(ctx())
      expect(pushes.map((p) => p.title)).toEqual(['Spiel verschoben'])
      expect(mails.map((m) => m.to)).toEqual(['holder@example.test'])

      pushes.length = 0
      mails.length = 0
      await db('games').where('id', 9001).update({ status: 'scheduled' })
      await db('duty_rechecks').where('status', 'pending').del()
      await db('games').where('id', 9001).del()
      await flush()
      await drain(ctx())
      expect(pushes.map((p) => p.title)).toEqual(['Dein Einsatz entfällt'])
      expect(pushes[0].body).toContain('KSCW T – Gegner')
    })

    it('the duty team of an empty seat gets a push for its leaders', async () => {
      await makeGame(9001, { scorer_member: null, scoreboard_member: null })
      await db('games').where('id', 9001).update({ date: inDays(37) })
      await flush()
      await drain(ctx())
      expect(pushes.map((p) => [p.ids, p.title])).toEqual([[[M.dutyCoach], 'A duty game moved']])
      expect(mails).toEqual([])
    })

    it('holds a mass change, alerts once, and sends or drops on release', async () => {
      for (let i = 0; i < 21; i++) {
        await makeGame(9100 + i, { scoreboard_member: null, scoreboard_duty_team: null, game_id: `m_${i}` })
        await db('games').where('id', 9100 + i).update({ date: inDays(37) })
      }
      await flush()
      expect((await drain(ctx())).held).toBe(true)
      expect(pushes).toEqual([])
      expect(mails).toHaveLength(1)
      expect(mails[0].subject).toContain('21 moved home games held')

      await makeGame(9200, { scoreboard_member: null, scoreboard_duty_team: null, game_id: 'm_late' })
      await db('games').where('id', 9200).update({ date: inDays(37) })
      await flush()
      await drain(ctx())
      expect(pushes).toEqual([])
      expect(mails).toHaveLength(1)

      expect((await call('POST /admin/duty-recheck/release', { user: users.holder, body: { send: true } })).statusCode).toBe(403)
      const release = await call('POST /admin/duty-recheck/release', { user: users.coach, admin: true, body: { send: true } })
      expect(release.body.rows).toBe(22)
      await drain(ctx())
      expect(pushes.length).toBeGreaterThanOrEqual(21)
    })

    it('dropping a held batch asks nobody', async () => {
      for (let i = 0; i < 21; i++) {
        await makeGame(9100 + i, { scoreboard_member: null, scoreboard_duty_team: null, game_id: `m_${i}` })
        await db('games').where('id', 9100 + i).update({ date: inDays(37) })
      }
      await flush()
      await drain(ctx())
      await call('POST /admin/duty-recheck/release', { user: users.coach, admin: true, body: { send: false } })
      await drain(ctx())
      expect(pushes).toEqual([])
      expect(await rechecks({ status: 'pending' })).toEqual([])
    })
  })

  /** Moved, sent, and the holder's question id. */
  async function asked(gameId = 9001, extra = {}) {
    await makeGame(gameId, { scoreboard_member: null, scoreboard_duty_team: null, ...extra })
    await db('games').where('id', gameId).update({ date: inDays(37) })
    await flush()
    await drain(ctx())
    pushes.length = 0
    mails.length = 0
    return Number((await db('duty_rechecks').where({ game: gameId, kind: 'ask', status: 'pending' }).first('id')).id)
  }
  const answer = (id, who, value, extra = {}) => call('POST /duty-recheck/:id/answer', {
    user: users[who], params: { id: String(id) }, body: { answer: value }, ...extra,
  })
  const claim = (who, gameId = 9001, role = 'scorer') => call('POST /games/:id/duty-claim', {
    user: users[who], params: { id: String(gameId) }, body: { role },
  })

  describe('answering', () => {
    it('"I can" keeps the seat and tells nobody', async () => {
      const id = await asked()
      const res = await answer(id, 'holder', 'yes')
      expect(res.body).toEqual({ ok: true, status: 'confirmed' })
      expect((await db('games').where('id', 9001).first('scorer_member')).scorer_member).toBe(M.holder)
      expect(pushes).toEqual([])
    })

    it('"I can\'t" empties the seat and tells both teams\' leaders, not the person', async () => {
      const id = await asked(9001, { scorer_confirmed_by_name: 'holder Test', scorer_confirmed_at: new Date() })
      await db('scorer_delegations').insert({ game: 9001, role: 'scorer', from_member: M.holder, to_member: M.licensed, from_team: T.duty, to_team: T.other, status: 'pending' })
      const res = await answer(id, 'holder', 'no')
      expect(res.body).toEqual({ ok: true, status: 'refused' })
      const g = await db('games').where('id', 9001).first('scorer_member', 'scorer_confirmed_by_name', 'scorer_confirmed_at', 'scorer_duty_team')
      expect(g).toEqual({ scorer_member: null, scorer_confirmed_by_name: null, scorer_confirmed_at: null, scorer_duty_team: T.duty })
      expect(pushes.flatMap((p) => p.ids).sort()).toEqual([M.coach, M.tr, M.dutyCoach].sort())
      expect(mails.map((m) => m.to).sort()).toEqual(['coach@example.test', 'dutyCoach@example.test'.toLowerCase(), 'tr@example.test'].sort())
      expect(mails[0].text).toContain('holder Test can\'t do Scorer')
      expect((await db('scorer_delegations').where('game', 9001).first('status')).status).toBe('expired')
      expect(await db('user_logs').where('record_id', '9001').pluck('action')).toContain('duty-recheck')
    })

    it('only the person asked can answer, not while acting, and only once', async () => {
      const id = await asked()
      expect((await answer(id, 'outsider', 'no')).statusCode).toBe(403)
      expect((await answer(id, 'holder', 'no', { guardian: { memberId: 1 } })).statusCode).toBe(403)
      expect((await answer(id, 'holder', 'maybe')).statusCode).toBe(400)
      expect((await db('games').where('id', 9001).first('scorer_member')).scorer_member).toBe(M.holder)
      await answer(id, 'holder', 'yes')
      expect((await answer(id, 'holder', 'no')).statusCode).toBe(409)
    })

    it('a seat handed on meanwhile cannot be refused any more', async () => {
      const id = await asked()
      await db('games').where('id', 9001).update({ scorer_member: M.licensed })
      expect((await answer(id, 'holder', 'no')).body.code).toBe('seat_taken')
      expect((await db('games').where('id', 9001).first('scorer_member')).scorer_member).toBe(M.licensed)
    })
  })

  describe('the seat open to everybody', () => {
    it('a stranger can\'t claim before the refusal, and can after; the duty moves to their team', async () => {
      const id = await asked()
      await db('games').where('id', 9001).update({ scorer_member: null })
      await db('duty_rechecks').where('id', id).update({ status: 'superseded' })
      expect((await claim('licensed')).statusCode).toBe(403)

      await db('games').where('id', 9001).update({ scorer_member: M.holder })
      await db('duty_rechecks').where('id', id).update({ status: 'pending' })
      await answer(id, 'holder', 'no')
      pushes.length = 0
      const res = await claim('licensed')
      expect(res.statusCode).toBe(200)
      const g = await db('games').where('id', 9001).first('scorer_member', 'scorer_duty_team')
      expect(g).toEqual({ scorer_member: M.licensed, scorer_duty_team: T.other })
      expect(pushes.flatMap((p) => p.ids).sort()).toEqual([M.coach, M.tr].sort())
    })

    it('the licence still counts, and nobody officiates a game they play in', async () => {
      await answer(await asked(), 'holder', 'no')
      expect((await claim('outsider')).statusCode).toBe(403)
      await db('members').where('id', M.player).update({ scorer_vb: true })
      expect((await claim('player')).body.code).toBe('plays_this_game')
      await db('members').where('id', M.inactive).update({ scorer_vb: true })
      expect((await claim('inactive')).statusCode).toBe(403)
    })

    it('a seat with no licence is open to literally anybody else, with no team at all', async () => {
      await makeGame(9001, { scorer_member: null, scorer_duty_team: null })
      await db('games').where('id', 9001).update({ date: inDays(37) })
      await flush()
      await drain(ctx())
      const { id } = await db('duty_rechecks').where({ game: 9001, kind: 'ask' }).first('id')
      await answer(id, 'tafeler', 'no')
      const res = await claim('stranger', 9001, 'scoreboard')
      expect(res.statusCode).toBe(200)
      const g = await db('games').where('id', 9001).first('scoreboard_member', 'scoreboard_duty_team')
      expect(g).toEqual({ scoreboard_member: M.stranger, scoreboard_duty_team: T.duty })
    })

    it('a player who said No to the game may take the seat', async () => {
      await answer(await asked(), 'holder', 'no')
      await db('members').where('id', M.player).update({ scorer_vb: true })
      await db('participations').insert({ activity_type: 'game', activity_id: '9001', member: M.player, status: 'declined', note: '', guest_count: 0 })
      expect((await claim('player')).statusCode).toBe(200)
    })

    it('a clash still stops the claim', async () => {
      await answer(await asked(), 'holder', 'no')
      const { date } = await db('games').where('id', 9001).first('date')
      await makeGame(9002, { date, time: '20:30', scorer_member: M.licensed, scoreboard_member: null, game_id: 't_other' })
      expect((await claim('licensed')).body.code).toBe('duty_clash')
    })
  })

  describe('the replacement', () => {
    const invite = (who, target, gameId = 9001, role = 'scorer') => call('POST /duty-recheck/invite', {
      user: users[who], body: { game: gameId, role, member: M[target] },
    })

    it('only the game team\'s leaders can ask, and only for a refused seat', async () => {
      const id = await asked()
      expect((await invite('coach', 'licensed')).body.code).toBe('seat_taken')
      await answer(id, 'holder', 'no')
      expect((await invite('dutyCoach', 'licensed')).statusCode).toBe(403)
      expect((await invite('outsider', 'licensed')).statusCode).toBe(403)
      expect((await invite('coach', 'outsider')).body.code).toBe('missing_licence')
      expect((await invite('tr', 'licensed')).statusCode).toBe(200)
    })

    it('the person is asked and must accept; accepting fills the seat and closes other requests', async () => {
      await answer(await asked(), 'holder', 'no')
      await db('members').where('id', M.stranger).update({ scorer_vb: true })
      await invite('coach', 'licensed')
      await invite('coach', 'stranger')
      expect((await db('games').where('id', 9001).first('scorer_member')).scorer_member).toBeNull()
      pushes.length = 0
      await drain(ctx())
      expect(pushes.map((p) => p.title)).toEqual(['Can you take a duty?', 'Can you take a duty?'])
      expect(pushes[0].body).toContain('coach Test asks whether you can do Scorer')

      const home = await call('GET /duty-recheck/home', { user: users.licensed })
      const q = home.body.questions[0]
      expect(q).toMatchObject({ kind: 'invite', role: 'scorer', by: 'coach Test', hall: 'KWI A' })

      pushes.length = 0
      expect((await answer(q.id, 'licensed', 'yes')).body.status).toBe('confirmed')
      const g = await db('games').where('id', 9001).first('scorer_member', 'scorer_duty_team', 'scorer_confirmed_by_name')
      expect(g).toEqual({ scorer_member: M.licensed, scorer_duty_team: T.other, scorer_confirmed_by_name: 'licensed Test' })
      expect((await db('duty_rechecks').where({ member: M.stranger, kind: 'invite' }).first('status')).status).toBe('superseded')
      expect(pushes.map((p) => p.title)).toEqual(['Duty filled', 'Duty filled'])
    })

    it('no tells whoever asked, and the seat stays open', async () => {
      await answer(await asked(), 'holder', 'no')
      await invite('coach', 'licensed')
      await drain(ctx())
      pushes.length = 0
      const { id } = await db('duty_rechecks').where({ member: M.licensed, kind: 'invite' }).first('id')
      await answer(id, 'licensed', 'no')
      expect(pushes.map((p) => [p.ids, p.title])).toEqual([[[M.coach], 'Request declined']])
      expect((await claim('licensed')).statusCode).toBe(200)
    })

    it('the candidate list has the licensed, without the players, with clashes marked', async () => {
      await answer(await asked(), 'holder', 'no')
      await db('members').where('id', M.player).update({ scorer_vb: true })
      const { date } = await db('games').where('id', 9001).first('date')
      await makeGame(9002, { date, time: '20:30', scorer_member: M.licensed, scoreboard_member: null, game_id: 't_other' })
      expect((await call('GET /duty-recheck/candidates', { user: users.outsider, query: { game: '9001', role: 'scorer' } })).statusCode).toBe(403)
      const res = await call('GET /duty-recheck/candidates', { user: users.coach, query: { game: '9001', role: 'scorer' } })
      const mine = res.body.data.filter((c) => Object.values(M).includes(c.id))
      expect(mine.map((c) => [c.id, c.clash, c.teams]).sort()).toEqual([
        [M.holder, false, 'Duty team'], [M.licensed, true, 'Other team'],
      ].sort())
      const search = await call('GET /duty-recheck/candidates', { user: users.coach, query: { game: '9001', role: 'scoreboard', q: 'strang' } })
      expect(search.body.data.map((c) => c.id)).toEqual([M.stranger])
    })
  })

  describe('the home page', () => {
    const home = async (who) => (await call('GET /duty-recheck/home', { user: users[who] })).body

    it('asks only once the message went out, and shows old and new', async () => {
      await makeGame(9001, { scoreboard_member: null, scoreboard_duty_team: null })
      await db('games').where('id', 9001).update({ date: inDays(37), hall: H.other })
      expect((await home('holder')).questions).toEqual([])
      await flush()
      await drain(ctx())
      const { questions } = await home('holder')
      expect(questions).toHaveLength(1)
      expect(questions[0]).toMatchObject({ kind: 'ask', role: 'scorer', hall: 'Döltschi', team: 'Game team' })
      expect(questions[0].was).toMatch(/^\d\d\.\d\d\.\d{4}, 20:00 · KWI A$/)
    })

    it('marks a clash on the new date, ignoring the seat itself', async () => {
      const id = await asked()
      const { date } = await db('games').where('id', 9001).first('date')
      await makeGame(9002, { date, time: '20:30', scoreboard_member: M.holder, scorer_member: null, game_id: 't_other' })
      const { questions } = await home('holder')
      expect(questions.find((q) => q.id === id).clash).toBe(true)
    })

    it('an open seat shows for who could take it, and leaders see what to fill', async () => {
      await answer(await asked(), 'holder', 'no')
      expect((await home('licensed')).open_seats.map((s) => s.role)).toEqual(['scorer'])
      expect((await home('outsider')).open_seats).toEqual([])
      expect((await home('player')).open_seats).toEqual([])
      expect((await home('coach')).to_fill.map((s) => [s.role, s.state])).toEqual([['scorer', 'open']])
      expect((await home('dutyCoach')).to_fill).toEqual([])
      await claim('licensed')
      expect((await home('licensed')).open_seats).toEqual([])
      expect((await home('coach')).to_fill).toEqual([])
    })

    it('nothing while acting for somebody else', async () => {
      await asked()
      const res = await call('GET /duty-recheck/home', { user: users.holder, guardian: { memberId: 1 } })
      expect(res.body).toEqual({ questions: [], open_seats: [], to_fill: [] })
    })
  })

  describe('follow-ups', () => {
    it('one reminder after two days', async () => {
      await asked()
      await followUps(ctx())
      expect(pushes).toEqual([])
      await db('duty_rechecks').update({ notified_at: db.raw(`now() - interval '49 hours'`) })
      await followUps(ctx())
      expect(pushes.map((p) => p.title)).toEqual(['Deine Antwort fehlt'])
      await followUps(ctx())
      expect(pushes).toHaveLength(1)
    })

    it('leaders are warned 5 days before the game, once, and the person keeps the seat', async () => {
      await asked()
      await followUps(ctx())
      expect(pushes).toEqual([])
      await db('games').where('id', 9001).update({ date: inDays(4) })
      await db('duty_rechecks').where('status', 'pending').orderBy('id', 'desc')
      await drain(ctx())
      pushes.length = 0
      const rows = await db('duty_rechecks').where('status', 'pending')
      await db('duty_rechecks').whereIn('id', rows.map((r) => r.id)).update({ notified_at: new Date() })
      await followUps(ctx())
      expect(pushes.map((p) => p.title).sort()).toEqual(['No answer yet', 'No answer yet'])
      expect((await db('games').where('id', 9001).first('scorer_member')).scorer_member).toBe(M.holder)
      await followUps(ctx())
      expect(pushes).toHaveLength(2)
      const { to_fill } = (await call('GET /duty-recheck/home', { user: users.coach })).body
      expect(to_fill.map((s) => [s.state, s.holder])).toEqual([['silent', 'holder Test']])
    })

    it('a question whose game is gone or whose seat moved on is closed', async () => {
      const id = await asked()
      await db('games').where('id', 9001).update({ scorer_member: M.licensed })
      const c = await followUps(ctx())
      expect(c.closed).toBe(1)
      expect((await db('duty_rechecks').where('id', id).first('status')).status).toBe('superseded')
    })

    it('an empty refused seat: 72 hours, then 24 with the TK, each once', async () => {
      const id = await asked()
      await answer(id, 'holder', 'no')
      await db('duty_rechecks').where('id', id).update({ answered_at: db.raw(`now() - interval '20 days'`) })
      pushes.length = 0
      mails.length = 0
      await followUps(ctx())
      expect(pushes).toEqual([])

      const zurich = (hours) => db.raw(`((now() + make_interval(hours => ?)) AT TIME ZONE 'Europe/Zurich')`, [hours])
      const at = async (hours) => {
        await db('games').where('id', 9001).update({ date: db.raw('(?)::date', [zurich(hours)]), time: db.raw('(?)::time', [zurich(hours)]) })
        await db('duty_rechecks').where('kind', 'ask').where('status', 'pending').del()
      }
      await at(60)
      await followUps(ctx())
      expect(pushes.map((p) => p.title)).toEqual(['Duty still open', 'Duty still open'])
      await followUps(ctx())
      expect(pushes).toHaveLength(2)

      pushes.length = 0
      await at(20)
      await db('members').where('id', M.tr).update({ role: JSON.stringify(['vb_admin']) })
      mails.length = 0
      await followUps(ctx())
      expect(pushes.map((p) => p.title)).toEqual(['Duty still open', 'Duty still open'])
      await followUps(ctx())
      expect(pushes).toHaveLength(2)
    })

    it('a refusal inside the window does not call again right after', async () => {
      const id = await asked()
      await db('games').where('id', 9001).update({ date: inDays(2) })
      const open = await db('duty_rechecks').whereNot('id', id).where({ status: 'pending', kind: 'ask' }).first('id')
      await db('duty_rechecks').where('id', open.id).update({ notified_at: new Date() })
      await answer(open.id, 'holder', 'no')
      pushes.length = 0
      await followUps(ctx())
      expect(pushes).toEqual([])
    })
  })

  describe('the late alarm', () => {
    const nowPlus = (min) => db.raw(`((now() + make_interval(mins => ?)) AT TIME ZONE 'Europe/Zurich')`, [min])
    const soon = (gameId) => db('games').where('id', gameId).update({ date: db.raw('(?)::date', [nowPlus(10)]), time: db.raw('(?)::time', [nowPlus(10)]) })
    const flag = (gameId) => call('POST /games/:id/duty-late', { user: users.coach, params: { id: String(gameId) }, body: { role: 'scorer' } })
    const fines = () => db('fines').where({ member: M.holder, category: 'no_show' })

    it('fines nobody whose question is still open', async () => {
      await makeGame(9001, { scoreboard_member: null, scoreboard_duty_team: null })
      await soon(9001)
      expect(await db('duty_rechecks').where({ game: 9001, status: 'pending' })).toHaveLength(1)
      const res = await flag(9001)
      expect(res.statusCode).toBe(200)
      expect(await fines()).toEqual([])
    })

    it('still fines somebody who said "I can"', async () => {
      await makeGame(9001, { scoreboard_member: null, scoreboard_duty_team: null })
      await soon(9001)
      await db('duty_rechecks').where({ game: 9001 }).update({ status: 'confirmed' })
      const res = await flag(9001)
      expect(res.statusCode).toBe(200)
      expect(await fines()).toHaveLength(1)
    })
  })
})
