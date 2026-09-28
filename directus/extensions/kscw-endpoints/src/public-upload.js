/**
 * Shared guards for the ANONYMOUS upload routes (2026-09-28 website audit, F-08/F-09).
 *
 *   /kscw/public/feedback      (public-feedback.js)
 *   /kscw/registration/upload  (registration.js)
 *
 * Every anonymous byte that reaches `directus_files` shares a disk with Postgres, so
 * each of these routes needs the same four things, and two copies of them would
 * drift the way the three copies of the client-IP rule did (client-ip.js):
 *
 *   1. The TYPE comes from the bytes, never from the Content-Type or the filename —
 *      both are attacker-chosen, and HTML stored as "image/png" is stored XSS the
 *      moment an admin opens it. `sniffUpload` extends scorer-exam's `sniffType`
 *      (PDF/JPEG/PNG/AVIF) with WebP and GIF, which the registration form accepts.
 *   2. A per-IP limiter keyed on an IPv6 /64, not the /128: one residential
 *      connection hands out 2^64 addresses, so a /128 key is no limit at all.
 *   3. A GLOBAL rolling-24h byte budget per folder, read from `directus_files` itself
 *      so it survives a restart and holds across PM2 workers. Per-IP limits alone do
 *      not bound the disk against a rotating sender (audit F-09: ~18 GB/h).
 *   4. A forced PRIVATE folder, named by fixed UUID. Under the directus_files
 *      allow-list (migrations 387/388) a folder-less upload would land in the
 *      private quarantine rather than in public, but these routes still file their
 *      bytes where their readers (admins, the feedback triage) look for them.
 *
 * (The core anonymous `POST /files` — the app's logged-out feedback and /f/:slug
 * answers — is governed by the Public policy's narrowed create row in
 * setup-permissions.mjs, not by this module.)
 */

import { Readable } from 'node:stream'
import Busboy from 'busboy'
import { sniffType } from './scorer-exam.js'
import { clientIp } from './client-ip.js'

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || ''

/**
 * sniffType plus the two image formats the registration and feedback forms accept.
 * Returns the MIME type, or null when the bytes are not an allowed type.
 */
export function sniffUpload(buf) {
  const known = sniffType(buf)
  if (known) return known
  if (!buf || buf.length < 12) return null
  // A PDF whose header follows a UTF-8 BOM or leading whitespace/NULs (some scanner and
  // "print to PDF" tools write one; every reader accepts it). The registration upload
  // took these on the client's Content-Type before sniffing existed, so refusing them
  // now would be a regression. Only inert bytes may precede the header — never markup.
  const pdfAt = buf.subarray(0, 1024).indexOf('%PDF-', 0, 'latin1')
  if (pdfAt > 0 && /^(?:﻿|ï»¿)?[\s\u0000]*$/.test(buf.subarray(0, pdfAt).toString('latin1'))) {
    return 'application/pdf'
  }
  // RIFF....WEBP
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp'
  }
  const gif = buf.subarray(0, 6).toString('latin1')
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif'
  return null
}

export const EXT_FOR_TYPE = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/avif': 'avif',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** Image types only — for surfaces (feedback screenshots) where a PDF is not expected. */
export const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

/**
 * A filename safe to store as `filename_download`: no path separators, no control
 * characters, bounded, and its extension forced to match the SNIFFED type so a
 * download never presents `invoice.html` for bytes we accepted as a PNG.
 */
export function safeFilename(raw, type, fallback = 'upload') {
  const base = String(raw ?? '')
    .replace(/[\\/\u0000-\u001f\u007f"]/g, '')
    .replace(/\.[A-Za-z0-9]{1,8}$/, '')
    .trim()
    .slice(0, 120) || fallback
  const ext = EXT_FOR_TYPE[type]
  return ext ? `${base}.${ext}` : base
}

/**
 * The limiter key for an address. IPv4 as-is; IPv6 collapsed to its /64, the smallest
 * block a residential or mobile connection is handed. Exported for the unit test.
 */
export function ipBucket(ip) {
  const s = String(ip || 'unknown').trim()
  if (!s.includes(':')) return s
  // IPv4-mapped/-embedded IPv6 ("::ffff:203.0.113.9", what req.ip reads on a
  // dual-stack listener): key on the IPv4. Collapsing it to its /64 would put EVERY
  // such client in the one bucket "0:0:0:0::/64" — a site-wide limit, not a per-IP one.
  const v4 = s.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (v4) return v4[1]
  // Expand a "::" so the first four hextets are real ones, not the zero run.
  const [head, tail = ''] = s.split('::')
  const h = head ? head.split(':') : []
  const t = s.includes('::') ? (tail ? tail.split(':') : []) : []
  const full = s.includes('::')
    ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t]
    : h
  return full.slice(0, 4).map((x) => (x || '0').toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64'
}

/**
 * A sliding per-bucket counter. `take(req, n)` returns false once the bucket has
 * spent `max` in `windowMs`. Counts can be requests (n=1) or bytes (n=size).
 */
export function createLimiter(max, windowMs) {
  const map = new Map()
  return {
    take(req, n = 1) {
      const key = ipBucket(clientIp(req))
      const now = Date.now()
      const e = map.get(key)
      if (e && now < e.resetAt) {
        if (e.used + n > max) return false
        e.used += n
      } else {
        if (n > max) return false
        map.set(key, { used: n, resetAt: now + windowMs })
      }
      if (map.size > 2000) {
        for (const [k, v] of map) if (now > v.resetAt) map.delete(k)
      }
      return true
    },
    /** For tests. */
    _map: map,
  }
}

/**
 * Bytes stored in `folder` over the last 24 h. Read from `directus_files` rather than
 * kept in memory so the budget survives a restart and is shared by every worker.
 */
export async function folderBytesLast24h(database, folder) {
  const row = await database('directus_files')
    .where('folder', folder)
    .where('uploaded_on', '>', database.raw("now() - interval '24 hours'"))
    .sum({ total: 'filesize' })
    .first()
  return Number(row?.total) || 0
}

/** True when adding `incoming` bytes would push the folder past its daily budget. */
export async function overDailyBudget(database, folder, incoming, budgetBytes) {
  const used = await folderBytesLast24h(database, folder)
  return used + Number(incoming || 0) > budgetBytes
}

/**
 * Fail-CLOSED Turnstile check. An unset secret or a network error to Cloudflare is a
 * rejection, never an open form (the kscw-hooks copy fails open — audit F-27).
 */
export async function verifyTurnstile(token) {
  if (!TURNSTILE_SECRET) {
    console.error('[public-upload] TURNSTILE_SECRET not configured — rejecting request')
    return false
  }
  if (!token || typeof token !== 'string') return false
  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: token }).toString(),
    })
    return (await resp.json())?.success === true
  } catch {
    return false
  }
}

