/**
 * Home game → another team's training: cancel, shorten or leave alone.
 *
 * The rule is SQL. The first block always runs and pins the one thing that breaks
 * silently: pass 1b (restore) and pass 2 (cancel) must use the same condition, or
 * every sweep flips the rows and bells the team again.
 *
 * The rest needs a Postgres; set GAME_SWEEP_TEST_PG to a running container, e.g.
 *   docker run -d --rm --name game-sweep-pg -e POSTGRES_PASSWORD=x postgres:16
 *   GAME_SWEEP_TEST_PG=game-sweep-pg npx vitest run directus/extensions/kscw-hooks/src/__tests__/game-training-shorten.test.js
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  sweepGameTrainingShorten, BLOCK_LEAVES_TOO_LITTLE, MIN_REMAINING_MINUTES,
} from '../game-training-shorten.js'

const log = { info() {}, warn() {}, error() {} }

describe('pass 1b and pass 2 agree', () => {
  it('both use the same condition with the same floor', async () => {
    const calls = []
    const raw = async (sql, bindings) => { calls.push({ sql, bindings }); return { rowCount: 0 } }
    await sweepGameTrainingShorten({ raw, transaction: (fn) => fn({ raw }) }, log)

    const restore = calls.find((c) => /SET cancelled = false/.test(c.sql))
    const cancel = calls.find((c) => /cover AS/.test(c.sql))
    for (const pass of [restore, cancel]) {
      expect(pass.sql).toContain(BLOCK_LEAVES_TOO_LITTLE)
      expect(pass.bindings.minRemaining).toBe(MIN_REMAINING_MINUTES)
    }
    expect(MIN_REMAINING_MINUTES).toBe(30)
  })
})

const PG = process.env.GAME_SWEEP_TEST_PG

const psql = (sql, ...flags) => execFileSync(
  'docker', ['exec', '-i', PG, 'psql', '-U', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', ...flags],
  { input: sql, encoding: 'utf8' },
)

/** knex's raw() over psql: named bindings inlined, rowCount read from the command tag. */
const pgDb = () => {
  const raw = async (sql, bindings = {}) => {
    const inlined = sql.replace(/(?<!:):(\w+)/g, (m, k) => (k in bindings ? bindings[k] : m))
    return { rowCount: Number(psql(`${inlined};`).match(/UPDATE (\d+)/)?.[1] ?? 0) }
  }
  return { raw, transaction: (fn) => fn({ raw }) }
}

const OWN_TEAM = 1
const OTHER_TEAM = 2
const OTHER_SPORT_TEAM = 3
const GAME = 100

// A 20:00 game blocks the hall 19:15–21:45.
const TRAININGS = {
  runsPastGame: { start: '20:30', end: '22:00' },
  tooLittleBefore: { start: '19:00', end: '20:30' },
  insideBlock: { start: '19:30', end: '21:30' },
  enoughBefore: { start: '18:00', end: '19:30' },
  exactlyEnoughBefore: { start: '18:45', end: '19:45' },
  exactlyEnoughAfter: { start: '20:30', end: '22:15' },
  tooLittleBeforeEnoughAfter: { start: '19:00', end: '22:30' },
  endsAsBlockStarts: { start: '17:00', end: '19:15' },
  startsAsBlockEnds: { start: '21:45', end: '23:00' },
  otherSportEnoughBefore: { start: '18:00', end: '19:30', team: OTHER_SPORT_TEAM },
  otherSportTooLittleBefore: { start: '19:00', end: '20:30', team: OTHER_SPORT_TEAM },
  otherSportInsideBlock: { start: '19:30', end: '21:30', team: OTHER_SPORT_TEAM },
  reinstated: { start: '20:30', end: '22:00', marker: GAME },
  ownedByBooking: { start: '20:30', end: '22:00', booking: "'calendar:1'" },
  ownGameDay: { start: '19:00', end: '20:30', team: OWN_TEAM },
}
const NAMES = Object.keys(TRAININGS)

const readAll = () => Object.fromEntries(
  JSON.parse(psql(`SELECT COALESCE(json_agg(json_build_object(
      'id', id, 'cancelled', cancelled, 'end', left(end_time::text, 5),
      'original', left(original_end_time::text, 5), 'marker', auto_shortened_by_game
    )), '[]') FROM trainings`, '-At'))
    .map(({ id, ...row }) => [NAMES[id], row]),
)

const live = (end, marker = null) => ({ cancelled: false, end, original: null, marker })
const cancelledBy = (end, marker = GAME) => ({ cancelled: true, end, original: null, marker })
const shortened = (end, original) => ({ cancelled: false, end, original, marker: GAME })

