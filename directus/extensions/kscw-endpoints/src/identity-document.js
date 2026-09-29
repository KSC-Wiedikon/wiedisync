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
 * they wrapped to; we refuse to store an envelope for anyone who is not the member, a
 * coach/TR of a team the member actually plays in, OR (since 2026-09-22) a superadmin
 * (`members.role` holds `'superuser'` — NOT sport admins, NOT a bare Directus session flag) —
 * OR, for a game shared via the guest mechanism (migration 271), a coach/TR of the other
 * team(s) on that game's sheet, scoped to that specific game (`sharedGameTeamIds`). The crypto
 * would not care — a stranger's envelope is only openable by that stranger — but the grant
 * list is the access-control record, and it has to mean something.
 *
 * Superadmins are a STANDING recipient going forward, not a one-off view: every document
 * uploaded from 2026-09-22 on wraps a copy of its key to whoever holds 'superuser' at upload
 * time, so they can open it for any team in the same pre-kickoff window a coach could. This
 * does NOT retroactively unlock documents uploaded before this change — their envelope sets
 * were fixed at upload time and cannot be widened without the owner re-uploading.
 * ⚠ Until the 2026-09-28 audit (F12) that sentence was false: the repair path
 * (`/identity/gaps*` → `/identity/envelopes`) used the same `recipientsFor()` list, so a
 * coach's "Repair access" or the owner's "team leader" banner quietly wrapped OLDER documents
 * to every superadmin. The repair now excludes superadmin-only recipients
 * (`{ superadmins: false }`) — only a fresh upload, the owner's own act, adds them.
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

// Per-login cap on ciphertext uploaded but not (yet) bound to an identity_documents row
// (2026-09-28 audit F34). The client uploads and binds back to back, so a legitimate member
// never holds more than one pending file; unbound files older than the grace period are
// abandoned attempts and are swept (bytes included) the next time that login uploads.
const MAX_PENDING_UPLOADS = 3
const PENDING_GRACE_MS = 60 * 60 * 1000
// Uploads still streaming, per login. A file only counts as pending once `uploaded_by` is
// stamped after uploadOne, so without this a parallel burst would all pass the cap. One
// Directus process, so a module Map is the whole picture.
const inFlightUploads = new Map()

// Fixed in migration 212. Ciphertext only ever lands here, and the Member file-read policy
// excludes it — so it is never reachable via /assets, only through this endpoint.
const IDENTITY_FOLDER = 'd0c00001-0000-4000-8000-000000000001'

// The plaintext type the uploading browser declares for the ciphertext. It is only
// ever used to label the decrypted blob client-side, but a stored value should not
// be attacker-chosen (an `image/svg+xml` or `text/html` label would make a viewer
// render a script). Anything outside the photo / PDF set is stored as
// application/octet-stream (audit 2026-09-28).
const IDENTITY_MIME_ALLOW = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf',
])
export function safeIdentityMime(mime) {
  const m = String(mime ?? '').toLowerCase().split(';')[0].trim()
  if (!m) return null
  if (m === 'image/jpg') return 'image/jpeg'
  return IDENTITY_MIME_ALLOW.has(m) ? m : 'application/octet-stream'
}

// The server releases key + bytes this far ahead so the coach can pre-load while they still
// have a connection. The 45-minute DISPLAY window is enforced by the client (see above).
//
// ⚠ MUST be <= COACH_WINDOW_BEFORE_MS in scorer-roster.js. The Show-IDs screen reads the
// match sheet from there to learn WHO to fetch documents for, so if that window is narrower,
// pre-loading silently downloads nothing.
const PRELOAD_BEFORE_MS = 6 * 60 * 60 * 1000
const PRELOAD_AFTER_MS = 15 * 60 * 1000

// TEST WINDOW — superadmins only, until ID_TEST_WINDOW_UNTIL (a Zurich date, exclusive;
// self-reverts at that midnight): documents are released up to 7 days before kickoff, so
// the Show IDs speed work can be measured on real documents ahead of a game. Mirrors
// ID_TEST_WINDOW_* in src/utils/dateHelpers.ts (the client gates the display). The roster
// endpoint has no twin on purpose: a Directus admin bypasses its window, and the only
// superadmin is one. Do not bump the date forward — delete this.
const ID_TEST_WINDOW_UNTIL = '2026-10-03'
const ID_TEST_WINDOW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000
const idTestWindowActive = (nowMs) =>
  new Date(nowMs).toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' }) < ID_TEST_WINDOW_UNTIL

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