/**
 * Parse a multipart body into memory with hard limits. Resolves
 * `{ fields, files: [{ field, filename, content }] }`; rejects with `.status` 413
 * (a file or the total is too large, or too many files) or 400 (not multipart).
 *
 * Buffering is deliberate: every route here needs to SNIFF the bytes before anything
 * is stored, and the caps (≤ 10 MB) make holding one request in memory cheap. It also
 * sidesteps the streaming-into-FilesService error-listener trap documented in
 * scorer-exam.js.
 */
export function parseMultipart(req, { fileFields, maxFiles = 1, maxFileBytes, maxTotalBytes = maxFileBytes * maxFiles, maxFieldBytes = 20_000 }) {
  return new Promise((resolve, reject) => {
    let bb
    try {
      bb = Busboy({
        headers: req.headers,
        limits: { files: maxFiles, fileSize: maxFileBytes, fields: 30, fieldSize: maxFieldBytes, parts: 40 },
      })
    } catch {
      return reject(Object.assign(new Error('multipart_required'), { status: 400 }))
    }
    const fields = {}
    const files = []
    let total = 0
    let done = false
    const fail = (err) => {
      if (done) return
      done = true
      try { req.unpipe(bb) } catch { /* noop */ }
      req.resume()
      reject(err)
    }
    bb.on('field', (name, val) => { if (!(name in fields)) fields[name] = val })
    bb.on('file', (name, stream, info) => {
      if (!fileFields.includes(name)) { stream.resume(); return }
      const chunks = []
      let truncated = false
      stream.on('data', (d) => {
        total += d.length
        if (total > maxTotalBytes) { truncated = true; return }
        chunks.push(d)
      })
      stream.on('limit', () => { truncated = true })
      stream.on('error', fail)
      stream.on('close', () => {
        if (done) return
        if (truncated) return fail(Object.assign(new Error('too_large'), { status: 413 }))
        const content = Buffer.concat(chunks)
        if (content.length) files.push({ field: name, filename: info?.filename || '', content })
      })
    })
    bb.on('filesLimit', () => fail(Object.assign(new Error('too_many_files'), { status: 413 })))
    bb.on('fieldsLimit', () => fail(Object.assign(new Error('too_many_fields'), { status: 413 })))
    bb.on('partsLimit', () => fail(Object.assign(new Error('too_many_parts'), { status: 413 })))
    bb.on('error', () => fail(Object.assign(new Error('bad_multipart'), { status: 400 })))
    bb.on('close', () => { if (!done) { done = true; resolve({ fields, files }) } })
    req.on('error', fail)
    req.pipe(bb)
  })
}

/**
 * Read a RAW (non-multipart) request body into memory, refusing past `maxBytes`.
 * Rejects with `.status` 413. For routes whose client sends `body: file` directly
 * (registration/upload) — buffering first is what lets the bytes be sniffed before
 * anything is written.
 */
export function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let done = false
    req.on('data', (d) => {
      if (done) return
      total += d.length
      if (total > maxBytes) {
        done = true
        req.resume()
        reject(Object.assign(new Error('too_large'), { status: 413 }))
        return
      }
      chunks.push(d)
    })
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)) } })
    req.on('error', (err) => { if (!done) { done = true; reject(err) } })
  })
}

/**
 * Make sure a fixed-UUID private folder exists. The folders are normally created by a
 * numbered migration; this is the belt to that braces, so a missing migration cannot
 * turn into an FK error (or worse, a fallback to folder=null) on the first upload.
 */
export async function ensureFolder(database, id, name) {
  const found = await database('directus_folders').where('id', id).first('id')
  if (found) return
  await database('directus_folders').insert({ id, name, parent: null }).onConflict('id').ignore()
}

/**
 * Store an already-sniffed buffer through FilesService (so storage adapters, metadata
 * and thumbnails behave exactly like a core upload) — ALWAYS into `folder`.
 */
export async function storeBuffer({ services, getSchema, database }, buf, { folder, filename, type, title }) {
  if (!folder) throw new Error('storeBuffer: a private folder is mandatory')
  const { FilesService } = services
  const filesService = new FilesService({ schema: await getSchema(), knex: database })
  const storage = (process.env.STORAGE_LOCATIONS || 'local').split(',')[0].trim()
  return filesService.uploadOne(Readable.from([buf]), {
    storage,
    filename_download: filename,
    type,
    folder,
    ...(title ? { title } : {}),
  })
}
