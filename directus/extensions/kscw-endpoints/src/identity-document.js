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
 *   GET    /kscw/identity/status/:team          — WHO on a team has one (presence, no key)
 *   GET    /kscw/identity/gaps                 — who is entitled to MY document but unwrapped
 *   GET    /kscw/identity/gaps/team/:team      — the same, for documents I can repair
 *   POST   /kscw/identity/envelopes            — grant an entitled reader a key (additive)
 *   GET    /kscw/identity/access/:team       — who can actually open a team's documents
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
import { teamPeopleSql } from './activity-roster-sql.js'
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

/** `members.role` is a JSON array column that has also been seen holding a bare string. */
function parseRoles(raw) {
  if (!raw) return []
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)]
  } catch {
    return [String(raw)]
  }
}

/**
 * May `caller` see WHO on this team has a document? Coaches and TRs of the team, plus the
 * club's admins — a sport admin only for teams of their own sport, mirroring
 * `hasAdminAccessToTeam()` in the app.
 *
 * ⚠ The sport-admin branch is not decoration: `accountability.admin` is true only for real
 * Directus admins, and vb_admin/bb_admin have not held `admin_access` since the 2026-07
 * access reconcile. Without it every sport admin gets a 403 on a page they are allowed to
 * manage — and a refused list reads as "nobody uploaded anything", which is the one wrong
 * answer this column must never give.
 */