/**
 * Remove identity-folder files (row AND bytes) through FilesService. Used for superseded
 * ciphertext — a replaced, deleted or re-keyed document — and for abandoned uploads
 * (2026-09-28 audit F34: they were never removed, so an ID a member deleted stayed on disk).
 * Never throws: the caller's own write has already committed, and a leftover blob is a
 * retention gap, not a reason to fail the member's request. Only ever passed ids read from
 * our own tables and re-checked against IDENTITY_FOLDER here.
 */
async function purgeIdentityFiles(ctx, fileIds, log) {
  const ids = [...new Set((fileIds || []).filter(Boolean).map(String))]
  if (!ids.length) return 0
  try {
    const { database } = ctx
    // Never a file still referenced by a document, never one outside the identity folder.
    const rows = await database('directus_files as f')
      .whereIn('f.id', ids)
      .where('f.folder', IDENTITY_FOLDER)
      .whereNotExists(function () {
        this.select(database.raw('1')).from('identity_documents as d').whereRaw('d.file = f.id')
      })
      .select('f.id')
    if (!rows.length) return 0
    const { FilesService } = ctx.services
    const filesService = new FilesService({ schema: await ctx.getSchema(), knex: database })
    let removed = 0
    for (const r of rows) {
      try { await filesService.deleteOne(r.id); removed++ } catch (err) {
        log.warn({ msg: `identity file purge failed: ${err.message}`, file: r.id })
      }
    }
    return removed
  } catch (err) {
    log.warn({ msg: `identity file purge failed: ${err.message}` })
    return 0
  }
}

/** Caller → their members row. */
async function callerMember(database, req) {
  const userId = req.accountability?.user
  if (!userId) return null
  return database('members').where('user', userId).first('id', 'first_name', 'last_name')
}

/**
 * Active teams the member is tied to: as a PLAYER (member_teams) or as STAFF (coach /
 * team responsible).
 *
 * Staff since 2026-09-29 (deliberate widening, SECURITY.md): a coach stands on the match
 * sheet as an official and their ID is checked at the table like a player's, so Show IDs
 * lists the officials after the players. A staff-only coach has no member_teams row, so
 * until then their document was wrapped to — and readable by — nobody but themselves.
 * Now the other coaches/TRs of the teams they coach are recipients like any player's.
 *
 * ⚠ Gated on teams.active, not member_teams.season: this set decides who can
 * DECRYPT the member's ID document, and it is resolved at ENCRYPTION time. The
 * season column is a create-time stamp uncoupled from the rollover, so a lagged
 * row silently narrowed the recipient set — fail-closed, but with no escrow the
 * document becomes permanently unreadable and the member must re-upload.
 */
async function memberTeamIds(database, memberId) {
  const rows = await database('teams as t')
    .where('t.active', true)
    .where((q) => q
      .whereIn('t.id', database('member_teams').where('member', memberId).select('team'))
      .orWhereIn('t.id', database('teams_coaches').where('members_id', memberId).select('teams_id'))
      .orWhereIn('t.id', database('teams_responsibles').where('members_id', memberId).select('teams_id')))
    .select('t.id as team')
  return rows.map((r) => Number(r.team)).filter(Number.isInteger)
}

/**
 * Teams tied to `memberId` only through the guest mechanism (migration 271): a host team
 * whose game `memberId` was called up to, or — the flip side — a team invited as a guest
 * into one of `memberId`'s own games. A shared game puts both staffs at the same hall
 * checking the same lineup, so BOTH coaches/TRs need to verify EVERY player on that sheet,
 * not just their own roster's.
 *
 * Deliberately grants every team on the game's sheet (host + all guest openings), not just
 * a 1:1 host↔guest pair — if a game is opened to two teams at once, all three staffs are
 * standing at the same check-in.
 *
 * Bounded to `scheduled` games, mirroring `memberTeamIds`' bound to `teams.active` — a
 * guest slot for a game that already happened is a historical fact, not a standing grant.
 */
/**
 * Knex modifier for the individual-guest branch: count a `game_guests` row only once the
 * guest has CONFIRMED that game. Any coach can put any member on their game's guest list
 * with no acceptance step, so the bare row would let a coach make their own staff a
 * standing recipient of a stranger's ID document (2026-09-28 audit). 'confirmed' only —
 * the same bar the match sheet's RSVP fallback uses (scorer-roster.js); a maybe is not a
 * player at the table. Expects the games alias `g` and guests alias `gg`.
 */
