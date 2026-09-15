/**
 * season-health-sql.js + the registry contract — pure functions, no DB.
 *
 *   • renderSql turns every {{token}} into the right SQL literal and refuses
 *     a token it does not know (a typo must fail at boot, not at 03:00).
 *   • seasonContext agrees with season.js across the Jun 1 rollover, in
 *     Zurich time (the VPS runs UTC — the old copies flipped two hours early).
 *   • assertRegistry rejects the three mistakes the header warns about.
 *   • The shipped registry passes its own contract and renders cleanly.
 */
import { describe, it, expect } from 'vitest'
import { renderSql, seasonContext } from '../season-health-sql.js'
import { currentSeasonShort, seasonRolloverDate, seasonStartDate, seasonEndDate } from '../season.js'
import { assertRegistry, CHECKS, TABLES } from '../season-health-checks.js'

// 2026-09-15 14:20 UTC = 16:20 Zurich (CEST).
const FIXED = new Date('2026-09-15T14:20:00Z')
const CTX = seasonContext(FIXED)

describe('seasonContext', () => {
  it('produces the five anchors for a fixed instant, Zurich wall-clock', () => {
    expect(CTX).toEqual({
      season: '2026/27',
      rollover: '2026-06-01',
      season_start: '2026-09-01',
      season_end: '2027-05-31',
      today: '2026-09-15',
      now: '2026-09-15 16:20:00',
    })
  })

  it('agrees with season.js on both sides of the Jun 1 boundary', () => {
    // 23:30 Zurich on May 31 (21:30 UTC) is still last season; 00:30 Zurich on
    // Jun 1 (22:30 UTC, i.e. still May 31 in UTC) is already the new one.
    const before = new Date('2026-05-31T21:30:00Z')
    const after = new Date('2026-05-31T22:30:00Z')
    for (const now of [before, after]) {
      const ctx = seasonContext(now)
      expect(ctx.season).toBe(currentSeasonShort(now))
      expect(ctx.rollover).toBe(seasonRolloverDate(now))
      expect(ctx.season_start).toBe(seasonStartDate(now))
      expect(ctx.season_end).toBe(seasonEndDate(now))
    }
    expect(seasonContext(before)).toMatchObject({ season: '2025/26', rollover: '2025-06-01', season_end: '2026-05-31', today: '2026-05-31' })
    expect(seasonContext(after)).toMatchObject({ season: '2026/27', rollover: '2026-06-01', season_end: '2027-05-31', today: '2026-06-01' })
  })

  it('renders midnight as 00, never 24', () => {
    // 22:00 UTC on Sep 14 = 00:00 Zurich on Sep 15.
    expect(seasonContext(new Date('2026-09-14T22:00:00Z')).now).toBe('2026-09-15 00:00:00')
  })
})

describe('renderSql', () => {
  it('renders every token as the right literal, repeated tokens included', () => {
    const sql = `SELECT {{season}} AS s, {{rollover}} AS r, {{season_start}} AS ss, {{season_end}} AS se,
                        {{today}} AS t, {{now}} AS n WHERE x >= {{rollover}} AND y = {{season}}`
    expect(renderSql(sql, CTX)).toBe(
      `SELECT '2026/27' AS s, DATE '2026-06-01' AS r, DATE '2026-09-01' AS ss, DATE '2027-05-31' AS se,
                        DATE '2026-09-15' AS t, TIMESTAMP '2026-09-15 16:20:00' AS n WHERE x >= DATE '2026-06-01' AND y = '2026/27'`,
    )
  })

  it('leaves everything else alone — casts, string literals, jsonb operators', () => {
    const sql = `SELECT m.role ? 'superuser', btrim(m.license_nr)::bigint, to_char(g.time, 'HH24:MI') FROM members m WHERE m."user" IS NOT NULL`
    expect(renderSql(sql, CTX)).toBe(sql)
  })

  it('throws on an unknown token instead of shipping it to Postgres', () => {
    expect(() => renderSql('SELECT 1 WHERE d >= {{season_begin}}', CTX)).toThrow(/unknown SQL token \{\{season_begin\}\}/)
    expect(() => renderSql('SELECT {{ season }}', CTX)).toThrow(/unknown SQL token/)
    expect(() => renderSql('SELECT {{}}', CTX)).toThrow(/unknown SQL token/)
  })

  it('escapes a quote in a value rather than trusting it', () => {
    expect(renderSql('SELECT {{season}}', { ...CTX, season: "20'26" })).toBe("SELECT '20''26'")
  })

  it('defaults to the current season context', () => {
    expect(renderSql('SELECT {{season}}')).toBe(`SELECT '${currentSeasonShort()}'`)
  })
})