async function isTeamStaffOrAdmin(database, caller, teamId) {
  if (!caller) return false

  const [coach, tr] = await Promise.all([
    database('teams_coaches').where({ teams_id: teamId, members_id: caller.id }).first('id'),
    database('teams_responsibles').where({ teams_id: teamId, members_id: caller.id }).first('id'),
  ])
  if (coach || tr) return true

  const row = await database('members').where('id', caller.id).first('role')
  const roles = parseRoles(row?.role)
  if (roles.includes('admin') || roles.includes('superuser')) return true
  if (!roles.includes('vb_admin') && !roles.includes('bb_admin')) return false

  const team = await database('teams').where('id', teamId).first('sport')
  const sport = String(team?.sport ?? '')
  return (sport === 'volleyball' && roles.includes('vb_admin'))
    || (sport === 'basketball' && roles.includes('bb_admin'))
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

  // ── who on a team has uploaded one ─────────────────────────────────────────
  //
  // Presence, never content: member id + upload date, no envelope and no ciphertext. The
  // roster page needs it so a coach can chase whoever still owes an ID, and that question is
  // asked weeks before any game, so this deliberately does NOT go through mayRead() — its
  // pre-load window is about DECRYPTING a document, and knowing that one exists is not
  // knowing what is in it.
  //
  // Staff scope, not team scope: only the coaches/TRs of the team (or an admin) get the
  // list. A teammate has no business knowing whose passport is on file.
  //
  // ⚠ `teamPeopleSql`, not a bare `member_teams` join — a staff-only coach has no
  // member_teams row, so joining the junction alone would report every one of them as
  // missing a document they had in fact uploaded.
  router.get('/identity/status/:team', async (req, res) => {
    try {
      const me = await callerMember(database, req)
      const isAdmin = req.accountability?.admin === true
      if (!me && !isAdmin) return res.status(401).json({ error: 'Authentication required' })

      const teamId = Number(req.params.team)
      if (!Number.isInteger(teamId)) return res.status(400).json({ error: 'Bad team' })

      if (!isAdmin && !(await isTeamStaffOrAdmin(database, me, teamId))) {
        return res.status(403).json({ error: 'Not staff of this team', code: 'not_staff' })
      }

      const { rows } = await database.raw(
        `SELECT d.member AS member, d.date_created AS uploaded_at, d.uploaded_by_self AS uploaded_by_self
           FROM identity_documents d
          WHERE d.member IN (SELECT p.member FROM ${teamPeopleSql('?')} p)`,
        [teamId, teamId],
      )

      res.json({
        data: {
          documents: rows.map((r) => ({
            member: Number(r.member),
            uploaded_at: r.uploaded_at,
            uploaded_by_self: r.uploaded_by_self,
          })),
        },
      })
    } catch (err) {
      log.error({ msg: `GET identity/status: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })


  // ── who is entitled but has no envelope ────────────────────────────────────
  //
  // THE GAP IS A SERVER-SIDE FACT, THE REPAIR IS NOT. We can see perfectly well who ought to
  // hold a key and does not — `recipientsFor()` minus `identity_document_keys` is a plain
  // join, no key material involved. What we cannot do is close it: the content key exists
  // only inside a device that already holds an envelope. So these endpoints DETECT, and hand
  // the arithmetic to a browser that can actually open something.
  //
  // Two shapes, because the two gaps arise differently:
  //   • owner-side  — a coach set up their keypair AFTER the member uploaded (the common
  //     case: `recipientsFor` skips anyone with no public key, so they were never wrapped to)
  //   • staff-side  — same gap, closed on behalf of a whole team by a colleague who already
  //     holds envelopes, so one person repairs N documents instead of N members each acting
  //
  // ⚠ A member with NO keypair at all is NOT a gap and never appears here. There is nothing
  // to wrap to until they generate one; `recipientsFor()` filters them out at source. The
  // fix for that person is "create your identity key", not "someone re-wraps for you", and
  // conflating the two produces a banner nobody can action.
  async function missingFor(database, ownerId, docId) {
    const [allowed, held] = await Promise.all([
      recipientsFor(database, ownerId),
      database('identity_document_keys').where('document', docId).select('recipient'),
    ])
    const haveIt = new Set(held.map((r) => Number(r.recipient)))
    return allowed.filter((r) => !r.is_self && !haveIt.has(r.member))
  }

  // My own document: who is entitled to it and cannot open it.
  router.get('/identity/gaps', async (req, res) => {
    try {
      const me = await callerMember(database, req)
      if (!me) return res.status(401).json({ error: 'Authentication required' })

      const doc = await database('identity_documents').where('member', me.id).first('id')
      if (!doc) return res.json({ data: { document: null, missing: [] } })

      res.json({ data: { document: doc.id, missing: await missingFor(database, me.id, doc.id) } })
    } catch (err) {
      log.error({ msg: `GET identity/gaps: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // A team's documents that I can repair — i.e. the ones I already hold an envelope for.
  //
  // ⚠ THIS RETURNS MY ENVELOPE OUTSIDE THE PRE-LOAD WINDOW, and that is deliberate. Re-
  // granting needs the CONTENT KEY; looking at the document needs the content key AND the
  // ciphertext, and `/bytes` stays window-gated by `mayRead()`. So a repair run at 3am hands
  // back a key that opens nothing the caller can fetch. Window-gating the repair instead
  // would mean access could only ever be restored during a match — which is precisely when
  // nobody has time to fix it.
  router.get('/identity/gaps/team/:team', async (req, res) => {
    try {
      const me = await callerMember(database, req)
      if (!me) return res.status(401).json({ error: 'Authentication required' })

      const teamId = Number(req.params.team)
      if (!Number.isInteger(teamId)) return res.status(400).json({ error: 'Bad team' })
      if (!(await isTeamStaffOrAdmin(database, me, teamId))) {
        return res.status(403).json({ error: 'Not team staff', code: 'not_allowed' })
      }

      // Documents belonging to people on this team, joined to MY envelope for them. An inner
      // join is the access check: no envelope, no row, nothing to repair.
      const rows = await database('identity_documents as d')
        .join('member_teams as mt', 'mt.member', 'd.member')
        .join('identity_document_keys as k', function () {
          this.on('k.document', 'd.id').andOn('k.recipient', database.raw('?', [me.id]))
        })
        .join('members as m', 'm.id', 'd.member')
        .where('mt.team', teamId)
        .distinct('d.id as doc', 'd.member', 'd.iv', 'm.first_name', 'm.last_name',
          'k.eph_public_key', 'k.wrap_iv', 'k.wrapped_key')

      const documents = []
      for (const r of rows) {
        const missing = await missingFor(database, Number(r.member), r.doc)
        if (!missing.length) continue
        documents.push({
          document: r.doc,
          member: Number(r.member),
          first_name: r.first_name,
          last_name: r.last_name,
          /** Mine, to unwrap the content key with. Opens no bytes on its own — see above. */
          envelope: {
            eph_public_key: r.eph_public_key,
            wrap_iv: r.wrap_iv,
            wrapped_key: r.wrapped_key,
          },
          missing,
        })
      }

      res.json({ data: { documents } })
    } catch (err) {
      log.error({ msg: `GET identity/gaps/team: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── add envelopes to an existing document (the repair) ─────────────────────
  //
  // ADDITIVE ONLY. Never deletes, never replaces, never touches the ciphertext. The worst a
  // buggy client can do here is fail to add a row.
  //
  // Who may call it: the owner, or someone who already holds an envelope for the document
  // (which, by construction, means they were entitled staff when it was uploaded). Holding
  // an envelope is the capability — we are not granting a new one, we are letting an
  // existing key-holder pass the key along the list the SERVER already decided.
  //
  // Who may receive one: `recipientsFor()` and nothing else. So a coach cannot widen access
  // beyond the member's own current staff, even by lying about the recipient — same gate the
  // upload path uses.
  router.post('/identity/envelopes', async (req, res) => {
    try {
      const me = await callerMember(database, req)
      if (!me) return res.status(401).json({ error: 'Authentication required' })

      const { member, envelopes } = req.body ?? {}
      const target = Number(member)
      if (!Number.isInteger(target) || !Array.isArray(envelopes) || !envelopes.length) {
        return res.status(400).json({ error: 'member and envelopes are required' })
      }

      const doc = await database('identity_documents').where('member', target).first('id')
      if (!doc) return res.status(404).json({ error: 'No document', code: 'no_document' })

      if (Number(me.id) !== target) {
        const mine = await database('identity_document_keys')
          .where({ document: doc.id, recipient: me.id }).first('id')
        if (!mine) return res.status(403).json({ error: 'No key for you', code: 'no_envelope' })
      }

      const allowed = await recipientsFor(database, target)
      const allowedById = new Map(allowed.map((r) => [r.member, r]))
      const accepted = envelopes
        .filter((e) => e && allowedById.has(Number(e.recipient)))
        .filter((e) => Number(e.recipient) !== target) // the owner's own envelope already exists
        .filter((e) => e.eph_public_key && e.wrap_iv && e.wrapped_key)
      const rejected = envelopes.length - accepted.length

      if (!accepted.length) {
        return res.status(400).json({ error: 'No acceptable envelopes', code: 'nothing_to_add' })
      }

      // ON CONFLICT DO NOTHING against the (document, recipient) unique: a concurrent repair
      // from two devices must not 500, and re-running must be a no-op rather than a replace.
      // Replacing a live envelope with one wrapped from a stale content key would lock the
      // recipient OUT — the one outcome a repair must never produce.
      //
      // ⚠ The count comes from a read INSIDE the transaction, not from `.returning()`.
      // knex drops the RETURNING clause when `.ignore()` is used, so the insert succeeded
      // and reported zero — a repair that says "0 restored" while having restored nine is
      // worse than one that fails outright, because nobody re-runs it. Caught on dev by
      // checking the row landed rather than trusting the response.
      const granted = await database.transaction(async (trx) => {
        const existing = new Set(
          (await trx('identity_document_keys').where('document', doc.id).select('recipient'))
            .map((r) => Number(r.recipient)),
        )
        const fresh = accepted.filter((e) => !existing.has(Number(e.recipient)))
        if (!fresh.length) return []
        await trx('identity_document_keys')
          .insert(fresh.map((e) => ({
            document: doc.id,
            recipient: Number(e.recipient),
            eph_public_key: e.eph_public_key,
            wrap_iv: e.wrap_iv,
            wrapped_key: e.wrapped_key,
            recipient_key_created: allowedById.get(Number(e.recipient))?.key_created ?? null,
            date_created: new Date(),
          })))
          .onConflict(['document', 'recipient'])
          .ignore()
        return fresh.map((e) => Number(e.recipient))
      })

      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'update',
        collection: 'identity_documents',
        recordId: String(target),
        data: {
          what: 'identity_document_regrant',
          member: target,
          by_self: Number(me.id) === target,
          granted,
          rejected_recipients: rejected,
        },
      })

      res.json({ data: { ok: true, granted: granted.length, rejected } })
    } catch (err) {
      log.error({ msg: `POST identity/envelopes: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })


  // ── who can actually open what (access transparency) ───────────────────────
  //
  // "Entitled" and "able to open" are different facts, and until now nothing showed the
  // difference. A coach appeared in the grant list, held no envelope, and everyone found out
  // at the hall. This is the view that makes the gap visible BEFORE match day.
  //
  // Four states, and the distinction between the last two is the whole point:
  //   holds    — an envelope exists; they can open it
  //   stale    — an envelope exists but was wrapped to a key they have since replaced, so it
  //              will NOT decrypt. Replacing a keypair deletes these, so it should never
  //              appear; it is reported rather than assumed away because "looks fine, fails
  //              on contact" is the failure mode this whole feature cannot afford.
  //   missing  — entitled, has a keypair, was never wrapped to. REPAIRABLE from the team page.
  //   no_key   — entitled by role but has no keypair at all. NOT repairable by anyone: there
  //              is no public key to wrap to. Their fix is to create one, and showing this
  //              separately is what stops people pressing a repair button that cannot help.
  //
  // Deliberately COMPLETE: it lists holders who are staff of the member's other teams too.
  // A partial access list is worse than none — the point is to be able to answer "who can
  // see my passport" without qualification.
  router.get('/identity/access/:team', async (req, res) => {
    try {
      const me = await callerMember(database, req)
      if (!me) return res.status(401).json({ error: 'Authentication required' })

      const teamId = Number(req.params.team)
      if (!Number.isInteger(teamId)) return res.status(400).json({ error: 'Bad team' })
      if (!(await isTeamStaffOrAdmin(database, me, teamId))) {
        return res.status(403).json({ error: 'Not team staff', code: 'not_allowed' })
      }

      const docs = await database('identity_documents as d')
        .join('member_teams as mt', 'mt.member', 'd.member')
        .join('members as m', 'm.id', 'd.member')
        .where('mt.team', teamId)
        .distinct('d.id as doc', 'd.member', 'd.date_created', 'm.first_name', 'm.last_name')
        .orderBy(['m.last_name', 'm.first_name'])

      const documents = []
      for (const d of docs) {
        const owner = Number(d.member)
        const teamIds = await memberTeamIds(database, owner)

        // Everyone entitled by ROLE — including those with no keypair, which `recipientsFor`
        // filters out at source and which is exactly the case we need to name here.
        const staffRows = teamIds.length
          ? await database('members as m')
            .whereIn('m.id', function () {
              this.select('members_id').from('teams_coaches').whereIn('teams_id', teamIds)
                .union(function () {
                  this.select('members_id').from('teams_responsibles').whereIn('teams_id', teamIds)
                })
            })
            .select('m.id', 'm.first_name', 'm.last_name', 'm.e2ee_public_key', 'm.e2ee_key_created')
          : []

        const held = await database('identity_document_keys')
          .where('document', d.doc)
          .select('recipient', 'recipient_key_created')
        const heldBy = new Map(held.map((r) => [Number(r.recipient), r.recipient_key_created]))

        const ownerRow = await database('members').where('id', owner)
          .first('first_name', 'last_name', 'e2ee_key_created')

        const reader = (id, first, last, keyCreated, hasKey, isSelf) => {
          let state
          if (heldBy.has(id)) {
            const wrapped = heldBy.get(id)
            // Compare as epoch ms: knex hands back Date objects, and `!==` on two Dates for
            // the same instant is always true.
            const a = wrapped ? new Date(wrapped).getTime() : null
            const b = keyCreated ? new Date(keyCreated).getTime() : null
            state = a != null && b != null && a !== b ? 'stale' : 'holds'
          } else if (!hasKey) {
            state = 'no_key'
          } else {
            state = 'missing'
          }
          return { member: id, first_name: first, last_name: last, is_self: isSelf, state }
        }

        const readers = [
          reader(owner, ownerRow?.first_name, ownerRow?.last_name, ownerRow?.e2ee_key_created, true, true),
          ...staffRows
            .filter((s) => Number(s.id) !== owner)
            .map((s) => reader(
              Number(s.id), s.first_name, s.last_name, s.e2ee_key_created, !!s.e2ee_public_key, false,
            )),
        ]

        // Anyone holding an envelope who is no longer entitled by role — they left the staff
        // after the upload. The key is not revoked by removing them from a team, so saying
        // "these people can still open it" is the honest answer.
        for (const [id, wrapped] of heldBy) {
          if (readers.some((r) => r.member === id)) continue
          const m = await database('members').where('id', id)
            .first('first_name', 'last_name', 'e2ee_key_created')
          readers.push({
            member: id,
            first_name: m?.first_name,
            last_name: m?.last_name,
            is_self: false,
            state: wrapped && m?.e2ee_key_created
              && new Date(wrapped).getTime() !== new Date(m.e2ee_key_created).getTime()
              ? 'stale' : 'former',
          })
        }

        documents.push({
          member: owner,
          first_name: d.first_name,
          last_name: d.last_name,
          uploaded_at: d.date_created,
          readers,
        })
      }

      res.json({ data: { documents } })
    } catch (err) {
      log.error({ msg: `GET identity/access: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
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
