// 2026-09-28 audit F81: /admin/sync-status must not hand raw child-process stderr to members.
import { describe, it, expect } from 'vitest'
import { summarizeSyncError, registerSyncStatus } from '../sync-status.js'

const noop = () => {}
const logger = { child: () => ({ error: noop }) }
const STDERR = 'Error: VM login failed\n    at login (/directus/extensions/kscw-hooks/dist/index.js:10:5)\n    at https://volleymanager.example/api?x=1'

function db(role) {
  const fn = (table) => {
    const chain = {
      where: () => chain,
      select: () => chain,
      orderBy: async () => [{ source: 'vm_sync', last_run_at: new Date(), status: 'error', error_message: STDERR }],
      first: async () => (table === 'members' ? { role } : null),
    }
    return chain
  }
  fn.schema = { hasTable: async () => true }
  return fn
}

async function get(database, accountability) {
  const routes = {}
  registerSyncStatus({ get: (p, h) => { routes[p] = h } }, { database, logger })
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
  await routes['/admin/sync-status']({ accountability }, res)
  return res.body.runs[0].error_message
}

describe('summarizeSyncError', () => {
  it('keeps one line and drops stack frames, paths and urls', () => {
    expect(summarizeSyncError(STDERR)).toBe('Error: VM login failed')
    expect(summarizeSyncError('failed at /opt/app/x.js:1:2 via https://a.b/c')).toBe('failed at [path] via [url]')
    expect(summarizeSyncError(null)).toBeNull()
  })
})

describe('GET /admin/sync-status', () => {
  it('summarises the error for a plain member', async () => {
    expect(await get(db('["user"]'), { user: 'u-1' })).toBe('Error: VM login failed')
  })
  it('returns it verbatim to an admin', async () => {
    expect(await get(db('["user","vb_admin"]'), { user: 'u-1' })).toBe(STDERR)
    expect(await get(db(null), { user: 'u-1', admin: true })).toBe(STDERR)
  })
})

describe('summarizeSyncError — hosts, emails, DB names (F81 follow-up)', () => {
  it('redacts IPs, host:port, hostnames, emails and quoted DB user names', () => {
    expect(summarizeSyncError('connect ECONNREFUSED 10.0.0.5:5432')).toBe('connect ECONNREFUSED [host]')
    expect(summarizeSyncError('getaddrinfo ENOTFOUND db.internal.kscw.ch')).toBe('getaddrinfo ENOTFOUND [host]')
    expect(summarizeSyncError('login failed for scorer@volleyball.kscw.ch')).toBe('login failed for [email]')
    expect(summarizeSyncError('password authentication failed for user "supabase_admin"'))
      .toBe('password authentication failed for user "[redacted]"')
  })

  it('leaves an ordinary message alone', () => {
    expect(summarizeSyncError('Error: VM login failed')).toBe('Error: VM login failed')
  })
})

describe('summarizeSyncError — code identifiers are not hosts', () => {
  it('keeps a dotted identifier', () => {
    expect(summarizeSyncError('TypeError: rows.map is not a function')).toBe('TypeError: rows.map is not a function')
  })
})
