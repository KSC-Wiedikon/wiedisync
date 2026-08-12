/**
 * End-to-end-encrypted identity documents.
 *
 *   GET    /kscw/identity/keys                  — my key material (to unlock on a new device)
 *   POST   /kscw/identity/keys                  — create or replace my keypair
 *   GET    /kscw/identity/recipients/:member    — public keys of everyone allowed to read
 *   POST   /kscw/identity/document              — store ciphertext + the wrapped keys
 *   GET    /kscw/identity/document/:member      — metadata + MY envelope for it
 *   GET    /kscw/identity/document/:member/bytes— the ciphertext
 *   DELETE /kscw/identity/document/:member      — remove it
 *
 * WE CANNOT READ ANY OF THIS. Not the server, not an admin, not root on the VPS. The file
 * arrives already encrypted (AES-256-GCM, in the member's browser) and the content key
 * arrives already wrapped to each recipient's public key. Nothing here holds a private key.
 * A rooted VPS yields ciphertext and a pile of locked envelopes — which is the entire
 * reason this endpoint exists instead of a `STORAGE_*_ENCRYPTION_KEY` in .env.
 *
 * WHO MAY RECEIVE AN ENVELOPE is decided HERE, not by the client. The uploader tells us who
 * they wrapped to; we refuse to store an envelope for anyone who is not the member or a
 * coach/TR of a team the member actually plays in. The crypto would not care — a stranger's
 * envelope is only openable by that stranger — but the grant list is the access-control
 * record, and it has to mean something.
 *
 * THE TIME WINDOW IS NOT A CRYPTOGRAPHIC BOUNDARY. A hall has no signal, so the coach must
 * be able to pre-load before they travel; that means the key reaches their device early, and
 * a well-behaved client then only DISPLAYS it in the 45 minutes before kickoff. A coach who
 * kept the bytes could decrypt them later. That is unavoidable in any design where a human
 * is allowed to look at the document at all — they could equally photograph the screen. The
 * window limits casual exposure and, with the audit log below, makes access accountable. It
 * does not, and cannot, make it impossible.
 *
 * Every read is audit-logged: who opened whose ID, and when.
 */

import { Transform } from 'node:stream'
import { writeUserLog } from './activity-log.js'
import { streamManagedFile } from './storage-read.js'

const UPLOAD_MAX_BYTES = 10 * 1024 * 1024

// Fixed in migration 212. Ciphertext only ever lands here, and the Member file-read policy
// excludes it — so it is never reachable via /assets, only through this endpoint.
const IDENTITY_FOLDER = 'd0c00001-0000-4000-8000-000000000001'

// The server releases key + bytes this far ahead so the coach can pre-load while they still
// have a connection. The 45-minute DISPLAY window is enforced by the client (see above).
//
// ⚠ MUST be <= COACH_WINDOW_BEFORE_MS in scorer-roster.js. The Show-IDs screen reads the
// match sheet from there to learn WHO to fetch documents for, so if that window is narrower,
// pre-loading silently downloads nothing.
const PRELOAD_BEFORE_MS = 6 * 60 * 60 * 1000
const PRELOAD_AFTER_MS = 15 * 60 * 1000

const dateYMD = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10))

function zurichOffsetMs(instantMs) {
  const p = {}
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
  for (const x of dtf.formatToParts(new Date(instantMs))) p[x.type] = x.value
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - instantMs
}

