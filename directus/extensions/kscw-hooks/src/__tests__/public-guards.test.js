/**
 * Website audit 2026-09-28 — the kscw-hooks half of F-27/F-32.
 *
 *   F-27  the Turnstile gate fails CLOSED without a secret, and the shared
 *         verifier pins success + hostname (+ action when asked). A failed
 *         captcha is a DirectusError-shaped 403, not an opaque 500.
 *   F-32  approval copies a fee category only when it is known and of the right sport.
 *
 * (The F-01/F-03 file-folder half of this audit was superseded by the deep audit's
 * allow-list design — migrations 387/388 — and is tested there.)
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@directus/api/permissions/lib/fetch-roles-tree', () => ({ fetchRolesTree: vi.fn() }))
vi.mock('@directus/api/permissions/modules/fetch-global-access/fetch-global-access', () => ({ fetchGlobalAccess: vi.fn() }))
vi.mock('@directus/api/permissions/utils/create-default-accountability', () => ({ createDefaultAccountability: vi.fn() }))

import registerHooks from '../index.js'
import { forbiddenError } from '../directus-error.js'
import { verifyTurnstileToken, isAllowedTurnstileHostname, allowedHostnames } from '../turnstile.js'
import { approvedFeeCategory } from '../fee-category.js'

// ── Register the real hook module against a fake Directus ────────────────────
// `database` records every directus_files update chain so the quarantine test can
// assert the exact WHERE it used.
const fileUpdates = []
const FILE_A = '11111111-1111-4111-8111-111111111111'
const FILE_C = '33333333-3333-4333-8333-333333333333'
function makeDb(feedbackRow) {
  const db = (table) => {
    if (table === 'feedback') {
      return { where: () => ({ select: () => ({ first: async () => feedbackRow }) }) }
    }
    if (table === 'form_submissions') {
      return { where: () => ({ select: () => ({ first: async () => ({ form: 3, answers: { a: { id: FILE_A, name: 'cv.pdf' }, b: 'text', c: { id: FILE_C } } }) }) }) }
    }
    if (table === 'forms') {
      return { where: () => ({ select: () => ({ first: async () => ({ fields: [{ id: 'a', type: 'file' }, { id: 'b', type: 'text' }, { id: 'c', type: 'file' }] }) }) }) }
    }
    if (table === 'directus_files') {
      const chain = { wheres: [] }
      const q = {
        whereIn: (col, ids) => { chain.wheres.push(['in', col, ids]); return q },
        whereNull: (col) => { chain.wheres.push(['null', col]); return q },
        where: (col, val) => { chain.wheres.push(['eq', col, val]); return q },
        update: async (patch) => { chain.patch = patch; fileUpdates.push(chain); return 1 },
      }
      return q
    }
    return {}
  }
  db.raw = () => {}
  return db
}

const filters = {}
const actions = {}
const noop = () => {}
const logger = { child: () => logger, info: noop, warn: noop, error: noop, debug: noop }
const database = makeDb({ screenshot: 'f-own', screenshots: ['f-own', 'f-team-picture'] })
registerHooks(
  {
    action: (ev, fn) => { (actions[ev] ||= []).push(fn) },
    init: noop,
    schedule: noop,
    filter: (ev, fn) => { (filters[ev] ||= []).push(fn) },
  },
  { services: {}, database, logger, getSchema: async () => ({}), env: {} },
)

const ANON = { user: null, role: null, admin: false, app: false, roles: [], ip: '203.0.113.9' }
const MEMBER = { user: 'u-member', role: 'r', admin: false, roles: ['r'] }
const ADMIN = { user: 'u-admin', role: 'r-admin', admin: true, roles: ['r-admin'] }

describe('F-27: Turnstile gate on anonymous item creates', () => {
  const gate = () => filters['items.create'][0]

  // The test process has no TURNSTILE_SECRET — exactly the "container recreated
  // without the secret" case. It used to return the payload untouched.
  it('fails CLOSED for an anonymous feedback create when no secret is configured', async () => {
    await expect(gate()({ title: 'x' }, { collection: 'feedback' }, { accountability: ANON }))
      .rejects.toMatchObject({ status: 403 })
    await expect(gate()({ name: 'x' }, { collection: 'event_signups' }, { accountability: ANON }))
      .rejects.toMatchObject({ status: 403 })
  })

  it('still skips signed-in users and internal (sudo) creates', async () => {
    const p = { title: 'x' }
    await expect(gate()(p, { collection: 'feedback' }, { accountability: MEMBER })).resolves.toBe(p)
    await expect(gate()(p, { collection: 'feedback' }, { accountability: null })).resolves.toBe(p)
  })

  it('answers a failed captcha with a DirectusError-shaped 403', async () => {
    const err = forbiddenError('Captcha verification failed')
    expect(err).toMatchObject({ name: 'DirectusError', code: 'FORBIDDEN', status: 403, extensions: {} })
    await expect(gate()({ title: 'x' }, { collection: 'feedback' }, { accountability: ANON }))
      .rejects.toMatchObject({ name: 'DirectusError', code: 'FORBIDDEN' })
  })

  it('ignores collections it does not gate', async () => {
    const p = { a: 1 }
    await expect(gate()(p, { collection: 'news' }, { accountability: ANON })).resolves.toBe(p)
  })
})

describe('F-27: shared verifier', () => {
  const REAL = '0x4AAAAAAA-real-secret'
  const reply = (body) => vi.fn(async () => ({ json: async () => body }))

  it('rejects without a secret, without a token, and on a network error', async () => {
    expect(await verifyTurnstileToken('tok', { secret: '' })).toEqual({ ok: false, reason: 'no_secret' })
    expect(await verifyTurnstileToken('', { secret: REAL })).toEqual({ ok: false, reason: 'no_token' })
    const boom = vi.fn(async () => { throw new Error('ECONNRESET') })
    expect(await verifyTurnstileToken('tok', { secret: REAL, fetchImpl: boom })).toEqual({ ok: false, reason: 'siteverify_unreachable' })
  })

  it('accepts a success solved on one of our hostnames', async () => {
    for (const hostname of ['kscw.ch', 'www.kscw.ch', 'wiedisync.kscw.ch', 'wiedisync.pages.dev', 'dev.kscw-wiedisync.pages.dev', 'localhost']) {
      const r = await verifyTurnstileToken('tok', { secret: REAL, fetchImpl: reply({ success: true, hostname }) })
      expect(r, hostname).toEqual({ ok: true, reason: null })
    }
  })

  it('rejects a success solved on somebody else\'s site', async () => {
    for (const hostname of ['evil.example', 'kscw.ch.evil.example', 'notkscw.ch', undefined]) {
      const r = await verifyTurnstileToken('tok', { secret: REAL, fetchImpl: reply({ success: true, hostname }) })
      expect(r, String(hostname)).toEqual({ ok: false, reason: 'hostname' })
    }
  })

  it('rejects success:false', async () => {
    expect(await verifyTurnstileToken('tok', { secret: REAL, fetchImpl: reply({ success: false, hostname: 'kscw.ch' }) }))
      .toEqual({ ok: false, reason: 'not_success' })
  })

  it('pins the action when the caller names one', async () => {
    const ok = reply({ success: true, hostname: 'kscw.ch', action: 'feedback' })
    expect((await verifyTurnstileToken('tok', { secret: REAL, fetchImpl: ok, expectedAction: 'feedback' })).ok).toBe(true)
    expect(await verifyTurnstileToken('tok', { secret: REAL, fetchImpl: ok, expectedAction: 'login' }))
      .toEqual({ ok: false, reason: 'action' })
  })

  it('skips the hostname pin for Cloudflare\'s test secrets (dev answers example.com)', async () => {
    const r = await verifyTurnstileToken('tok', { secret: '1x0000000000000000000000000000000AA', fetchImpl: reply({ success: true, hostname: 'example.com' }) })
    expect(r.ok).toBe(true)
  })

  it('extends the hostname list from TURNSTILE_ALLOWED_HOSTNAMES', () => {
    const list = allowedHostnames({ TURNSTILE_ALLOWED_HOSTNAMES: ' Preview.Example.org , ' })
    expect(isAllowedTurnstileHostname('a.preview.example.org', list)).toBe(true)
    expect(isAllowedTurnstileHostname('a.preview.example.org')).toBe(false)
  })
})

describe('F-32: fee category allowlist at approval', () => {
  it('copies a category of the registration\'s own sport', () => {
    expect(approvedFeeCategory('VB Schüler*in Meisterschaft', 'volleyball')).toBe('VB Schüler*in Meisterschaft')
    expect(approvedFeeCategory(' BB Minis Turnier ', 'basketball')).toBe('BB Minis Turnier')
    expect(approvedFeeCategory('Passivmitglied', 'passive')).toBe('Passivmitglied')
    // ClubDesk-family names are in the map too (admin may type them in review).
    expect(approvedFeeCategory('VB Studenten/Lehrlinge', 'volleyball')).toBe('VB Studenten/Lehrlinge')
    expect(approvedFeeCategory('Gratis', 'basketball')).toBe('Gratis')
  })

  it('refuses the other sport, unknown values and the non-member bucket', () => {
    expect(approvedFeeCategory('BB Erwerbstätige', 'volleyball')).toBeNull()
    expect(approvedFeeCategory('VB Erwerbstätige', 'passive')).toBeNull()
    expect(approvedFeeCategory('VB Gratis-für-mich', 'volleyball')).toBeNull()
    expect(approvedFeeCategory('Kein Beitrag', 'volleyball')).toBeNull()
    expect(approvedFeeCategory('VB Erwerbstätige', 'handball')).toBeNull()
    expect(approvedFeeCategory('', 'volleyball')).toBeNull()
    expect(approvedFeeCategory(null, 'volleyball')).toBeNull()
    // Prototype keys are not categories.
    expect(approvedFeeCategory('constructor', 'volleyball')).toBeNull()
  })
})