// ── assertRegistry ────────────────────────────────────────────────────────
const good = (over = {}) => ({
  key: 'vb_licence_missing', section: 'players', sport: 'vb', severity: 'error', grain: 'player',
  title: 'Licence missing', description: 'No licence for this season.',
  sql: `SELECT m.id AS member_id FROM members m WHERE m.licence_status_season IS DISTINCT FROM {{season}} ORDER BY m.id`,
  ...over,
})

describe('assertRegistry', () => {
  it('accepts a well-formed registry', () => {
    expect(() => assertRegistry([good(), good({ key: 'bb_other', sport: 'bb' })])).not.toThrow()
  })

  it('rejects a duplicate key', () => {
    expect(() => assertRegistry([good(), good()])).toThrow(/duplicate key/)
  })

  it('rejects a malformed key and a bad enum value', () => {
    expect(() => assertRegistry([good({ key: 'Bad-Key' })])).toThrow(/bad key/)
    expect(() => assertRegistry([good({ section: 'misc' })])).toThrow(/bad section/)
    expect(() => assertRegistry([good({ sport: 'volleyball' })])).toThrow(/bad sport/)
    expect(() => assertRegistry([good({ severity: 'critical' })])).toThrow(/bad severity/)
    expect(() => assertRegistry([good({ grain: 'member' })])).toThrow(/bad grain/)
    expect(() => assertRegistry([good({ title: '' })])).toThrow(/missing title/)
    expect(() => assertRegistry([good({ description: undefined })])).toThrow(/missing description/)
    expect(() => assertRegistry([good({ sql: 'UPDATE members SET x = 1' })])).toThrow(/missing sql/)
  })

  it('rejects a :named bind but tolerates ::casts and time-format literals', () => {
    expect(() => assertRegistry([good({ sql: 'SELECT m.id FROM members m WHERE m.season = :season' })])).toThrow(/:named bind/)
    expect(() => assertRegistry([good({ sql: `SELECT btrim(m.license_nr)::bigint, to_char(g.time, 'HH24:MI'), g.date::text FROM members m` })])).not.toThrow()
  })

  it("rejects a 'both' check that neither selects sport, names memberIdColumn nor is club grain", () => {
    const both = good({ sport: 'both', sql: 'SELECT m.id AS member_id FROM members m' })
    expect(() => assertRegistry([both])).toThrow(/never selects a sport column/)
    expect(() => assertRegistry([{ ...both, memberIdColumn: 'member_id' }])).not.toThrow()
    expect(() => assertRegistry([{ ...both, grain: 'club' }])).not.toThrow()
    expect(() => assertRegistry([{ ...both, sql: 'SELECT m.id AS member_id, lower(t.sport) AS sport FROM members m JOIN teams t ON true' }])).not.toThrow()
  })
})

describe('the shipped registry', () => {
  it('passes its own contract', () => {
    expect(() => assertRegistry()).not.toThrow()
  })

  it('renders every statement without a leftover token', () => {
    for (const c of CHECKS) expect(() => renderSql(c.sql, CTX), c.key).not.toThrow()
    for (const [name, sql] of Object.entries(TABLES)) {
      expect(typeof sql, name).toBe('string')
      expect(() => renderSql(sql, CTX), name).not.toThrow()
    }
  })

  it('never carries a LIMIT — the runner caps', () => {
    for (const c of CHECKS) expect(c.sql, c.key).not.toMatch(/\bLIMIT\s+\d+\s*;?\s*$/i)
  })
})