function gameStartMs(game) {
  const ymd = dateYMD(game.date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  const [hh, mm] = String(game.time ?? '').split(':')
  if (hh == null || mm == null || hh === '') return null
  const [y, mo, d] = ymd.split('-').map(Number)
  const guess = Date.UTC(y, mo - 1, d, Number(hh), Number(mm))
  const corrected = guess - zurichOffsetMs(guess)
  return guess - zurichOffsetMs(corrected)
}

/** Caller → their members row. */
async function callerMember(database, req) {
  const userId = req.accountability?.user
  if (!userId) return null
  return database('members').where('user', userId).first('id', 'first_name', 'last_name')
}

/**
 * Teams the member currently plays in.
 * ⚠ Gated on teams.active, not member_teams.season: this set decides who can
 * DECRYPT the member's ID document, and it is resolved at ENCRYPTION time. The
 * season column is a create-time stamp uncoupled from the rollover, so a lagged
 * row silently narrowed the recipient set — fail-closed, but with no escrow the
 * document becomes permanently unreadable and the member must re-upload.
 */
async function memberTeamIds(database, memberId) {
  const rows = await database('member_teams as mt')
    .join('teams as t', 't.id', 'mt.team')
    .where('mt.member', memberId)
    .where('t.active', true)
    .select('mt.team as team')
  return rows.map((r) => Number(r.team)).filter(Number.isInteger)
}

/**
 * The people allowed to read this member's ID: the member, plus the coaches and team
 * responsibles of every team they play in.
 *
 * Read via the junction tables directly. Expanding the M2M alias off `teams` returns
 * JUNCTION row ids, not member ids, unless you ask for `.members_id` — and a wrong id here
 * would wrap a member's passport to a stranger who happens to share that number. Same class
 * of bug as the 2026-05-12 ghost roster, with a much worse blast radius.
 */
async function recipientsFor(database, memberId) {
  const teamIds = await memberTeamIds(database, memberId)

  let staff = []
  if (teamIds.length) {
    const [coaches, responsibles] = await Promise.all([
      database('teams_coaches').whereIn('teams_id', teamIds).select('members_id'),
      database('teams_responsibles').whereIn('teams_id', teamIds).select('members_id'),
    ])
    staff = [...coaches, ...responsibles].map((r) => Number(r.members_id))
  }

  const ids = [...new Set([Number(memberId), ...staff])].filter(Number.isInteger)

  // Only people who actually HAVE a keypair can be wrapped to. Someone who has never logged
  // in has no public key, so there is nothing to wrap to — they simply are not a recipient
  // until they set one up.
  const rows = await database('members')
    .whereIn('id', ids)
    .whereNotNull('e2ee_public_key')
    .select('id', 'first_name', 'last_name', 'e2ee_public_key', 'e2ee_key_created')

  return rows.map((r) => ({
    member: Number(r.id),
    is_self: Number(r.id) === Number(memberId),
    first_name: r.first_name,
    last_name: r.last_name,
    public_key: r.e2ee_public_key,
    key_created: r.e2ee_key_created,
  }))
}

/**
 * May `caller` read `member`'s document right now?
 * Owner: always. Coach/TR: only inside the pre-load window of one of that member's games.
 * Admin: NO. An admin has no envelope, so they could not decrypt it anyway — but say no
 * explicitly rather than let them pull ciphertext they have no business holding.
 */
async function mayRead(database, callerId, memberId) {
  if (Number(callerId) === Number(memberId)) return { ok: true, as: 'self' }

  const teamIds = await memberTeamIds(database, memberId)
  if (!teamIds.length) return { ok: false }

  const [coach, tr] = await Promise.all([
    database('teams_coaches').whereIn('teams_id', teamIds).where('members_id', callerId).first('id'),
    database('teams_responsibles').whereIn('teams_id', teamIds).where('members_id', callerId).first('id'),
  ])
  if (!coach && !tr) return { ok: false }

  // Is one of those teams playing soon? Cheap: only scheduled games around today.
  const now = Date.now()
  const games = await database('games')
    .whereIn('kscw_team', teamIds)
    .where('status', 'scheduled')
    .whereBetween('date', [
      dateYMD(new Date(now - 24 * 3600 * 1000)),
      dateYMD(new Date(now + 24 * 3600 * 1000)),
    ])
    .select('id', 'date', 'time')

  for (const g of games) {
    const start = gameStartMs(g)
    if (start == null) continue
    if (now >= start - PRELOAD_BEFORE_MS && now <= start + PRELOAD_AFTER_MS) {
      return { ok: true, as: 'staff', game: g.id, kickoff: new Date(start).toISOString() }
    }
  }
  return { ok: false, reason: 'outside_window' }
}

export function registerIdentityDocument(router, ctx) {
  const { database, logger } = ctx
  const log = logger.child({ endpoint: 'identity-document' })

  // ── my key material ────────────────────────────────────────────────────────
  router.get('/identity/keys', async (req, res) => {
    try {
      const me = await callerMember(database, req)
      if (!me) return res.status(401).json({ error: 'Authentication required' })

      const row = await database('members').where('id', me.id)
        .first('e2ee_public_key', 'e2ee_private_key', 'e2ee_kdf_salt', 'e2ee_key_created')

      res.json({
        data: row?.e2ee_public_key
          ? {
            has_keys: true,
            public_key: row.e2ee_public_key,
            private_key: row.e2ee_private_key,
            salt: row.e2ee_kdf_salt,
            key_created: row.e2ee_key_created,
          }
          : { has_keys: false },
      })
    } catch (err) {
      log.error({ msg: `GET identity/keys: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── create / replace my keypair ────────────────────────────────────────────
  //
  // Replacing is DESTRUCTIVE and says so: a new keypair cannot open anything wrapped to the
  // old one. So we delete the member's own document (unreadable now) and every envelope
  // addressed to them. Leaving dead rows behind would show a coach an ID that silently
  // fails to decrypt in front of a referee.
  router.post('/identity/keys', async (req, res) => {
    try {
      const me = await callerMember(database, req)
      if (!me) return res.status(401).json({ error: 'Authentication required' })

      const { public_key: pub, private_key: priv, salt } = req.body ?? {}
      if (!pub || !priv || !salt) {
        return res.status(400).json({ error: 'public_key, private_key and salt are required' })
      }

      const existing = await database('members').where('id', me.id).first('e2ee_public_key')
      const replacing = !!existing?.e2ee_public_key

      let orphanedDocs = 0
      let orphanedEnvelopes = 0
      await database.transaction(async (trx) => {
        if (replacing) {
          orphanedDocs = await trx('identity_documents').where('member', me.id).del()
          orphanedEnvelopes = await trx('identity_document_keys').where('recipient', me.id).del()
        }
        await trx('members').where('id', me.id).update({
          e2ee_public_key: pub,
          e2ee_private_key: priv,
          e2ee_kdf_salt: salt,
          e2ee_key_created: new Date(),
        })
      })

      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: replacing ? 'update' : 'create',
        collection: 'members',
        recordId: String(me.id),
        data: { what: 'e2ee_keypair', replacing, orphanedDocs, orphanedEnvelopes },
      })

      res.json({ data: { ok: true, replaced: replacing, orphaned_documents: orphanedDocs } })
    } catch (err) {
      log.error({ msg: `POST identity/keys: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── who may read this member's ID (their public keys, to wrap to) ──────────
  router.get('/identity/recipients/:member', async (req, res) => {
    try {
      const me = await callerMember(database, req)
      const isAdmin = req.accountability?.admin === true
      if (!me && !isAdmin) return res.status(401).json({ error: 'Authentication required' })

      const target = Number(req.params.member)
      if (!Number.isInteger(target)) return res.status(400).json({ error: 'Bad member' })

      // You may wrap for yourself, or — as an admin — on someone's behalf. Note the admin
      // is NOT in the returned list, so an admin who uploads for a member cannot read the
      // result back. That is deliberate: they saw the plaintext in their hands, but they do
      // not get a standing key to it.
      if (!isAdmin && Number(me.id) !== target) {
        return res.status(403).json({ error: 'Not your document', code: 'not_owner' })
      }

      res.json({ data: { recipients: await recipientsFor(database, target) } })
    } catch (err) {
      log.error({ msg: `GET identity/recipients: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── upload the ciphertext ──────────────────────────────────────────────────
  //
  // The client cannot POST /files for this. The identity folder is excluded from the Member
  // file-read policy, so Directus creates the row and then, having no read access to hand
  // back, answers 204 with an EMPTY BODY — the client never learns the file id. (Found by
  // running the real round-trip against dev; it is exactly the kind of thing that looks fine
  // in review and fails on contact.) So the upload goes through here, privileged, and we
  // return the id ourselves.
  //
  // Raw body, not multipart: the payload is already-encrypted bytes, so there is nothing to
  // parse. Stream straight into FilesService.
  router.post('/identity/upload', async (req, res) => {
    try {
      const me = await callerMember(database, req)
      const isAdmin = req.accountability?.admin === true
      if (!me && !isAdmin) return res.status(401).json({ error: 'Authentication required' })

      if (Number(req.headers['content-length'] || 0) > UPLOAD_MAX_BYTES) {
        return res.status(413).json({ error: 'File too large', code: 'too_large' })
      }

      // ⚠ The byte counter MUST sit INSIDE the pipeline, never in a `req.on('data')`
      // listener. Attaching a 'data' listener switches the request into flowing mode
      // immediately, so every chunk emitted before FilesService attaches its own pipe is
      // DISCARDED and the file silently loses its leading bytes. That bug truncated 36
      // registration documents in July before anyone noticed. Here it would be worse than
      // silent: ciphertext has no magic bytes, so no integrity checker could ever spot it —
      // the only symptom would be a coach's decrypt failing in front of a referee. A
      // Transform counts AND forwards, so the bytes reach the store intact.
      let bytes = 0
      const capped = new Transform({
        transform(chunk, _enc, cb) {
          bytes += chunk.length
          if (bytes > UPLOAD_MAX_BYTES) {
            cb(Object.assign(new Error('File too large'), { status: 413 }))
            return
          }
          cb(null, chunk)
        },
      })
      req.on('error', (err) => capped.destroy(err))
      req.pipe(capped)

      const { FilesService } = ctx.services
      const filesService = new FilesService({ schema: await ctx.getSchema(), knex: database })
      const storage = (process.env.STORAGE_LOCATIONS || 'local').split(',')[0].trim()
      const fileId = await filesService.uploadOne(capped, {
        storage,
        filename_download: 'identity.enc',
        type: 'application/octet-stream',
        folder: IDENTITY_FOLDER,
      })

      res.json({ data: { id: fileId, bytes } })
    } catch (err) {
      const status = err.status === 413 ? 413 : 500
      log.error({ msg: `POST identity/upload: ${err.message}`, stack: err.stack })
      if (!res.headersSent) {
        res.status(status).json({ error: status === 413 ? 'File too large' : 'Internal error' })
      }
    }
  })

  // ── store the encrypted document + its envelopes ───────────────────────────
  router.post('/identity/document', async (req, res) => {
    try {
      const me = await callerMember(database, req)
      const isAdmin = req.accountability?.admin === true
      if (!me && !isAdmin) return res.status(401).json({ error: 'Authentication required' })

      const { member, file, iv, mime, size, envelopes } = req.body ?? {}
      const target = Number(member)
      if (!Number.isInteger(target) || !file || !iv || !Array.isArray(envelopes)) {
        return res.status(400).json({ error: 'member, file, iv and envelopes are required' })
      }
      if (!isAdmin && Number(me?.id) !== target) {
        return res.status(403).json({ error: 'Not your document', code: 'not_owner' })
      }

      // The file must be the ciphertext we just took in, in the private folder — not an
      // arbitrary uuid pointed at someone else's asset.
      const fileRow = await database('directus_files').where('id', file).first('id', 'folder')
      if (!fileRow || String(fileRow.folder) !== IDENTITY_FOLDER) {
        return res.status(400).json({ error: 'File is not an identity document', code: 'bad_file' })
      }

      // WHO MAY HOLD A KEY IS DECIDED HERE. The client says who it wrapped to; we drop
      // anyone who is not the member or a coach/TR of a team they actually play in.
      const allowed = await recipientsFor(database, target)
      const allowedById = new Map(allowed.map((r) => [r.member, r]))
      const accepted = envelopes
        .filter((e) => e && allowedById.has(Number(e.recipient)))
        .filter((e) => e.eph_public_key && e.wrap_iv && e.wrapped_key)
      const rejected = envelopes.length - accepted.length

      if (!accepted.some((e) => Number(e.recipient) === target)) {
        // Without an envelope for themselves the member could never read their own document
        // back. That is always a bug in the caller, never something to persist.
        return res.status(400).json({ error: 'No envelope for the member', code: 'no_self_envelope' })
      }

      await database.transaction(async (trx) => {
        // One document per member: replacing drops the old ciphertext row (and, by cascade,
        // its envelopes).
        await trx('identity_documents').where('member', target).del()

        const [doc] = await trx('identity_documents').insert({
          member: target,
          file,
          iv,
          mime: mime ?? null,
          size: Number.isInteger(Number(size)) ? Number(size) : null,
          uploaded_by: me ? Number(me.id) : null,
          uploaded_by_self: !!me && Number(me.id) === target,
          date_created: new Date(),
          date_updated: new Date(),
        }).returning('id')

        const docId = typeof doc === 'object' ? doc.id : doc
        await trx('identity_document_keys').insert(accepted.map((e) => ({
          document: docId,
          recipient: Number(e.recipient),
          eph_public_key: e.eph_public_key,
          wrap_iv: e.wrap_iv,
          wrapped_key: e.wrapped_key,
          recipient_key_created: allowedById.get(Number(e.recipient))?.key_created ?? null,
          date_created: new Date(),
        })))
      })

      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'create',
        collection: 'identity_documents',
        recordId: String(target),
        data: {
          what: 'identity_document_upload',
          member: target,
          by_self: !!me && Number(me.id) === target,
          recipients: accepted.length,
          rejected_recipients: rejected,
        },
      })

      res.json({ data: { ok: true, recipients: accepted.length, rejected } })
    } catch (err) {
      log.error({ msg: `POST identity/document: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── read: metadata + MY envelope ───────────────────────────────────────────
  router.get('/identity/document/:member', async (req, res) => {
    try {
      const me = await callerMember(database, req)
      if (!me) return res.status(401).json({ error: 'Authentication required' })

      const target = Number(req.params.member)
      const verdict = await mayRead(database, me.id, target)
      if (!verdict.ok) {
        return res.status(403).json({
          error: 'Not available',
          code: verdict.reason === 'outside_window' ? 'outside_window' : 'not_allowed',
        })
      }

      const doc = await database('identity_documents').where('member', target)
        .first('id', 'iv', 'mime', 'size', 'date_created', 'uploaded_by_self')
      if (!doc) return res.status(404).json({ error: 'No document', code: 'no_document' })

      // Only the envelope addressed to the CALLER. Handing over anyone else's would be
      // pointless (they cannot open it) but it is still not theirs to hold.
      const env = await database('identity_document_keys')
        .where({ document: doc.id, recipient: me.id })
        .first('eph_public_key', 'wrap_iv', 'wrapped_key', 'recipient_key_created')
      if (!env) return res.status(403).json({ error: 'No key for you', code: 'no_envelope' })

      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'read',
        collection: 'identity_documents',
        recordId: String(target),
        data: { what: 'identity_document_open', member: target, as: verdict.as, game: verdict.game ?? null },
      })

      res.json({
        data: {
          iv: doc.iv,
          mime: doc.mime,
          size: doc.size,
          uploaded_at: doc.date_created,
          uploaded_by_self: doc.uploaded_by_self,
          envelope: {
            eph_public_key: env.eph_public_key,
            wrap_iv: env.wrap_iv,
            wrapped_key: env.wrapped_key,
          },
          /** Stale = the caller re-keyed since this was wrapped; it will NOT decrypt. */
          stale: env.recipient_key_created == null ? false : undefined,
          access: verdict.as,
          kickoff: verdict.kickoff ?? null,
        },
      })
    } catch (err) {
      log.error({ msg: `GET identity/document: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── read: the ciphertext ───────────────────────────────────────────────────
  router.get('/identity/document/:member/bytes', async (req, res) => {
    try {
      const me = await callerMember(database, req)
      if (!me) return res.status(401).json({ error: 'Authentication required' })

      const target = Number(req.params.member)
      const verdict = await mayRead(database, me.id, target)
      if (!verdict.ok) return res.status(403).json({ error: 'Not available', code: 'not_allowed' })

      const doc = await database('identity_documents').where('member', target).first('id', 'file')
      if (!doc) return res.status(404).json({ error: 'No document', code: 'no_document' })

      // The caller must hold an envelope. Without one the bytes are noise to them — but
      // there is no reason to hand out ciphertext to someone who cannot open it.
      const env = await database('identity_document_keys')
        .where({ document: doc.id, recipient: me.id })
        .first('id')
      if (!env) return res.status(403).json({ error: 'No key for you', code: 'no_envelope' })

      // streamManagedFile runs as sudo — authorisation happened above, and the file id comes
      // from the member's own identity_documents row, never from user input. That is exactly
      // the contract storage-read.js states in its header.
      res.setHeader('Cache-Control', 'private, no-store')
      await streamManagedFile(doc.file, ctx, res, { type: 'application/octet-stream' })
    } catch (err) {
      log.error({ msg: `GET identity/document/bytes: ${err.message}`, stack: err.stack })
      if (!res.headersSent) res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── delete ─────────────────────────────────────────────────────────────────
  router.delete('/identity/document/:member', async (req, res) => {
    try {
      const me = await callerMember(database, req)
      const isAdmin = req.accountability?.admin === true
      if (!me && !isAdmin) return res.status(401).json({ error: 'Authentication required' })

      const target = Number(req.params.member)
      if (!isAdmin && Number(me?.id) !== target) {
        return res.status(403).json({ error: 'Not your document', code: 'not_owner' })
      }

      const removed = await database('identity_documents').where('member', target).del()

      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'delete',
        collection: 'identity_documents',
        recordId: String(target),
        data: { what: 'identity_document_delete', member: target, removed },
      })

      res.json({ data: { ok: true, removed } })
    } catch (err) {
      log.error({ msg: `DELETE identity/document: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