function guestHasConfirmed(database) {
  return (qb) => qb.whereExists(function () {
    this.select(database.raw('1')).from('participations as p')
      .where('p.activity_type', 'game')
      .whereRaw('p.activity_id = g.id::text')
      .whereRaw('p.member = gg.member')
      .where('p.status', 'confirmed')
  })
}

async function sharedGameTeamIds(database, memberId, ownTeamIds) {
  const hostTeamOf = new Map() // gameId -> kscw_team, for every game worth considering

  if (ownTeamIds.length) {
    const hosted = await database('games as g')
      .whereIn('g.kscw_team', ownTeamIds)
      .where('g.status', 'scheduled')
      .whereExists(function () {
        this.select(database.raw('1')).from('game_guest_teams as ggt').whereRaw('ggt.game = g.id')
      })
      .select('g.id', 'g.kscw_team')
    for (const g of hosted) hostTeamOf.set(Number(g.id), Number(g.kscw_team))
  }

  const guestOf = await database('games as g')
    .join('game_guests as gg', 'gg.game', 'g.id')
    .where('gg.member', memberId)
    .modify(guestHasConfirmed(database))
    .where('g.status', 'scheduled')
    .select('g.id', 'g.kscw_team')
  for (const g of guestOf) hostTeamOf.set(Number(g.id), Number(g.kscw_team))

  if (!hostTeamOf.size) return []

  const gameIds = [...hostTeamOf.keys()]
  const openings = await database('game_guest_teams').whereIn('game', gameIds).select('game', 'team')

  const teamIds = new Set(hostTeamOf.values())
  for (const o of openings) teamIds.add(Number(o.team))
  for (const t of ownTeamIds) teamIds.delete(Number(t))

  return [...teamIds]
}

/**
 * The specific game(s) that put `otherTeamId` and `memberId` on the same sheet through the
 * guest mechanism — either `otherTeamId` was opened as a guest team on one of memberId's
 * own games, or `otherTeamId` hosts a game memberId was invited into. Unlike the fixture
 * list used for a player's own team, this must NOT widen to every game `otherTeamId`
 * plays — only the game(s) that actually connect these two.
 */
async function gamesLinkingTeams(database, memberId, ownTeamIds, otherTeamId) {
  const rows = []

  if (ownTeamIds.length) {
    const hosted = await database('games as g')
      .join('game_guest_teams as ggt', function () {
        this.on('ggt.game', 'g.id').andOn('ggt.team', database.raw('?', [otherTeamId]))
      })
      .whereIn('g.kscw_team', ownTeamIds)
      .where('g.status', 'scheduled')
      .select('g.id', 'g.date', 'g.time')
    rows.push(...hosted)
  }

  const guestOf = await database('games as g')
    .join('game_guests as gg', 'gg.game', 'g.id')
    .where('gg.member', memberId)
    .modify(guestHasConfirmed(database))
    .where('g.kscw_team', otherTeamId)
    .where('g.status', 'scheduled')
    .select('g.id', 'g.date', 'g.time')
  rows.push(...guestOf)

  return rows
}

/**
 * The people allowed to read this member's ID: the member, plus the coaches and team
 * responsibles of every team they play in or coach — and, for a shared game, the coaches/TRs of
 * the other team(s) on that game's sheet too (`sharedGameTeamIds`).
 *
 * Read via the junction tables directly. Expanding the M2M alias off `teams` returns
 * JUNCTION row ids, not member ids, unless you ask for `.members_id` — and a wrong id here
 * would wrap a member's passport to a stranger who happens to share that number. Same class
 * of bug as the 2026-05-12 ghost roster, with a much worse blast radius.
 */
