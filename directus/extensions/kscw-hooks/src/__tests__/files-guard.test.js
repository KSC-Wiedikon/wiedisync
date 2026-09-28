/**
 * Website audit 2026-09-28, F-03 — anonymous callers may read a file by id
 * (upload read-back, GET /files/<id>) but may not LIST directus_files.
 */
import { describe, it, expect } from 'vitest'
import { guardAnonymousFileQuery, isPinnedFileQuery, registerFilesGuard } from '../files-guard.js'

const ANON = { accountability: { user: null, role: null, admin: false } }
const MEMBER = { accountability: { user: 'u1', role: 'r1', admin: false } }
const ID = '0069917c-e1d5-4420-a276-3e446eb65aef'

describe('files-guard', () => {
  it('refuses an anonymous listing', () => {
    expect(() => guardAnonymousFileQuery({ limit: -1 }, ANON)).toThrow(/login/)
    expect(() => guardAnonymousFileQuery({ filter: { folder: { _null: true } } }, ANON)).toThrow()
  })

  it('answers a clean 403, not a 500', () => {
    try { guardAnonymousFileQuery({}, ANON) } catch (e) {
      expect(e.name).toBe('DirectusError')
      expect(e.status).toBe(403)
    }
  })

  it('lets through the shapes readOne / readMany build (upload read-back, GET /files/<id>)', () => {
    const one = { fields: ['id'], filter: { id: { _eq: ID } } }
    const many = { filter: { _and: [{ id: { _in: [ID, ID] } }, {}] } }
    expect(guardAnonymousFileQuery(one, ANON)).toBe(one)
    expect(guardAnonymousFileQuery(many, ANON)).toBe(many)
  })

  it('does not count an _or branch or an empty _in as pinned', () => {
    expect(isPinnedFileQuery({ filter: { _or: [{ id: { _eq: ID } }, { folder: { _null: true } }] } })).toBe(false)
    expect(isPinnedFileQuery({ filter: { id: { _in: [] } } })).toBe(false)
    expect(isPinnedFileQuery({ filter: { id: { _neq: ID } } })).toBe(false)
    expect(isPinnedFileQuery({ filter: { id: { _in: Array(101).fill(ID) } } })).toBe(false)
  })

  it('leaves logged-in, admin and internal callers alone', () => {
    const q = { limit: -1 }
    expect(guardAnonymousFileQuery(q, MEMBER)).toBe(q)
    expect(guardAnonymousFileQuery(q, { accountability: { user: null, admin: true } })).toBe(q)
    expect(guardAnonymousFileQuery(q, { accountability: null })).toBe(q)
    expect(guardAnonymousFileQuery(q, undefined)).toBe(q)
  })

  it('registers on the files.query event', async () => {
    const calls = []
    registerFilesGuard((event, fn) => calls.push([event, fn]))
    expect(calls.map(c => c[0])).toEqual(['files.query'])
    await expect(calls[0][1]({}, {}, ANON)).rejects.toThrow()
  })
})
