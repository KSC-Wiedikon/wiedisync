/**
 * Every cron that logs in to the club's shared VolleyManager or Basketplan account
 * runs on the PRODUCTION instance only (kscw-endpoints/src/external-accounts.js).
 *
 * The dev container runs the same code against a nightly prod clone with the same
 * credentials, at the same minutes. Two containers' claimVmAccount locks cannot see
 * each other, and VM keeps the active role per account — so a dev tick could make
 * prod (or svrz_rc) read under the wrong role, a 200 with the wrong rows.
 *
 * Registers the real hook module against a fake Directus, then fires each cron as
 * the dev instance: it must return before touching the database, the shared-account
 * claim or a child process.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@directus/api/permissions/lib/fetch-roles-tree', () => ({ fetchRolesTree: vi.fn() }))
vi.mock('@directus/api/permissions/modules/fetch-global-access/fetch-global-access', () => ({ fetchGlobalAccess: vi.fn() }))
vi.mock('@directus/api/permissions/utils/create-default-accountability', () => ({ createDefaultAccountability: vi.fn() }))

import registerHooks from '../index.js'
import { _resetAnnouncedForTests } from '../../../kscw-endpoints/src/external-accounts.js'

/** Records every table touched; any chain resolves (updates hit 1 row, reads find nothing). */
const touched = []
function recordingDb() {
  const db = (table) => {
    touched.push(table)
    let op = null
    const builder = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') {
          const val = op === 'update' || op === 'del' ? 1 : op === 'first' ? undefined : []
          return (res, rej) => Promise.resolve(val).then(res, rej)
        }
        return () => {
          if (['update', 'del', 'first', 'select', 'insert', 'pluck'].includes(prop)) op = prop
          return builder
        }
      },
    })
    return builder
  }
  db.fn = { now: () => 'now()' }
  db.raw = (x) => x
  return db
}

const crons = []
const noop = () => {}
const lines = []
const logger = { child: () => logger, info: (m) => lines.push(m), warn: noop, error: noop, debug: noop }
registerHooks(
  { action: noop, init: noop, filter: noop, schedule: (expr, fn) => crons.push({ expr, fn }) },
  { services: {}, database: recordingDb(), logger, getSchema: async () => ({}), env: {} },
)

// A cron by what its source says. The gate call is matched loosely: vitest rewrites an
// imported call to `(0, __vite_ssr_import_N__.skipExternalJob)('job', …)`.
const gate = (job) => new RegExp(`skipExternalJob\\)?\\('${job}'`)
const cronFor = (needle) => {
  const hits = crons.filter((c) => (typeof needle === 'string' ? c.fn.toString().includes(needle) : needle.test(c.fn.toString())))
  expect(hits, String(needle)).toHaveLength(1)
  return hits[0]
}

// One entry per prod-only VM / Basketplan cron in kscw-hooks.
const GATED = [
  ['vm_sync (weekly)', "runVmSync('weekly')"],
  ['vm_sync watchdog', gate('vm_sync')],
  ['svrz_sync', gate('svrz_sync')],
  ['vm_nomination (T-60 Einsatzliste push)', gate('vm_nomination')],
  ['vm_sheet_check (kickoff −45 min read)', gate('vm_sheet_check')],
  ['vm_result_sweep (:35 reads + queued pushes)', gate('vm_result_sweep')],
  ['bb_register (Basketplan registration tick)', gate('bb_register')],
]

describe('VM / Basketplan crons are prod-only', () => {
  const saved = { ...process.env }
  const KEY = '__kscw_vm_account_holder'   // the shared-account claim (vm-account-lock.js)
  let claims
  let fetches
  beforeEach(() => {
    process.env.VM_USERNAME = 'u'
    process.env.VM_PASSWORD = 'p'
    // A cron that got past its gate would mint a token next; make that observable.
    process.env.DIRECTUS_SYNC_EMAIL = 'sync@example.test'
    process.env.DIRECTUS_SYNC_PASSWORD = 'x'
    claims = []
    fetches = []
    let held = null
    Object.defineProperty(globalThis, KEY, {
      configurable: true,
      get: () => held,
      set: (v) => { if (v) claims.push(v.who); held = v },
    })
    vi.stubGlobal('fetch', async (url) => { fetches.push(String(url)); throw new Error('no network in tests') })
    touched.length = 0
    lines.length = 0
    _resetAnnouncedForTests()
  })
  afterEach(() => {
    process.env = { ...saved }
    vi.unstubAllGlobals()
    delete globalThis[KEY]
    globalThis[KEY] = null
  })

  for (const [label, needle] of GATED) {
    for (const [what, url] of [['the dev host', 'https://directus-dev.kscw.ch'], ['an unset PUBLIC_URL', null]]) {
      it(`${label}: does nothing on ${what}`, async () => {
        if (url) process.env.PUBLIC_URL = url
        else delete process.env.PUBLIC_URL
        await cronFor(needle).fn()
        expect(touched).toEqual([])          // no DB work
        expect(claims).toEqual([])           // never took the shared VM account
        expect(fetches).toEqual([])          // no token, no endpoint call
      })
    }
  }

  it('says so once per process, not once per tick', async () => {
    process.env.PUBLIC_URL = 'https://directus-dev.kscw.ch'
    const tick = cronFor(gate('bb_register')).fn
    for (let i = 0; i < 5; i++) await tick()
    expect(lines.filter((l) => /bb_register disabled/.test(String(l)))).toHaveLength(1)
  })

  it('still runs on prod — the gate is not a kill switch', async () => {
    process.env.PUBLIC_URL = 'https://directus.kscw.ch'
    await cronFor(gate('vm_nomination')).fn()
    expect(claims).toEqual(['vm_nomination'])
    expect(touched).toContain('games')
    expect(globalThis[KEY]).toBeNull()   // nothing due → claim handed back
  })

  it('the old fail-open PUBLIC_URL sniff is gone', () => {
    for (const { fn } of crons) expect(fn.toString()).not.toMatch(/includes\('directus-dev'\)/)
  })
})