async function recipientsFor(database, memberId, { superadmins = true } = {}) {
  const teamIds = await memberTeamIds(database, memberId)
  const sharedTeamIds = await sharedGameTeamIds(database, memberId, teamIds)
  const allTeamIds = [...new Set([...teamIds, ...sharedTeamIds])]

  let staff = []
  if (allTeamIds.length) {
    const [coaches, responsibles] = await Promise.all([
      database('teams_coaches').whereIn('teams_id', allTeamIds).select('members_id'),
      database('teams_responsibles').whereIn('teams_id', allTeamIds).select('members_id'),
    ])
    staff = [...coaches, ...responsibles].map((r) => Number(r.members_id))
  }

  // Superadmins ride along only on a fresh upload (the owner's own act). The repair paths
  // pass `superadmins: false` — see the header (2026-09-28 audit F12). A superadmin who is
  // also staff of one of the member's teams is still in `staff` above.
  const superIds = superadmins ? await superadminIds(database) : []

  const ids = [...new Set([Number(memberId), ...staff, ...superIds])].filter(Number.isInteger)

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
 * Who a RE-ENCODED document (`recompress`, 2026-09-29) may be wrapped to: the member and
 * their teams' staff, exactly as the repair path — plus any superadmin who ALREADY holds
 * an envelope on the current document. A recompress is not the owner's informed act of
 * uploading (it runs by itself in the owner's app, and an admin can trigger it from Show
 * IDs), so it must never widen the reader set to superadmins (2026-09-28 audit F12): it
 * only carries forward what exists. null when the member has no document to recompress.
 */
async function recompressRecipients(database, memberId) {
  const doc = await database('identity_documents').where('member', memberId).first('id')
  if (!doc) return null
  const [staff, everyone, holders] = await Promise.all([
    recipientsFor(database, memberId, { superadmins: false }),
    recipientsFor(database, memberId),
    database('identity_document_keys').where('document', doc.id).select('recipient'),
  ])
  const keep = new Set([...staff.map((r) => r.member), ...holders.map((r) => Number(r.recipient))])
  return everyone.filter((r) => keep.has(r.member))
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
 * A member holding the app-level 'superuser' role (a bare Directus admin session does NOT
 * count — see mayRead). Mirrors
 * `season-health.js`'s `isSuperadmin()` and the frontend's `isSuperAdmin` (roles.includes
 * ('superuser')) — deliberately NOT `isAdmin`/`isGlobalAdmin`/`hasAdminAccessToTeam`, which
 * also grant vb_admin/bb_admin (sport admins). Sport admins get no standing decryption key.
 */
async function isSuperadmin(database, accountability) {
  // No `accountability.admin` shortcut: mayRead()'s contract is that a bare Directus
  // admin session without the 'superuser' role gets NO (it holds no envelope). The
  // shortcut contradicted that — its only caller is mayRead().
  const userId = accountability?.user
  if (!userId) return false
  const caller = await database('members').where('user', userId).first('role')
  return parseRoles(caller?.role).includes('superuser')
}

/** Every member currently holding the app-level 'superuser' role. */
async function superadminIds(database) {
  const rows = await database('members').whereNotNull('role').select('id', 'role')
  return rows.filter((r) => parseRoles(r.role).includes('superuser')).map((r) => Number(r.id))
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
 * Owner: always. Coach/TR of the member's own team: inside the pre-load window of one of
 * that team's games. Coach/TR of a team sharing a game with the member via the guest
 * mechanism (`sharedGameTeamIds`): inside the pre-load window of THAT specific game only —
 * not every game their own team plays, since nothing else connects the two of them.
 * Superadmin (since 2026-09-22): treated as staff of EVERY team the member is tied to, so
 * the same window check applies to any team — but they still need a wrapped envelope (see
 * `recipientsFor`/`superadminIds`), and a document uploaded before this change has none.
 * A bare Directus admin session without the 'superuser' role: NO. They have no envelope, so
 * they could not decrypt it anyway — say no explicitly rather than let them pull ciphertext
 * they have no business holding.
 */
async function mayRead(database, callerId, memberId, accountability) {
  if (Number(callerId) === Number(memberId)) return { ok: true, as: 'self' }

  const ownTeamIds = await memberTeamIds(database, memberId)
  const sharedTeamIds = await sharedGameTeamIds(database, memberId, ownTeamIds)
  const allTeamIds = [...new Set([...ownTeamIds, ...sharedTeamIds])]
  if (!allTeamIds.length) return { ok: false }

  const isSuper = await isSuperadmin(database, accountability)

  let staffTeamIds
  if (isSuper) {
    staffTeamIds = allTeamIds
  } else {
    const [coachRows, trRows] = await Promise.all([
      database('teams_coaches').whereIn('teams_id', allTeamIds).where('members_id', callerId).select('teams_id'),
      database('teams_responsibles').whereIn('teams_id', allTeamIds).where('members_id', callerId).select('teams_id'),
    ])
    staffTeamIds = [...new Set([...coachRows, ...trRows].map((r) => Number(r.teams_id)))]
    if (!staffTeamIds.length) return { ok: false }
  }

  // Cheap: only scheduled games around today. Prefer the own-team fixture list when the
  // caller matches it (the fuller, more common signal) — fall back to the specific
  // game(s) the guest mechanism connects them through otherwise.
  const now = Date.now()
  const testWindow = isSuper && idTestWindowActive(now)
  const before = testWindow ? ID_TEST_WINDOW_BEFORE_MS : PRELOAD_BEFORE_MS
  const games = staffTeamIds.some((t) => ownTeamIds.includes(t))
    ? await database('games')
      .whereIn('kscw_team', ownTeamIds)
      .where('status', 'scheduled')
      .whereBetween('date', [
        dateYMD(new Date(now - 24 * 3600 * 1000)),
        dateYMD(new Date(now + 24 * 3600 * 1000 + (testWindow ? before : 0))),
      ])
      .select('id', 'date', 'time')
    : (await Promise.all(
      staffTeamIds.map((t) => gamesLinkingTeams(database, memberId, ownTeamIds, t)),
    )).flat()

  for (const g of games) {
    const start = gameStartMs(g)
    if (start == null) continue
    if (now >= start - before && now <= start + PRELOAD_AFTER_MS) {
      return { ok: true, as: isSuper ? 'superadmin' : 'staff', game: g.id, kickoff: new Date(start).toISOString() }
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
      let orphanedFiles = []
      await database.transaction(async (trx) => {
        if (replacing) {
          orphanedFiles = (await trx('identity_documents').where('member', me.id).select('file'))
            .map((r) => r.file)
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

      // The re-keyed document is unreadable by construction — drop its ciphertext too (F34).
      if (orphanedFiles.length) await purgeIdentityFiles(ctx, orphanedFiles, log)

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

      // You may wrap for yourself, or — as an admin — on someone's behalf. A bare Directus
      // admin session is NOT itself in the returned list, so uploading for a member on that
      // basis alone does not grant a standing key back. A member holding the 'superuser' app
      // role DOES appear, same as any other permanent reader — see `recipientsFor`.
      if (!isAdmin && Number(me.id) !== target) {
        return res.status(403).json({ error: 'Not your document', code: 'not_owner' })
      }

      // `?recompress=1`: the narrower set a re-encoded document may go to — see
      // recompressRecipients(). The POST below enforces the same set.
      if (req.query.recompress === '1') {
        const recipients = await recompressRecipients(database, target)
        if (!recipients) return res.status(404).json({ error: 'No document', code: 'no_document' })
        return res.json({ data: { recipients } })
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
    let inFlightClaimed = false
    try {
      const me = await callerMember(database, req)
      const isAdmin = req.accountability?.admin === true
      if (!me && !isAdmin) return res.status(401).json({ error: 'Authentication required' })

      if (Number(req.headers['content-length'] || 0) > UPLOAD_MAX_BYTES) {
        return res.status(413).json({ error: 'File too large', code: 'too_large' })
      }

      // Per-login cap (2026-09-28 audit F34). Sweep this login's abandoned uploads first,
      // then refuse while too many fresh ones are still unbound — a loop of uploads that
      // never bind cannot fill the disk.
      const uploader = req.accountability?.user ?? null
      if (uploader) {
        const pending = await database('directus_files as f')
          .where('f.folder', IDENTITY_FOLDER)
          .where('f.uploaded_by', uploader)
          .whereNotExists(function () {
            this.select(database.raw('1')).from('identity_documents as d').whereRaw('d.file = f.id')
          })
          .select('f.id', 'f.uploaded_on')
        const cutoff = Date.now() - PENDING_GRACE_MS
        const stale = pending.filter((f) => f.uploaded_on && new Date(f.uploaded_on).getTime() < cutoff)
        if (stale.length) await purgeIdentityFiles(ctx, stale.map((f) => f.id), log)
        if (pending.length - stale.length + (inFlightUploads.get(uploader) || 0) >= MAX_PENDING_UPLOADS) {
          return res.status(429).json({ error: 'Too many pending uploads', code: 'too_many_pending' })
        }
        // Claimed synchronously after the check (no await in between), released in the
        // finally below once the file is stamped or the upload failed.
        inFlightUploads.set(uploader, (inFlightUploads.get(uploader) || 0) + 1)
        inFlightClaimed = true
      }

      // Everything that awaits happens BEFORE the pipe starts (2026-09-28 audit F16): an
      // async gap between `req.pipe()` and the consumer is exactly when an early stream
      // error has nobody listening. Same pattern as scorer-exam.js.
      const { FilesService } = ctx.services
      const filesService = new FilesService({ schema: await ctx.getSchema(), knex: database })
      const storage = (process.env.STORAGE_LOCATIONS || 'local').split(',')[0].trim()

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
      // ⚠⚠ NOT OPTIONAL: a stream 'error' with no listener is an uncaught exception that
      // kills the Directus process (client abort, oversize body). Attach it at creation,
      // before the first chunk can flow; capture so the real 413 reaches the client.
      let streamError = null
      capped.on('error', (err) => { streamError = err })
      req.on('error', (err) => capped.destroy(err))
      req.pipe(capped)

      let fileId
      try {
        fileId = await filesService.uploadOne(capped, {
          storage,
          filename_download: 'identity.enc',
          type: 'application/octet-stream',
          folder: IDENTITY_FOLDER,
        })
      } catch (err) {
        throw streamError || err
      }
      if (streamError) {
        // Never keep a truncated blob: ciphertext cannot be checked for integrity later.
        await purgeIdentityFiles(ctx, [fileId], log)
        throw streamError
      }
      // FilesService ran without accountability, so it stamped no uploader. Record the login
      // ourselves — it is what the pending-upload cap above counts on.
      if (uploader) {
        await database('directus_files').where('id', fileId).update({ uploaded_by: uploader })
      }

      res.json({ data: { id: fileId, bytes } })
    } catch (err) {
      const status = err.status === 413 ? 413 : 500
      log.error({ msg: `POST identity/upload: ${err.message}`, stack: err.stack })
      if (!res.headersSent) {
        res.status(status).json({ error: status === 413 ? 'File too large' : 'Internal error' })
      }
    } finally {
      if (inFlightClaimed) {
        const uploader = req.accountability?.user
        const n = (inFlightUploads.get(uploader) || 1) - 1
        if (n > 0) inFlightUploads.set(uploader, n)
        else inFlightUploads.delete(uploader)
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
      // A smaller re-encoding of the SAME document (Show IDs speed, 2026-09-29): keeps the
      // owner's attribution and upload date, and never widens who can read it.
      const recompress = req.body?.recompress === true
      const target = Number(member)
      if (!Number.isInteger(target) || !file || !iv || !Array.isArray(envelopes)) {
        return res.status(400).json({ error: 'member, file, iv and envelopes are required' })
      }
      if (!isAdmin && Number(me?.id) !== target) {
        return res.status(403).json({ error: 'Not your document', code: 'not_owner' })
      }

      // The file must be the ciphertext we just took in, in the private folder — not an
      // arbitrary uuid pointed at someone else's asset.
      // A non-admin may only bind a file their own login uploaded — not another login's
      // pending ciphertext they learned the uuid of.
      const fileRow = await database('directus_files').where('id', file).first('id', 'folder', 'uploaded_by')
      if (!fileRow || String(fileRow.folder) !== IDENTITY_FOLDER
        || (!isAdmin && String(fileRow.uploaded_by ?? '') !== String(req.accountability?.user ?? ''))) {
        return res.status(400).json({ error: 'File is not an identity document', code: 'bad_file' })
      }

      // WHO MAY HOLD A KEY IS DECIDED HERE. The client says who it wrapped to; we drop
      // anyone who is not the member or a coach/TR of a team they actually play in.
      const allowed = recompress ? await recompressRecipients(database, target) : await recipientsFor(database, target)
      if (!allowed) return res.status(409).json({ error: 'No document to recompress', code: 'no_document' })
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

      // The file must not already back someone's document (re-binding another member's
      // ciphertext id would let the replace below purge it).
      // Checked inside the transaction, under a row lock on the file, so two concurrent
      // binds of the same id cannot both pass.
      let supersededFile = null
      let fileTaken = false
      let prevRow = null
      await database.transaction(async (trx) => {
        await trx('directus_files').where('id', file).forUpdate().first('id')
        const inUse = await trx('identity_documents').where('file', file).whereNot('member', target).first('id')
        if (inUse) { fileTaken = true; return }

        // One document per member: replacing drops the old ciphertext row (and, by cascade,
        // its envelopes). The old ciphertext file itself is purged after commit (F34).
        const prev = await trx('identity_documents').where('member', target)
          .first('file', 'size', 'uploaded_by', 'uploaded_by_self', 'date_created')
        // Recompress replaces an existing document or nothing — never creates one.
        if (recompress && !prev) return
        prevRow = prev ?? null
        if (prev?.file && String(prev.file) !== String(file)) supersededFile = prev.file
        await trx('identity_documents').where('member', target).del()

        const [doc] = await trx('identity_documents').insert({
          member: target,
          file,
          iv,
          mime: safeIdentityMime(mime),
          size: Number.isInteger(Number(size)) ? Number(size) : null,
          uploaded_by: recompress ? prev.uploaded_by : (me ? Number(me.id) : null),
          uploaded_by_self: recompress ? prev.uploaded_by_self : (!!me && Number(me.id) === target),
          date_created: recompress ? prev.date_created : new Date(),
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
      if (fileTaken) return res.status(400).json({ error: 'File is not an identity document', code: 'bad_file' })
      if (recompress && !prevRow) return res.status(409).json({ error: 'No document to recompress', code: 'no_document' })

      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: recompress ? 'update' : 'create',
        collection: 'identity_documents',
        recordId: String(target),
        data: {
          what: recompress ? 'identity_document_recompress' : 'identity_document_upload',
          member: target,
          by_self: !!me && Number(me.id) === target,
          recipients: accepted.length,
          rejected_recipients: rejected,
          ...(recompress ? { from_size: prevRow.size ?? null, to_size: Number(size) || null } : {}),
        },
      })

      if (supersededFile) await purgeIdentityFiles(ctx, [supersededFile], log)

      res.json({ data: { ok: true, recipients: accepted.length, rejected } })
    } catch (err) {
      log.error({ msg: `POST identity/document: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── read: metadata + MY envelope ───────────────────────────────────────────
  router.get('/identity/document/:member', async (req, res) => {
    try {
      const t0 = Date.now()
      const me = await callerMember(database, req)
      if (!me) return res.status(401).json({ error: 'Authentication required' })

      const target = Number(req.params.member)
      const verdict = await mayRead(database, me.id, target, req.accountability)
      const authMs = Date.now() - t0
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
      // Show IDs timing (2026-09-29) — pairs with the `[ids]` console trace in ShowIdsModal.
      log.info(`[ids] meta member=${target} caller=${me.id} as=${verdict.as} auth=${authMs}ms total=${Date.now() - t0}ms`)
    } catch (err) {
      log.error({ msg: `GET identity/document: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── read: the ciphertext ───────────────────────────────────────────────────
  router.get('/identity/document/:member/bytes', async (req, res) => {
    try {
      const t0 = Date.now()
      const me = await callerMember(database, req)
      if (!me) return res.status(401).json({ error: 'Authentication required' })

      const target = Number(req.params.member)
      const verdict = await mayRead(database, me.id, target, req.accountability)
      const authMs = Date.now() - t0
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
      const ts = Date.now()
      await streamManagedFile(doc.file, ctx, res, { type: 'application/octet-stream' })
      // `stream` = R2 read + hand-off until the response finished leaving this process.
      log.info(`[ids] bytes member=${target} caller=${me.id} auth=${authMs}ms stream=${Date.now() - ts}ms total=${Date.now() - t0}ms`)
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
      recipientsFor(database, ownerId, { superadmins: false }),
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

      // Repair never widens to superadmins (2026-09-28 audit F12): the banner and the team
      // repair both present the gap as "team leaders", so neither is the owner's informed
      // consent to hand a key to someone outside their teams' staff.
      const allowed = await recipientsFor(database, target, { superadmins: false })
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

      const files = (await database('identity_documents').where('member', target).select('file'))
        .map((r) => r.file)
      const removed = await database('identity_documents').where('member', target).del()
      // "Delete my ID" must delete the bytes, not just the pointer (2026-09-28 audit F34).
      const purged = await purgeIdentityFiles(ctx, files, log)

      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'delete',
        collection: 'identity_documents',
        recordId: String(target),
        data: { what: 'identity_document_delete', member: target, removed, purged_files: purged },
      })

      res.json({ data: { ok: true, removed } })
    } catch (err) {
      log.error({ msg: `DELETE identity/document: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