describe.skipIf(!PG)('sweep against Postgres, 20:00 home game', () => {
  beforeEach(() => {
    const rows = NAMES.map((name, id) => {
      const t = TRAININGS[name]
      return `(${id}, CURRENT_DATE + 7, '${t.start}', '${t.end}', ${t.team ?? OTHER_TEAM}, 1, ${t.marker ?? 'NULL'}, ${t.booking ?? 'NULL'})`
    })
    psql(`
      DROP SCHEMA public CASCADE; CREATE SCHEMA public;
      CREATE TABLE teams (id int PRIMARY KEY, name text, sport text);
      CREATE TABLE halls (id int PRIMARY KEY, name text);
      CREATE TABLE games (id int PRIMARY KEY, date date, "time" time, type text, status text, kscw_team int, hall int, additional_halls json);
      CREATE TABLE trainings (id int PRIMARY KEY, date date, start_time time, end_time time, cancelled boolean NOT NULL DEFAULT false,
        team int, hall int, auto_shortened_by_game int, original_end_time time, auto_adjusted_by_booking text, original_start_time time);
      INSERT INTO teams VALUES (${OWN_TEAM}, 'Game team', 'volleyball'), (${OTHER_TEAM}, 'Training team', 'volleyball'), (${OTHER_SPORT_TEAM}, 'Basketball', 'basketball');
      INSERT INTO halls VALUES (1, 'Hall 1'), (2, 'Hall 2');
      INSERT INTO games VALUES (${GAME}, CURRENT_DATE + 7, '20:00', 'home', 'scheduled', ${OWN_TEAM}, 1, NULL);
      INSERT INTO trainings (id, date, start_time, end_time, team, hall, auto_shortened_by_game, auto_adjusted_by_booking) VALUES ${rows.join(',')};
    `, '-q')
  })

  it('cancels what keeps under 30 minutes, shortens what keeps 30, leaves the rest', async () => {
    await sweepGameTrainingShorten(pgDb(), log)
    expect(readAll()).toEqual({
      runsPastGame: cancelledBy('22:00'),
      tooLittleBefore: cancelledBy('20:30'),
      insideBlock: cancelledBy('21:30'),
      enoughBefore: shortened('19:15', '19:30'),
      exactlyEnoughBefore: shortened('19:15', '19:45'),
      exactlyEnoughAfter: live('22:15'),
      tooLittleBeforeEnoughAfter: live('22:30'),
      endsAsBlockStarts: live('19:15'),
      startsAsBlockEnds: live('23:00'),
      otherSportEnoughBefore: shortened('19:15', '19:30'),
      otherSportTooLittleBefore: live('20:30'),
      otherSportInsideBlock: live('21:30'),
      reinstated: live('22:00', GAME),
      ownedByBooking: live('22:00'),
      ownGameDay: cancelledBy('20:30'),
    })
  })

  it('changes nothing on the next run', async () => {
    const db = pgDb()
    await sweepGameTrainingShorten(db, log)
    const before = readAll()
    expect(await sweepGameTrainingShorten(db, log)).toEqual({
      restored: 0, uncancelled: 0, cancelled: 0, shortened: 0, ownCancelled: 0,
    })
    expect(readAll()).toEqual(before)
  })

  it('gives everything back when the game leaves the hall', async () => {
    const db = pgDb()
    await sweepGameTrainingShorten(db, log)
    psql(`UPDATE games SET hall = 2 WHERE id = ${GAME}`, '-q')
    await sweepGameTrainingShorten(db, log)
    const after = readAll()
    expect(after.runsPastGame).toEqual(live('22:00'))
    expect(after.tooLittleBefore).toEqual(live('20:30'))
    expect(after.insideBlock).toEqual(live('21:30'))
    expect(after.enoughBefore).toEqual(live('19:30'))
    expect(after.otherSportEnoughBefore).toEqual(live('19:30'))
    // The reinstate's marker is released, so a later game can act on it again.
    expect(after.reinstated).toEqual(live('22:00'))
    // Still the team's own game day, wherever the game is.
    expect(after.ownGameDay).toEqual(cancelledBy('20:30'))
  })

  it('cancels a shortened training on its planned end when the game moves earlier', async () => {
    const db = pgDb()
    await sweepGameTrainingShorten(db, log)
    psql(`UPDATE games SET "time" = '19:00' WHERE id = ${GAME}`, '-q')
    await sweepGameTrainingShorten(db, log)
    expect(readAll().enoughBefore).toEqual(cancelledBy('19:30'))
  })
})
