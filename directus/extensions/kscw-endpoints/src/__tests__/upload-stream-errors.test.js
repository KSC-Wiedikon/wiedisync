// 2026-09-28 audit F16 + F34.
//  F16: a stream error before FilesService attaches its consumer used to be an UNCAUGHT
//       'error' event (process exit). The listener must exist from the moment the pipe
//       starts, and no await may sit between `req.pipe()` and `uploadOne()`.
//  F34: /identity/upload caps pending (unbound) uploads per login and records the
//       uploader so the cap can count them.
import { describe, it, expect, afterEach } from 'vitest'
import { PassThrough, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { registerRegistration } from '../registration.js'
import { registerIdentityDocument } from '../identity-document.js'

const noop = () => {}
const logger = { child: () => logger, info: noop, warn: noop, error: noop, debug: noop }

function makeRouter() {
  const routes = {}
  return new Proxy({ routes }, {
    get(target, prop) {
      if (prop in target) return target[prop]
      return (path, ...handlers) => {
        if (typeof path === 'string') routes[`${String(prop).toUpperCase()} ${path}`] = handlers.at(-1)
      }
    },
  })
}

function makeRes() {
  const o = { statusCode: 200, headersSent: false }
  o.status = (c) => { o.statusCode = c; return o }
  o.json = (b) => { o.body = b; o.headersSent = true; return o }
  return o
}

/** FilesService stand-in: consumes the stream only after an async gap, like the real one. */
function filesServiceClass(record) {
  return class {
    async uploadOne(stream, meta) {
      await new Promise((r) => setTimeout(r, 5))
      record.meta = meta
      // Like the real FilesService: a pipeline, which also rejects on a stream that was
      // already destroyed before it got here.
      await pipeline(stream, new Writable({ write(_c, _e, cb) { cb() } }))
      return 'file-1'
    }
    async deleteOne(id) { record.deleted = [...(record.deleted || []), id] }
  }
}

const uncaught = []
const onUncaught = (err) => uncaught.push(err)
process.on('uncaughtException', onUncaught)
afterEach(() => { uncaught.length = 0 })

describe('/registration/upload stream errors (F16)', () => {
  it('a client abort before the consumer attaches is a 500, not a process crash', async () => {
    const record = {}
    const R = makeRouter()
    registerRegistration(R, {
      database: Object.assign(() => ({}), {}),
      logger,
      services: { FilesService: filesServiceClass(record) },
      getSchema: async () => ({}),
    })
    const req = new PassThrough()
    Object.assign(req, { headers: { 'content-type': 'application/pdf', 'content-length': '10' }, query: {}, ip: '10.0.0.1' })
    const res = makeRes()
    const p = R.routes['POST /registration/upload'](req, res)
    req.write(Buffer.from('%PDF-1.7'))
    req.destroy(new Error('aborted'))
    await p
    await new Promise((r) => setTimeout(r, 20))
    expect(uncaught).toEqual([])
    expect(res.statusCode).toBe(500)
  })

  it('an oversize body reports 413', async () => {
    const record = {}
    const R = makeRouter()
    registerRegistration(R, {
      database: Object.assign(() => ({}), {}),
      logger,
      services: { FilesService: filesServiceClass(record) },
      getSchema: async () => ({}),
    })
    const req = new PassThrough()
    Object.assign(req, { headers: { 'content-type': 'application/pdf' }, query: {}, ip: '10.0.0.2' })
    const res = makeRes()
    const p = R.routes['POST /registration/upload'](req, res)
    req.end(Buffer.alloc(10 * 1024 * 1024 + 1))
    await p
    await new Promise((r) => setTimeout(r, 20))
    expect(uncaught).toEqual([])
    expect(res.statusCode).toBe(413)
  })
})

/** Minimal knex stand-in for the identity upload path. */
function identityDb({ pending = [] } = {}) {
  const updates = []
  const db = (table) => {
    const chain = {
      where: () => chain,
      whereIn: () => chain,
      whereNotExists: () => chain,
      first: async () => (table === 'members' ? { id: 42, first_name: 'A', last_name: 'B' } : null),
      select: async () => (table.startsWith('directus_files') ? pending : []),
      update: async (v) => { updates.push({ table, v }); return 1 },
    }
    return chain
  }
  db.raw = () => '1'
  return { db, updates }
}

describe('/registration/upload truncated body (F16 follow-up)', () => {
  it('purges the file when uploadOne resolves on a stream that errored', async () => {
    const record = {}
    class LenientFiles {
      // Resolves once the stream errors — as a store that stops reading on 'error' would.
      async uploadOne(stream) { await new Promise((r) => stream.once('error', r)); return 'file-2' }
      async deleteOne(id) { record.deleted = [...(record.deleted || []), id] }
    }
    const R = makeRouter()
    registerRegistration(R, {
      database: Object.assign(() => ({}), {}),
      logger,
      services: { FilesService: LenientFiles },
      getSchema: async () => ({}),
    })
    const req = new PassThrough()
    Object.assign(req, { headers: { 'content-type': 'application/pdf', 'content-length': '10' }, query: {}, ip: '10.0.0.3' })
    const res = makeRes()
    const p = R.routes['POST /registration/upload'](req, res)
    req.write(Buffer.from('%PDF-1.7'))
    await new Promise((r) => setTimeout(r, 10))
    req.destroy(new Error('aborted'))
    await p
    expect(uncaught).toEqual([])
    expect(res.statusCode).toBe(500)
    expect(record.deleted).toEqual(['file-2'])
  })
})

describe('/identity/upload (F16 + F34)', () => {
  function setup(opts) {
    const record = {}
    const { db, updates } = identityDb(opts)
    const R = makeRouter()
    registerIdentityDocument(R, {
      database: db, logger,
      services: { FilesService: filesServiceClass(record) },
      getSchema: async () => ({}),
    })
    return { handler: R.routes['POST /identity/upload'], record, updates }
  }

  it('refuses once the login holds too many fresh unbound uploads', async () => {
    const fresh = new Date()
    const { handler, record } = setup({ pending: [1, 2, 3].map((i) => ({ id: `f${i}`, uploaded_on: fresh })) })
    const req = new PassThrough()
    Object.assign(req, { headers: {}, accountability: { user: 'u-1' } })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(429)
    expect(res.body.code).toBe('too_many_pending')
    expect(record.meta).toBeUndefined()
  })

  it('counts uploads still streaming, so a parallel burst cannot pass the cap', async () => {
    const fresh = new Date()
    const { handler } = setup({ pending: [1, 2].map((i) => ({ id: `f${i}`, uploaded_on: fresh })) })
    const mk = () => { const r = new PassThrough(); Object.assign(r, { headers: {}, accountability: { user: 'u-burst' } }); return r }
    const reqA = mk(); const reqB = mk()
    const resA = makeRes(); const resB = makeRes()
    const pA = handler(reqA, resA)
    const pB = handler(reqB, resB)
    await pB
    expect(resB.statusCode).toBe(429)
    reqA.end(Buffer.from('ciphertext'))
    await pA
    expect(resA.body.data.id).toBe('file-1')
    // Released after A finished: the next attempt is judged on stored rows alone.
    const reqC = mk(); const resC = makeRes()
    const pC = handler(reqC, resC)
    reqC.end(Buffer.from('x'))
    await pC
    expect(resC.statusCode).toBe(200)
  })

  it('stamps the uploader so the cap can count it', async () => {
    const { handler, updates } = setup()
    const req = new PassThrough()
    Object.assign(req, { headers: {}, accountability: { user: 'u-1' } })
    const res = makeRes()
    const p = handler(req, res)
    req.end(Buffer.from('ciphertext'))
    await p
    expect(res.body.data.id).toBe('file-1')
    expect(updates).toContainEqual({ table: 'directus_files', v: { uploaded_by: 'u-1' } })
  })

  it('a client abort mid-body is not a process crash', async () => {
    const { handler } = setup()
    const req = new PassThrough()
    Object.assign(req, { headers: {}, accountability: { user: 'u-1' } })
    const res = makeRes()
    const p = handler(req, res)
    req.write(Buffer.from('abc'))
    req.destroy(new Error('aborted'))
    await p
    await new Promise((r) => setTimeout(r, 20))
    expect(uncaught).toEqual([])
    expect(res.statusCode).toBe(500)
  })
})
