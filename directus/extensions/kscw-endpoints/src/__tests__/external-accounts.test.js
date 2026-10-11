/**
 * The one prod-only switch for the club's shared external accounts (VolleyManager,
 * Basketplan) — external-accounts.js — and the spawner half of the write flag.
 *
 * Fail closed is the whole point: the old guards sniffed DB_DATABASE / PUBLIC_URL for
 * "dev" and so failed OPEN when the variable was missing. Every "not obviously prod"
 * input below must come out disabled.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  PROD_HOST, EXTERNAL_DISABLED_CODE, EXTERNAL_WRITES_ENV,
  isProdInstance, externalAccountsEnabled, externalWritesEnabled, externalWritesEnv,
  skipExternalJob, refuseExternalOnDev, _resetAnnouncedForTests,
} from '../external-accounts.js'
import { spawnResultPush } from '../game-result.js'
import { createBbTournamentWorker } from '../bb-tournament-worker.js'

const PROD = { PUBLIC_URL: 'https://directus.kscw.ch' }
const DEV = { PUBLIC_URL: 'https://directus-dev.kscw.ch' }

describe('externalAccountsEnabled — prod host only, fail closed', () => {
  it('is on for the prod host, with or without a trailing slash, port or case drift', () => {
    expect(PROD_HOST).toBe('directus.kscw.ch')
    for (const url of ['https://directus.kscw.ch', 'https://directus.kscw.ch/', 'https://DIRECTUS.kscw.ch', 'https://directus.kscw.ch:443', '  https://directus.kscw.ch  ']) {
      expect(isProdInstance({ PUBLIC_URL: url }), url).toBe(true)
      expect(externalAccountsEnabled({ PUBLIC_URL: url }), url).toBe(true)
    }
  })

  it('is off for the dev host', () => {
    expect(externalAccountsEnabled(DEV)).toBe(false)
  })

  it('is off when PUBLIC_URL is unset or empty — the case the old guards got wrong', () => {
    expect(externalAccountsEnabled({})).toBe(false)
    expect(externalAccountsEnabled({ PUBLIC_URL: '' })).toBe(false)
    expect(externalAccountsEnabled({ PUBLIC_URL: '   ' })).toBe(false)
    expect(externalAccountsEnabled(null)).toBe(false)
  })

  it('is off for garbage, localhost, look-alikes and non-http schemes', () => {
    for (const url of [
      'not a url', 'directus.kscw.ch', 'http://localhost:8055', 'http://127.0.0.1:8055',
      'https://directus.kscw.ch.evil.example', 'https://evil.example/directus.kscw.ch',
      'https://kscw.ch', 'https://dev.directus.kscw.ch', 'ftp://directus.kscw.ch', 'javascript:directus.kscw.ch',
    ]) {
      expect(externalAccountsEnabled({ PUBLIC_URL: url }), url).toBe(false)
    }
  })

  it('the explicit override turns it on for a supervised dev test — only with "1"', () => {
    expect(externalAccountsEnabled({ ...DEV, KSCW_ALLOW_EXTERNAL_ON_DEV: '1' })).toBe(true)
    expect(externalAccountsEnabled({ KSCW_ALLOW_EXTERNAL_ON_DEV: '1' })).toBe(true)
    expect(externalAccountsEnabled({ ...DEV, KSCW_ALLOW_EXTERNAL_ON_DEV: 'true' })).toBe(false)
    expect(externalAccountsEnabled({ ...DEV, KSCW_ALLOW_EXTERNAL_ON_DEV: '' })).toBe(false)
  })
})

describe('externalWritesEnabled / externalWritesEnv — the second key', () => {
  it('always on prod', () => {
    expect(externalWritesEnabled('VM_RESULT_ALLOW_DEV_WRITE', PROD)).toBe(true)
    expect(externalWritesEnv('VM_RESULT_ALLOW_DEV_WRITE', PROD)).toEqual({ [EXTERNAL_WRITES_ENV]: '1' })
  })
  it('off on dev, even with the old per-writer opt-in on its own', () => {
    expect(externalWritesEnv('VM_RESULT_ALLOW_DEV_WRITE', DEV)).toEqual({})
    expect(externalWritesEnv('VM_RESULT_ALLOW_DEV_WRITE', { ...DEV, VM_RESULT_ALLOW_DEV_WRITE: '1' })).toEqual({})
  })
  it('dev logins alone do not arm a writer', () => {
    expect(externalWritesEnv('VM_RESULT_ALLOW_DEV_WRITE', { ...DEV, KSCW_ALLOW_EXTERNAL_ON_DEV: '1' })).toEqual({})
  })
  it('a supervised dev write needs the override AND that writer\'s own opt-in', () => {
    const env = { ...DEV, KSCW_ALLOW_EXTERNAL_ON_DEV: '1', VM_RESULT_ALLOW_DEV_WRITE: '1' }
    expect(externalWritesEnv('VM_RESULT_ALLOW_DEV_WRITE', env)).toEqual({ KSCW_EXTERNAL_WRITES: '1' })
    // …and another writer's opt-in does not count
    expect(externalWritesEnv('VM_NOMINATION_ALLOW_DEV_WRITE', env)).toEqual({})
  })
})

describe('skipExternalJob / refuseExternalOnDev', () => {
  beforeEach(() => _resetAnnouncedForTests())

  it('skips off prod and logs once per job, not once per tick', () => {
    const lines = []
    const log = { info: (m) => lines.push(m) }
    for (let i = 0; i < 5; i++) expect(skipExternalJob('vm_nomination', log, DEV)).toBe(true)
    expect(skipExternalJob('vm_sync', log, DEV)).toBe(true)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/vm_nomination disabled/)
  })
  it('does not skip on prod, and says nothing', () => {
    const lines = []
    expect(skipExternalJob('vm_nomination', { info: (m) => lines.push(m) }, PROD)).toBe(false)
    expect(lines).toEqual([])
  })
  it('answers 503 external_disabled_on_dev off prod', () => {
    const res = { status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
    expect(refuseExternalOnDev(res, DEV)).toBe(true)
    expect(res.code).toBe(503)
    expect(res.body.code).toBe(EXTERNAL_DISABLED_CODE)
    const ok = { status() { throw new Error('must not answer') } }
    expect(refuseExternalOnDev(ok, PROD)).toBe(false)
  })
})

// ── Spawner: the write flag reaches the worker only on prod ─────────────────

/** Any chain, any table: updates match one row, reads find nothing. */
function permissiveDb() {
  const db = () => {
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

function fakeSpawn() {
  const calls = []
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter()
    child.unref = () => {}
    calls.push({ cmd, args, opts, child })
    return child
  }
  return { spawn, calls }
}

describe('spawnResultPush — KSCW_EXTERNAL_WRITES only on prod', () => {
  const saved = { ...process.env }
  const log = { info: () => {}, warn: () => {}, error: () => {} }
  const sets = [{ home: 25, away: 20 }, { home: 25, away: 20 }, { home: 25, away: 20 }]
  afterEach(() => { process.env = { ...saved }; globalThis.__kscw_vm_account_holder = null })

  const run = async () => {
    const { spawn, calls } = fakeSpawn()
    const r = await spawnResultPush({ database: permissiveDb(), log, gameId: 541, sets, spawn })
    expect(r.ok).toBe(true)
    calls[0].child.emit('exit', 0, null)   // hand the shared account back
    await r.exited
    return calls[0].opts.env
  }

  it('prod: the worker is told it may write', async () => {
    process.env.PUBLIC_URL = PROD.PUBLIC_URL
    const env = await run()
    expect(env.KSCW_EXTERNAL_WRITES).toBe('1')
    // the DB-name sniffing is gone for good
    expect(env).not.toHaveProperty('DB_DATABASE')
  })
  it('dev (or anything not prod): no flag, so the worker is a dry run', async () => {
    process.env.PUBLIC_URL = DEV.PUBLIC_URL
    process.env.VM_RESULT_ALLOW_DEV_WRITE = '1'
    expect(await run()).not.toHaveProperty('KSCW_EXTERNAL_WRITES')
    delete process.env.PUBLIC_URL
    expect(await run()).not.toHaveProperty('KSCW_EXTERNAL_WRITES')
  })
})

// ── Basketplan worker: no login off prod ─────────────────────────────────────

describe('bb tournament worker — prod only', () => {
  const noDb = () => { throw new Error('the worker must not touch the DB off prod') }
  const noFetch = () => { throw new Error('the worker must not contact Basketplan off prod') }
  const log = { info: () => {}, warn: () => {} }

  it('off prod a tick does nothing at all, and live is never allowed', async () => {
    const w = createBbTournamentWorker({
      database: noDb, log, fetchImpl: noFetch,
      env: { ...DEV, BASKETPLAN_REGISTER_LIVE: '1', BASKETPLAN_USERNAME: 'u', BASKETPLAN_PASSWORD: 'p' },
    })
    expect(w.liveAllowed).toBe(false)
    expect(await w.run({ force: true })).toEqual({ skipped: EXTERNAL_DISABLED_CODE })
  })
  it('on prod live still needs BASKETPLAN_REGISTER_LIVE=1', () => {
    expect(createBbTournamentWorker({ database: noDb, log, env: { ...PROD } }).liveAllowed).toBe(false)
    expect(createBbTournamentWorker({ database: noDb, log, env: { ...PROD, BASKETPLAN_REGISTER_LIVE: '1' } }).liveAllowed).toBe(true)
  })
})
