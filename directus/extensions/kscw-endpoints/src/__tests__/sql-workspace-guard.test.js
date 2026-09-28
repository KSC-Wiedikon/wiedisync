/**
 * Unit tests for the SQL workspace's read-only guard lexer (splitStatements +
 * leadingKeyword). Every way the splitter disagrees with Postgres's own lexer is
 * a way to hide a second statement — e.g. `COMMIT; WITH d AS (DELETE …)` — from
 * the read-only check (2026-09-28 audit). Hermetic, no DB.
 */
import { describe, it, expect } from 'vitest'
import { splitStatements, leadingKeyword } from '../sql-workspace.js'

const kws = (sql) => splitStatements(sql).map(leadingKeyword)

describe('splitStatements', () => {
  it('splits plain statements and ignores ; in strings, identifiers and comments', () => {
    expect(kws('SELECT 1; SELECT 2')).toEqual(['SELECT', 'SELECT'])
    expect(kws(`SELECT 'a;b', "x;y" FROM t -- ;\n`)).toEqual(['SELECT'])
  })

  it('does not treat E-string backslash escapes as a string end', () => {
    expect(kws(`SELECT E'\\''; COMMIT; DELETE FROM x --'`)).toEqual(['SELECT', 'COMMIT', 'DELETE'])
  })

  it('honours dollar quotes but not $1 params or a$b identifiers', () => {
    expect(kws(`SELECT $a$ ' $a$; COMMIT`)).toEqual(['SELECT', 'COMMIT'])
    expect(kws('SELECT $1, a$b FROM t; END')).toEqual(['SELECT', 'END'])
  })

  it('nests block comments like Postgres', () => {
    expect(kws(`/* /* */ ' */ ; COMMIT; --'`)).toEqual(['COMMIT'])
    expect(kws('/* /* */ */ COMMIT')).toEqual(['COMMIT'])
  })

  it('drops comment-only chunks', () => {
    expect(kws('SELECT 1; -- done')).toEqual(['SELECT'])
  })

  it('refuses unterminated literals instead of guessing', () => {
    for (const bad of [`SELECT 'x`, 'SELECT "x', 'SELECT $q$ x', '/* x', `SELECT E'\\'`]) {
      expect(() => splitStatements(bad)).toThrow()
    }
  })
})
