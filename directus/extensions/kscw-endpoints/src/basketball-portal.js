/**
 * Basketball opponent CLUB portal (ProBasket pre-agreement, WSR Art. 18).
 *
 * ── What this is ────────────────────────────────────────────────────────────
 * One link per opponent CLUB — not per team — listing the home games KSCW has
 * placed against that club's teams, so the club can confirm / decline / counter
 * them BEFORE the ProBasket Spielplansitzung. The association's own invitation:
 *   "Die Spielplansitzung ist obligatorisch … Einzige Ausnahme ist, wenn die
 *    Spiele bis zur Spielplansitzung, im Einverständnis jeweils beider Klubs,
 *    abgemacht wurden und bei der Geschäftsstelle vorliegen."
 * That agreement — nothing more — is the entire deliverable of this module.
 *
 * ── Why it is NOT the volleyball club portal with a flag flipped ────────────
 * The migration-213 volleyball portal is a token ENVELOPE wrapped around an
 * SVRZ-fixture engine: clubPortalOpponents() reads game_scheduling_opponents,
 * findPortalOpponentByFixture() walks opponentSvrzFixtures(), and every mutation
 * is re-dispatched into a per-fixture handler. Basketball has no fixture feed at
 * all before 05.09.2026 ("Alle leeren Spielpläne werden im Dokumentenspeicher bis
 * am 31. August 2026 veröffentlicht"), so none of that engine has a counterpart.
 * What IS shared is the envelope: game_scheduling_club_portals now carries a
 * `sport` discriminator (migration 280) and both sports mint the same 32-hex
 * token, hit the same unique index and follow the same status ladder. The
 * fixture anchor is replaced by basketball_slot_plan rows — the placed game IS
 * the proposal.
 *
 * ⚠ HONESTY NOTE, because this builds on unproven code: the volleyball club
 * portal has NEVER executed in production (0 rows in game_scheduling_club_portals,
 * use_club_portals=false on the only season, re-verified 05.08.2026). This module
 * therefore reuses only what can be verified by READING migration 213 — the table
 * shape, the token generation (crypto.randomBytes(16).toString('hex')), the
 * status-gated lookup, the season-end expiry — and implements its own payload,
 * mutation and mail paths rather than delegating into game-scheduling.js.
 *
 * ── Security model (identical to the volleyball opponent flow) ──────────────
 *  • The public routes are UNAUTHENTICATED and run on the system knex handle, so
 *    Directus item permissions never apply. Authorisation = the 32-hex token
 *    lookup + the per-IP rate limiter below. Consequently the Public Directus
 *    policy needs ZERO rows for any of these tables — which also sidesteps the
 *    CLAUDE.md warning that a static token inherits the Public policy, since
 *    there is no static token on this path at all.
 *  • The public payload is an EXPLICIT column whitelist. It carries no member
 *    data whatsoever: basketball_slot_plan.created_by (a members FK) is never
 *    selected, teams are reduced to their name, and basketplan_clubs' contact
 *    block (third-party PII) never leaves the admin routes. Same discipline as
 *    the public team API's minor protection in index.js — decide what leaves the
 *    server field by field, never by spreading a row.
 *  • Every write re-verifies that the target row belongs to THIS portal's club
 *    and season. A body-supplied id is never trusted.
 *
 * ── Actor capture (CLAUDE.md → Audit logging) ───────────────────────────────
 * Raw-knex writes bypass Directus's activity trail, so every mutating ADMIN route
 * calls writeUserLog(). The PUBLIC routes have no accountability.user at all
 * (writeUserLog early-returns by design), so their actor is persisted on the row
 * instead — basketball_slot_plan.responded_by_name / responded_by_email — which
 * is CLAUDE.md's documented option (b).
 *
 * ── Mail ────────────────────────────────────────────────────────────────────
 * Sends from ACCOUNTS.basketball (basketball@spielplanung.kscw.ch / "KSCW BB
 * Spielplanung", scheduling-mailbox.js) over the container's SES SMTP, with our
 * own MIME so the From display name survives — the same reason game-scheduling.js
 * bypasses the Directus MailService. Replies land in the basketball mailbox that
 * is already live and polled every 10 minutes.
 */

import crypto from 'crypto'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer/index.js'
import { SCHEDULING_URL } from './email-template.js'
import { writeUserLog } from './activity-log.js'
import { ACCOUNTS } from './scheduling-mailbox.js'
import { VALID_LANGS, bbClubInviteEmail, bbClubResponseReceiptEmail } from './terminplanung-emails.js'
// The one definition of "these two hall names fight over the same floor". Imported rather than
// re-implemented: a second copy is how A+B stops blocking A on one code path only.
import { hallsCollide } from './basketball-slots.js'

/** The mail identity — single source of truth lives in scheduling-mailbox.js. */
const BB_ACCOUNT = ACCOUNTS.basketball

/** Token statuses whose links still open. Mirrors CLUB_PORTAL_VIEW_STATUSES. */
const PORTAL_VIEW_STATUSES = ['invited', 'viewed', 'booked']

/**
 * proposal_status values an opponent may ANSWER (accept / decline / counter).
 * 'draft' is the visibility gate; 'club_proposed' is deliberately absent — a club must not
 * be able to "decline" a date it proposed itself.
 */
const OFFER_VISIBLE_STATUSES = ['offered', 'accepted', 'declined', 'countered']

/**
 * proposal_status values an opponent may SEE. Wider than the answerable set: a club's own
 * picks must show up in its portal, otherwise it submits them and the pitches simply vanish
 * from the free list with nothing to show for it.
 */
const PORTAL_VISIBLE_STATUSES = [...OFFER_VISIBLE_STATUSES, 'club_proposed']

/** Responses the portal accepts. 'countered' is derived, never sent by the client. */
const ALLOWED_RESPONSES = ['accepted', 'declined']

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** German status labels for the receipt mail (the opponent's language is German). */
const STATUS_LABEL_DE = {
  offered: 'Offen',
  accepted: 'Bestätigt',
  declined: 'Abgelehnt',
  countered: 'Alternative vorgeschlagen',
}

/** 'YYYY-MM-DD' or Date → 'dd.mm.yyyy' (UTC parts; `date` columns are UTC midnight). */
function fmtDate(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(d.getTime())) return String(value)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`
}

/** Date column → 'YYYY-MM-DD' for the JSON payload. */
function toYmd(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toISOString().slice(0, 10)
}

/**
 * Expiry = 30.06 of the season's END year ("2026/27" → 2027-06-30). Same rule as
 * newInviteExpiry() in game-scheduling.js, reimplemented because that one is a
 * closure-local function. Unparseable season → now + 1 year, so a link is never
 * born already expired.
 */
function newPortalExpiry(seasonStr) {
  const m = String(seasonStr || '').match(/(\d{4})/)
  if (m) return new Date(`${Number(m[1]) + 1}-06-30T23:59:59.000Z`).toISOString()
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() + 1)
  return d.toISOString()
}

/**
 * Sanitise a recipient list. Strips CR/LF (header-injection defence) and drops
 * anything that is not a plausible bare address. Copied deliberately rather than
 * imported: game-scheduling.js declares it inside its register closure.
 */
function parseRecipients(v) {
  const clean = (s) => String(s).replace(/[\r\n]+/g, '').trim()
  const raw = Array.isArray(v) ? v.map(clean) : clean(v).split(/[,;]+/).map((s) => s.trim())
  const parts = raw.filter((s) => s && EMAIL_RE.test(s))
  return [...new Set(parts.map((s) => s.toLowerCase()))]
}

export function registerBasketballPortal(router, { database, logger }) {
  const log = logger.child({ endpoint: 'basketball-portal' })

  const fail = (res, endpoint, err, req) => {
    log.error({
      msg: `${endpoint}: ${err.message}`, endpoint,
      userId: req.accountability?.user || null, method: req.method, stack: err.stack,
    })
    res.status(500).json({ error: 'Internal error' })
  }

  // ── Rate limiting (per IP) ────────────────────────────────────────────────
  // Same limiter shape as game-scheduling.js: prefer CF-Connecting-IP (set by the
  // Cloudflare Tunnel) over req.ip over X-Forwarded-For. Documented in SECURITY.md:
  // the limiter is only sound behind the CF Tunnel.
  const tokenAttempts = new Map()
  const writeAttempts = new Map()
  const langAttempts = new Map()

  function rateLimit(map, req, maxAttempts, windowMs) {
    const xff = req.headers['x-forwarded-for']
    const ip = req.headers['cf-connecting-ip']
      || (typeof xff === 'string' ? xff.split(',')[0].trim() : '')
      || req.ip || 'unknown'
    const now = Date.now()
    const attempt = map.get(ip)
    if (attempt && now < attempt.resetAt) {
      if (attempt.count >= maxAttempts) return false
      attempt.count++
    } else {
      map.set(ip, { count: 1, resetAt: now + windowMs })
    }
    if (map.size > 1000) for (const [k, v] of map) if (now > v.resetAt) map.delete(k)
    return true
  }

  // ── Authorisation for the admin routes ────────────────────────────────────
  // Matches the frontend guard (BasketballAdminRoute): a Directus admin, an app
  // admin/superuser, a basketball sport admin (bb_admin), or a club-wide
  // Spielplaner (members.is_spielplaner) — the Spielplaner role is club-wide, not
  // per-sport, so a Spielplaner plans the basketball hall too. Per-team
  // spielplaner_assignments alone grant nothing here (same caveat as volleyball).
  // Deliberately WIDER than the basketball MAILBOX gate (bb_admin only): reading
  // the club's inbox and agreeing a fixture are different privileges.
  async function canManageBb(req) {
    if (req.accountability?.admin) return true
    const userId = req.accountability?.user
    if (!userId) return false
    const m = await database('members').where('user', userId).first('role', 'is_spielplaner')
    if (!m) return false
    const roles = Array.isArray(m.role)
      ? m.role
      : (m.role ? (() => { try { return JSON.parse(m.role) } catch { return [] } })() : [])
    if (roles.includes('admin') || roles.includes('superuser') || roles.includes('bb_admin')) return true
    return m.is_spielplaner === true
  }

  const denyUnlessBb = async (req, res) => {
    if (await canManageBb(req)) return false
    res.status(403).json({ error: 'Not authorized for basketball scheduling' })
    return true
  }

  // ── Mail ──────────────────────────────────────────────────────────────────
  /**
   * Send from basketball@spielplanung.kscw.ch. Best-effort by contract: callers
   * decide whether a failure is fatal. Never throws on "no valid recipient" — it
   * logs and returns false, so a malformed contact can't 500 an admin action.
   */
  async function sendBbMail(to, subject, text, html = null, cc = null) {
    const toList = parseRecipients(to)
    if (!toList.length) {
      log.warn(`Basketball portal email skipped: no valid recipient (subject: ${subject})`)
      return false
    }
    const ccList = cc ? parseRecipients(cc) : []
    const messageId = `<${crypto.randomUUID()}@${BB_ACCOUNT.msgIdDomain}>`
    const composer = new MailComposer({
      from: { name: BB_ACCOUNT.fromName, address: BB_ACCOUNT.fromAddress },
      to: toList,
      cc: ccList.length ? ccList : undefined,
      replyTo: BB_ACCOUNT.fromAddress,
      subject,
      text,
      html: html || undefined,
      messageId,
    })
    const raw = await composer.compile().build()
    const transport = nodemailer.createTransport({
      host: process.env.EMAIL_SMTP_HOST,
      port: Number(process.env.EMAIL_SMTP_PORT || 587),
      secure: String(process.env.EMAIL_SMTP_SECURE) === 'true',
      auth: { user: process.env.EMAIL_SMTP_USER, pass: process.env.EMAIL_SMTP_PASSWORD },
    })
    await transport.sendMail({ envelope: { from: BB_ACCOUNT.fromAddress, to: [...toList, ...ccList] }, raw })
    return true
  }

  // ── Shared queries ────────────────────────────────────────────────────────
  const portalUrl = (token) => `${SCHEDULING_URL}/terminplanung/bb/${token}`

  async function portalByToken(token) {
    const t = String(token || '')
    // Cheap shape guard before touching the DB — tokens are always 32 hex chars.
    if (!/^[a-f0-9]{32}$/i.test(t)) return null
    return database('game_scheduling_club_portals')
      .where('token', t)
      .where('sport', 'basketball')
      .whereIn('status', PORTAL_VIEW_STATUSES)
      .first()
  }

  const portalExpired = (portal) =>
    portal.status !== 'booked' && portal.expires_at && new Date() > new Date(portal.expires_at)

  /**
   * The offers behind one portal. EXPLICIT column whitelist — see the security
   * note in the module header. `created_by` (a members FK) is never selected.
   */
  function portalOffersQuery(portal) {
    return database('basketball_slot_plan as p')
      .leftJoin('teams as t', 't.id', 'p.kscw_team')
      .where('p.season', portal.season)
      .where('p.opponent_club', portal.bp_club)
      .whereIn('p.proposal_status', PORTAL_VISIBLE_STATUSES)
      .orderBy(['p.date', 'p.time'])
      .select(
        'p.id', 'p.date', 'p.time', 'p.hall', 'p.opponent', 'p.kscw_team_label',
        'p.proposal_status', 'p.opponent_note', 'p.counter_proposals',
        'p.responded_at', 'p.note',
        't.name as kscw_team_name',
      )
  }

  /**
   * The KSCW teams this club is paired with, and the pitches still free for each.
   *
   * This is the volleyball shape (`/terminplanung/slots/:token`) brought to basketball: the
   * opponent sees what is FREE and picks, instead of only answering games we placed first.
   *
   * The pairing comes from shared ProBasket group membership (migration 287) because
   * basketball has no fixture feed before the Spielplansitzung — there is nothing else to
   * join on. `home_games` is the workbook's Anzahl Spiele halved; NULL whenever ProBasket has
   * not stated one, never guessed from the group size (see bbHomeGames.ts / migration 287).
   *
   * ⚠ DISTINCT on (our team) is required, not cosmetic: a club can field two teams in one
   * group (BC Zürich 93 in MixU12), which would otherwise repeat the pairing and multiply the
   * slot list.
   *
   * ⚠ Free means: generated, still 'available', and unclaimed. Any plan row CLAIMS its pitch —
   * migration 278's `trg_basketball_slot_plan_0_sync_slots` flips the slot to 'placed' on
   * insert, and `…_release_slots` frees it again on delete. So a club's pick genuinely holds
   * the pitch (which is what stops us promising one hall to two clubs), and a planner deleting
   * the proposal releases it. It is still not a FIXTURE — ProBasket assigns those at the
   * Spielplansitzung.
   *
   * ⚠ The `taken` set below is belt-and-braces for plan rows that never had a generated slot.
   * It matches the hall string exactly, so it does NOT model the A+B ↔ A/B overlap; that
   * collision is the generator's job (hallOccupancy.ts) and is out of scope here.
   */
  async function portalPairings(portal) {
    const teams = await database('basketball_group_teams as opp')
      .join('basketball_groups as g', 'g.id', 'opp.group_id')
      .join('basketball_group_teams as mine', function () {
        this.on('mine.group_id', '=', 'g.id').andOnNotNull('mine.kscw_team')
      })
      .join('teams as t', 't.id', 'mine.kscw_team')
      .where('g.season', portal.season)
      .where('opp.bp_club', portal.bp_club)
      .distinct('t.id as team_id', 't.name as team_name', 'g.code as group_code',
        'g.label as group_label', 'g.format as group_format', 'g.games_total')
      .orderBy('t.name')

    if (!teams.length) return []

    const teamIds = teams.map((r) => r.team_id)
    const [slots, claimed] = await Promise.all([
      database('basketball_slots')
        .where('season', portal.season)
        .whereIn('kscw_team', teamIds)
        .where('status', 'available')
        .whereNull('plan')
        .orderBy(['date', 'time'])
        .select('id', 'kscw_team', 'date', 'time', 'end_time', 'hall', 'score'),
      // Every placement in our hall, whatever its status and whichever team it belongs to.
      // ⚠ Not just 'offered'/'accepted': a draft or a club_proposed row occupies the floor
      // just as physically. And not just this pairing's team — the hall is shared.
      database('basketball_slot_plan')
        .where('season', portal.season)
        .select('date', 'time', 'hall'),
    ])

    /**
     * Placements indexed by date+time, so a candidate can be tested against every hall busy at
     * that moment.
     *
     * ⚠ This is where A+B has to be honoured. The generator already respects it when building
     * candidates (hallsCollide in basketball-slots.js), and the claim trigger does NOT: it
     * matches `hall = NEW.hall` exactly, so booking 'KWI A+B' leaves the 'KWI A' and 'KWI B'
     * rows at the same moment marked available. Verified on prod: 132 such co-offered pairs on
     * 26.09 alone. With 64 clubs self-serving, two of them would otherwise pick the big court
     * and one of its halves for the same hour.
     */
    const busyAt = new Map()
    for (const c of claimed) {
      const key = `${toYmd(c.date)}|${c.time}`
      const halls = busyAt.get(key)
      if (halls) halls.push(c.hall)
      else busyAt.set(key, [c.hall])
    }
    const isBlocked = (date, time, hall) =>
      (busyAt.get(`${date}|${time}`) || []).some((h) => hallsCollide(h, hall))

    /**
     * Dates, not pitches.
     *
     * ⚠ The unit the club answers in is the DAY. A slot is (date, time, hall) and one Saturday
     * carries up to three of them, so offering slots made the club choose a tip-off it has no
     * opinion about — and, worse, holding one made that choice ours by ranking. The times are
     * still sent, but only so the page can say "11:00 or 13:30"; the club commits to the day
     * and we allocate the rest.
     */
    const byTeam = new Map(teamIds.map((id) => [String(id), new Map()]))
    for (const s of slots) {
      const date = toYmd(s.date)
      if (isBlocked(date, s.time, s.hall)) continue
      const dates = byTeam.get(String(s.kscw_team))
      if (!dates) continue
      const entry = dates.get(date)
      if (entry) entry.times.push(s.time || '')
      else dates.set(date, { date, times: [s.time || ''] })
    }

    // What this club has already told us, so the page can come back showing its own answers.
    const prefs = await database('basketball_club_date_prefs')
      .where('season', portal.season)
      .where('bp_club', portal.bp_club)
      .select('kscw_team', 'date')
    const chosen = new Set(prefs.map((p) => `${p.kscw_team}|${toYmd(p.date)}`))

    return teams.map((r) => ({
      kscw_team: r.team_id,
      kscw_team_name: r.team_name || '',
      group: r.group_code || '',
      group_label: r.group_label || '',
      // null, never 0 — "not stated yet" must not read as "no home games".
      home_games: r.group_format === 'championship' && r.games_total
        ? Math.floor(Number(r.games_total) / 2)
        : null,
      games_total: r.games_total ?? null,
      dates: [...(byTeam.get(String(r.team_id))?.values() || [])]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((d) => ({
          date: d.date,
          times: [...new Set(d.times)].sort(),
          chosen: chosen.has(`${r.team_id}|${d.date}`),
        })),
    }))
  }

  const publicOffer = (r) => ({
    id: r.id,
    date: toYmd(r.date),
    time: r.time || '',
    hall: r.hall || '',
    kscw_team: r.kscw_team_name || r.kscw_team_label || '',
    opponent: r.opponent || '',
    status: r.proposal_status,
    opponent_note: r.opponent_note || '',
    counter_proposals: Array.isArray(r.counter_proposals) ? r.counter_proposals : [],
    responded_at: r.responded_at || null,
    // p.note is the KSCW planner's own remark on the placed game — shown to the
    // club on purpose (it is written for them, e.g. "Doppelrunde mit HU16").
    kscw_note: r.note || '',
  })

  /** Club rows joined onto their portals for the admin list. */
  function portalsWithClubQuery(season) {
    return database('game_scheduling_club_portals as gp')
      .leftJoin('basketplan_clubs as c', 'c.id', 'gp.bp_club')
      .where('gp.season', season)
      .where('gp.sport', 'basketball')
      .orderBy('gp.club_name', 'asc')
      .select(
        'gp.id', 'gp.season', 'gp.club_id', 'gp.club_name', 'gp.token', 'gp.status',
        'gp.language', 'gp.contact_name', 'gp.contact_email', 'gp.club_note',
        'gp.first_viewed_at', 'gp.email_sent_at', 'gp.reminder_sent_at',
        'gp.expires_at', 'gp.revoked_at', 'gp.reissued_at', 'gp.bp_club',
        'c.bp_club_id', 'c.contact_source',
      )
  }

  /** { [bp_club]: { offered, accepted, declined, countered } } for one season. */
  /**
   * Free pitches per opponent club — how much there is to PICK, as opposed to how much we
   * have already offered.
   *
   * ⚠ Why this exists: the send guard used to ask only "have we offered this club anything?".
   * Under the opponent-picks flow the answer is normally NO — the club is meant to choose from
   * free pitches — so every invite was skipped as `no_offers` and nothing could ever be sent.
   * A portal with 40 pitches to choose from is the normal case, not an empty one.
   *
   * Still returns 0 for a club we share no group with, so the anti-spam intent survives: an
   * invite that would open onto an empty page is still not sent.
   */
  async function freePitchCountsBySeason(season) {
    const rows = await database('basketball_group_teams as opp')
      .join('basketball_groups as g', 'g.id', 'opp.group_id')
      .join('basketball_group_teams as mine', function () {
        this.on('mine.group_id', '=', 'g.id').andOnNotNull('mine.kscw_team')
      })
      .join('basketball_slots as s', function () {
        this.on('s.kscw_team', '=', 'mine.kscw_team')
          .andOn('s.season', '=', 'g.season')
      })
      .where('g.season', season)
      .whereNotNull('opp.bp_club')
      .where('s.status', 'available')
      .whereNull('s.plan')
      .groupBy('opp.bp_club')
      // countDistinct: a club fielding two teams in one group would otherwise multiply the
      // same pitch — the same duplication the portal payload guards against with DISTINCT.
      .countDistinct('s.id as count')
      .select('opp.bp_club')
    const out = {}
    for (const r of rows) out[String(r.bp_club)] = Number(r.count) || 0
    return out
  }

  async function offerCountsBySeason(season) {
    const rows = await database('basketball_slot_plan')
      .where('season', season)
      .whereNotNull('opponent_club')
      .whereIn('proposal_status', OFFER_VISIBLE_STATUSES)
      .groupBy('opponent_club', 'proposal_status')
      .select('opponent_club', 'proposal_status')
      .count('id as count')
    const out = {}
    for (const r of rows) {
      const key = String(r.opponent_club)
      out[key] = out[key] || { offered: 0, accepted: 0, declined: 0, countered: 0, total: 0 }
      const n = Number(r.count) || 0
      out[key][r.proposal_status] = n
      out[key].total += n
    }
    return out
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC — token-gated, unauthenticated
  // ══════════════════════════════════════════════════════════════════════════

  // GET /kscw/terminplanung/bb/club/:token — the club's whole portal payload.
  router.get('/terminplanung/bb/club/:token', async (req, res) => {
    try {
      if (!rateLimit(tokenAttempts, req, 60, 15 * 60 * 1000)) {
        return res.status(429).json({ error: 'Too many requests. Try again later.' })
      }
      const portal = await portalByToken(req.params.token)
      if (!portal) return res.status(404).json({ error: 'Invalid or expired link' })
      if (portalExpired(portal)) return res.status(400).json({ error: 'Link expired' })

      if (portal.status === 'invited') {
        const nowIso = new Date().toISOString()
        await database('game_scheduling_club_portals').where('id', portal.id)
          .update({ status: 'viewed', first_viewed_at: nowIso, date_updated: nowIso })
        portal.status = 'viewed'
      }

      const [seasonRow, offers, pairings] = await Promise.all([
        database('game_scheduling_seasons').where('id', portal.season).first('id', 'season'),
        portalOffersQuery(portal),
        portalPairings(portal),
      ])

      res.json({
        portal: {
          club_name: portal.club_name || '',
          status: portal.status || 'invited',
          language: portal.language || 'de',
          club_note: portal.club_note || '',
          season_name: seasonRow?.season || '',
          expires_at: portal.expires_at || null,
        },
        // Quoted in the UI the same way they are quoted in the invite mail.
        key_dates: { spielplansitzung: '2026-09-05', availability_due: '2026-08-17' },
        games: offers.map(publicOffer),
        // The teams this club plays and the pitches still free for each — what the club
        // picks from. Empty when the club shares no group with us (migration 287).
        pairings,
      })
    } catch (err) { fail(res, 'terminplanung/bb/club/:token', err, req) }
  })

  // POST /kscw/terminplanung/bb/club/respond/:token — the club answers.
  //
  // Body: { decisions: [{ game_id, response: 'accepted'|'declined', note?,
  //         alternatives?: [{date, time}] }], responder_name, responder_email }
  //
  // Batched on purpose: one submit → one receipt mail + one internal notify. A
  // per-row autosave UI would mail the club once per game.
  router.post('/terminplanung/bb/club/respond/:token', async (req, res) => {
    try {
      if (!rateLimit(writeAttempts, req, 20, 15 * 60 * 1000)) {
        return res.status(429).json({ error: 'Too many requests. Try again later.' })
      }
      const portal = await portalByToken(req.params.token)
      if (!portal) return res.status(404).json({ error: 'Invalid or expired link' })
      if (portalExpired(portal)) return res.status(400).json({ error: 'Link expired' })

      const name = String(req.body?.responder_name || '').trim().slice(0, 200)
      const email = String(req.body?.responder_email || '').trim().slice(0, 200)
      if (!name || !email) return res.status(400).json({ error: 'responder_required' })
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid_email' })

      const decisions = Array.isArray(req.body?.decisions) ? req.body.decisions : []
      if (!decisions.length) return res.status(400).json({ error: 'decisions_required' })
      if (decisions.length > 60) return res.status(400).json({ error: 'too_many_decisions' })

      // Every id must belong to THIS portal's club + season and be visible.
      // A body-supplied id is never trusted.
      const ids = [...new Set(decisions.map((d) => Number(d?.game_id)).filter(Number.isFinite))]
      if (!ids.length) return res.status(400).json({ error: 'decisions_required' })
      const rows = await database('basketball_slot_plan')
        .where('season', portal.season)
        .where('opponent_club', portal.bp_club)
        .whereIn('proposal_status', OFFER_VISIBLE_STATUSES)
        .whereIn('id', ids)
        .select('id', 'date', 'time', 'hall', 'opponent', 'kscw_team', 'kscw_team_label')
      const byId = new Map(rows.map((r) => [Number(r.id), r]))
      if (byId.size !== ids.length) return res.status(400).json({ error: 'invalid_game' })

      const nowIso = new Date().toISOString()
      const applied = []
      for (const d of decisions) {
        const row = byId.get(Number(d?.game_id))
        if (!row) continue
        const response = String(d?.response || '').toLowerCase()
        if (!ALLOWED_RESPONSES.includes(response)) return res.status(400).json({ error: 'invalid_response' })

        // Alternatives are only meaningful on a decline; ≤3 entries, each a real
        // date + HH:MM. Stored verbatim and NEVER auto-applied — a KSCW planner
        // re-places the game in the prep grid.
        let alternatives = []
        if (response === 'declined' && Array.isArray(d?.alternatives)) {
          for (const a of d.alternatives.slice(0, 3)) {
            const date = String(a?.date || '').trim()
            const time = String(a?.time || '').trim()
            if (!YMD_RE.test(date) || !HHMM_RE.test(time)) {
              return res.status(400).json({ error: 'invalid_alternative' })
            }
            alternatives.push({ date, time })
          }
        }
        const status = response === 'declined' && alternatives.length ? 'countered' : response
        await database('basketball_slot_plan').where('id', row.id).update({
          proposal_status: status,
          opponent_note: String(d?.note ?? '').slice(0, 2000),
          counter_proposals: alternatives.length ? JSON.stringify(alternatives) : null,
          responded_at: nowIso,
          responded_by_name: name,
          responded_by_email: email.toLowerCase(),
          date_updated: nowIso,
        })
        applied.push({ row, status })
      }

      // Portal reaches 'booked' once every visible offer has an answer.
      const remaining = await database('basketball_slot_plan')
        .where('season', portal.season).where('opponent_club', portal.bp_club)
        .where('proposal_status', 'offered').count('id as count').first()
      const portalPatch = { date_updated: nowIso }
      if (Number(remaining?.count || 0) === 0 && portal.status !== 'booked') portalPatch.status = 'booked'
      await database('game_scheduling_club_portals').where('id', portal.id).update(portalPatch)

      // Mail is best-effort — a mail failure must never lose the club's answer.
      const receiptRows = applied.map(({ row, status }) => ({
        date: fmtDate(row.date),
        time: row.time || '',
        hall: row.hall || '',
        game: [row.kscw_team_label || '', row.opponent || ''].filter(Boolean).join(' – '),
        status: STATUS_LABEL_DE[status] || status,
      }))
      try {
        const { subject, text, html } = bbClubResponseReceiptEmail({
          club: portal.club_name || '', rows: receiptRows,
        })
        // Receipt goes to the portal's STORED contacts (our own data), never to
        // the caller-supplied responder_email — that address is recorded on the
        // row as the actor but must not turn a public endpoint into a mailer for
        // arbitrary recipients.
        if (portal.contact_email) await sendBbMail(portal.contact_email, subject, text, html)
      } catch (e) { log.warn(`bb portal receipt mail failed: ${e.message}`) }
      try {
        const lines = receiptRows.map((r) => `• ${[r.date, r.time, r.hall, r.game, r.status].filter(Boolean).join(' · ')}`)
        await sendBbMail(
          BB_ACCOUNT.fromAddress,
          `Rückmeldung Spielplanung – ${portal.club_name || portal.club_id}`,
          `${name} <${email}> hat für ${portal.club_name || portal.club_id} geantwortet:\n\n${lines.join('\n')}\n`,
        )
      } catch (e) { log.warn(`bb portal admin notify failed: ${e.message}`) }

      res.json({ success: true, updated: applied.length })
    } catch (err) { fail(res, 'terminplanung/bb/club/respond', err, req) }
  })

  // POST /kscw/terminplanung/bb/club/propose/:token — the club picks free pitches.
  //
  // Body: { picks: [{ slot_id, note? }], responder_name, responder_email }
  //
  // The volleyball `propose-home` move, brought to basketball: instead of only answering games
  // we placed, the club names dates that suit it and a planner confirms them afterwards.
  //
  // ⚠ A pick is not a FIXTURE — ProBasket assigns those at the Spielplansitzung — but it DOES
  // hold the pitch: migration 278's sync-slots trigger claims the slot on insert, so the date
  // leaves every other club's free list at once (first come, first served) and comes back only
  // if a planner deletes the proposal. Rows land as `club_proposed` (migration 289).
  //
  // ⚠ slot_id is re-verified against THIS portal's pairings on every call; a body-supplied id
  // is never trusted, exactly as the respond route re-verifies game ids.
  router.post('/terminplanung/bb/club/propose/:token', async (req, res) => {
    try {
      if (!rateLimit(writeAttempts, req, 20, 15 * 60 * 1000)) {
        return res.status(429).json({ error: 'Too many requests. Try again later.' })
      }
      const portal = await portalByToken(req.params.token)
      if (!portal) return res.status(404).json({ error: 'Invalid or expired link' })
      if (portalExpired(portal)) return res.status(400).json({ error: 'Link expired' })

      const name = String(req.body?.responder_name || '').trim().slice(0, 200)
      const email = String(req.body?.responder_email || '').trim().slice(0, 200)
      if (!name || !email) return res.status(400).json({ error: 'responder_required' })
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid_email' })

      const picks = Array.isArray(req.body?.picks) ? req.body.picks : []
      if (!picks.length) return res.status(400).json({ error: 'picks_required' })

      // Rebuilding the pairings is the same authorisation the GET applies, so the two cannot
      // drift: a club may only answer for its own teams, and only on dates we actually offer.
      const pairings = await portalPairings(portal)
      const allowedByTeam = new Map(
        pairings.map((p) => [String(p.kscw_team), new Set(p.dates.map((d) => d.date))]),
      )

      const nowIso = new Date().toISOString()
      let stored = 0; let removed = 0; let rejected = 0

      for (const pick of picks) {
        const teamId = Number(pick?.kscw_team)
        const allowed = allowedByTeam.get(String(teamId))
        if (!allowed) { rejected += 1; continue }

        const wanted = [...new Set((Array.isArray(pick?.dates) ? pick.dates : [])
          .map((d) => String(d || '').slice(0, 10))
          .filter((d) => YMD_RE.test(d)))]
        const usable = wanted.filter((d) => allowed.has(d))
        rejected += wanted.length - usable.length
        if (wanted.length > 200) return res.status(400).json({ error: 'too_many_picks' })

        const note = pick?.note ? String(pick.note).trim().slice(0, 500) : null

        // REPLACE semantics per (club, team): the page shows the club its current answer and
        // submits the whole set, so unticking a date has to remove it. An additive write would
        // make a mistake impossible to take back without ringing us up.
        await database('basketball_club_date_prefs')
          .where({ season: portal.season, bp_club: portal.bp_club, kscw_team: teamId })
          .modify((q) => { if (usable.length) q.whereNotIn('date', usable) })
          .del()
          .then((n) => { removed += n })

        for (const date of usable) {
          await database('basketball_club_date_prefs')
            .insert({
              season: portal.season,
              bp_club: portal.bp_club,
              kscw_team: teamId,
              date,
              note,
              responder_name: name,
              responder_email: email,
              date_created: nowIso,
              date_updated: nowIso,
            })
            .onConflict(['season', 'bp_club', 'kscw_team', 'date'])
            .merge({ note, responder_name: name, responder_email: email, date_updated: nowIso })
          stored += 1
        }
      }

      await database('game_scheduling_club_portals').where('id', portal.id)
        .update({ date_updated: nowIso })

      // ⚠ Nothing is claimed here. These are availabilities; a planner allocates time and hall
      // afterwards by creating the basketball_slot_plan row, which is what holds the floor.
      res.json({ success: true, stored, removed, rejected })
    } catch (err) { fail(res, 'terminplanung/bb/club/propose', err, req) }
  })

  // POST /kscw/terminplanung/bb/club/note/:token — one shared club-level remark.
  // ⚠ Unlike the volleyball equivalent (/terminplanung/club/note/:token, which is
  // missing the guard) this DOES check expires_at — an expired link must not be
  // able to rewrite anything.
  router.post('/terminplanung/bb/club/note/:token', async (req, res) => {
    try {
      if (!rateLimit(writeAttempts, req, 20, 15 * 60 * 1000)) {
        return res.status(429).json({ error: 'Too many requests. Try again later.' })
      }
      const portal = await portalByToken(req.params.token)
      if (!portal) return res.status(404).json({ error: 'Invalid link' })
      if (portalExpired(portal)) return res.status(400).json({ error: 'Link expired' })
      const note = String(req.body?.note ?? '').slice(0, 2000)
      await database('game_scheduling_club_portals').where('id', portal.id)
        .update({ club_note: note, date_updated: new Date().toISOString() })
      res.json({ success: true })
    } catch (err) { fail(res, 'terminplanung/bb/club/note', err, req) }
  })

  // POST /kscw/terminplanung/bb/club/set-language/:token — remembered per portal.
  // The opponent-facing MAIL is German only (ProBasket is a German-speaking
  // region), so this drives the PAGE language only.
  router.post('/terminplanung/bb/club/set-language/:token', async (req, res) => {
    try {
      if (!rateLimit(langAttempts, req, 40, 15 * 60 * 1000)) {
        return res.status(429).json({ error: 'Too many requests. Try again later.' })
      }
      const language = String(req.body?.language || '').toLowerCase()
      if (!VALID_LANGS.includes(language)) return res.status(400).json({ error: 'Invalid language' })
      const portal = await portalByToken(req.params.token)
      if (!portal) return res.status(404).json({ error: 'Invalid link' })
      if (portalExpired(portal)) return res.status(400).json({ error: 'Link expired' })
      await database('game_scheduling_club_portals').where('id', portal.id)
        .update({ language, date_updated: new Date().toISOString() })
      res.json({ success: true })
    } catch (err) { fail(res, 'terminplanung/bb/club/set-language', err, req) }
  })

  // ══════════════════════════════════════════════════════════════════════════
  // ADMIN
  // ══════════════════════════════════════════════════════════════════════════

  // GET /kscw/admin/terminplanung/bb/clubs — the opponent-club registry.
  // Carries third-party contact PII, hence the same gate as everything else here
  // and no Public/Member/Coach permission anywhere.
  router.get('/admin/terminplanung/bb/clubs', async (req, res) => {
    if (await denyUnlessBb(req, res)) return
    try {
      const clubs = await database('basketplan_clubs')
        .where('active', true)
        .orderBy('name', 'asc')
        .select(
          'id', 'bp_club_id', 'name', 'short_name', 'is_own_club',
          'contact_name', 'contact_email', 'contact_email_secondary', 'contact_phone',
          'contact_role_label', 'contact_source', 'contact_verified_at', 'source', 'note',
        )
      res.json({ clubs })
    } catch (err) { fail(res, 'admin/terminplanung/bb/clubs', err, req) }
  })

  // GET /kscw/admin/terminplanung/bb/portals?season= — list a season's portals.
  router.get('/admin/terminplanung/bb/portals', async (req, res) => {
    if (await denyUnlessBb(req, res)) return
    try {
      const season = Number(req.query.season)
      if (!season) return res.status(400).json({ error: 'season required' })
      const [portals, counts] = await Promise.all([
        portalsWithClubQuery(season), offerCountsBySeason(season),
      ])
      res.json({
        portals: portals.map((p) => ({
          ...p,
          url: portalUrl(p.token),
          offers: counts[String(p.bp_club)] || { offered: 0, accepted: 0, declined: 0, countered: 0, total: 0 },
        })),
      })
    } catch (err) { fail(res, 'admin/terminplanung/bb/portals', err, req) }
  })

  // POST /kscw/admin/terminplanung/bb/portals/ensure — mint/refresh one portal
  // per opponent club. Body: { season, club_ids?: number[] }.
  //
  // Targets = every club that already has a non-draft offer this season, PLUS any
  // club ids the caller names explicitly (so a planner can prepare a link before
  // placing games). Idempotent: an existing portal never has its token, status or
  // expiry touched — only the club name and the contact block are refreshed, and
  // contacts are never blanked.
  //
  // Deliberately NOT gated on a season flag — see the header of migration 280.
  router.post('/admin/terminplanung/bb/portals/ensure', async (req, res) => {
    if (await denyUnlessBb(req, res)) return
    try {
      const season = Number(req.body?.season)
      if (!season) return res.status(400).json({ error: 'season required' })
      const seasonRow = await database('game_scheduling_seasons').where('id', season).first()
      if (!seasonRow) return res.status(404).json({ error: 'season not found' })

      const fromOffers = await database('basketball_slot_plan')
        .where('season', season).whereNotNull('opponent_club')
        .whereIn('proposal_status', OFFER_VISIBLE_STATUSES)
        .distinct('opponent_club').pluck('opponent_club')
      const explicit = Array.isArray(req.body?.club_ids)
        ? req.body.club_ids.map(Number).filter(Number.isFinite) : []
      const wanted = [...new Set([...fromOffers.map(Number), ...explicit])]
      if (!wanted.length) return res.json({ created: 0, refreshed: 0, skipped: [], portals: await portalsWithClubQuery(season) })

      const clubs = await database('basketplan_clubs').whereIn('id', wanted)
        .select('id', 'name', 'is_own_club', 'active', 'contact_name', 'contact_email', 'contact_email_secondary')

      let created = 0, refreshed = 0
      const skipped = []
      for (const club of clubs) {
        // Never mint a portal for ourselves, and never for a retired club.
        if (club.is_own_club) { skipped.push({ club: club.id, reason: 'own_club' }); continue }
        if (!club.active) { skipped.push({ club: club.id, reason: 'inactive' }); continue }

        const emails = parseRecipients([club.contact_email, club.contact_email_secondary].filter(Boolean)).join(', ')
        const clubId = String(club.id)
        const existing = await database('game_scheduling_club_portals')
          .where({ season, sport: 'basketball', club_id: clubId }).first()

        if (existing) {
          const patch = {}
          if (emails && (existing.contact_email || '') !== emails) patch.contact_email = emails
          if (club.contact_name && (existing.contact_name || '') !== club.contact_name) patch.contact_name = club.contact_name
          if (club.name && existing.club_name !== club.name) patch.club_name = club.name
          if (Object.keys(patch).length) {
            patch.date_updated = new Date().toISOString()
            await database('game_scheduling_club_portals').where('id', existing.id).update(patch)
            refreshed++
          }
          continue
        }

        await database('game_scheduling_club_portals').insert({
          season, sport: 'basketball', club_id: clubId, bp_club: club.id,
          club_name: club.name,
          token: crypto.randomBytes(16).toString('hex'), status: 'invited',
          contact_email: emails, contact_name: club.contact_name || '',
          expires_at: newPortalExpiry(seasonRow.season), created_by_admin: true,
        })
        created++
      }

      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'create',
        collection: 'game_scheduling_club_portals', recordId: null,
        data: { sport: 'basketball', season, created, refreshed, clubs: wanted },
      })
      res.json({ created, refreshed, skipped, portals: await portalsWithClubQuery(season) })
    } catch (err) { fail(res, 'admin/terminplanung/bb/portals/ensure', err, req) }
  })

  // POST /kscw/admin/terminplanung/bb/portals/:id/reissue — new token, lifecycle reset.
  router.post('/admin/terminplanung/bb/portals/:id/reissue', async (req, res) => {
    if (await denyUnlessBb(req, res)) return
    try {
      const id = parseInt(req.params.id, 10)
      if (!id) return res.status(400).json({ error: 'invalid id' })
      const portal = await database('game_scheduling_club_portals')
        .where({ id, sport: 'basketball' }).first()
      if (!portal) return res.status(404).json({ error: 'not found' })
      const seasonRow = await database('game_scheduling_seasons').where('id', portal.season).first('season')
      const nowIso = new Date().toISOString()
      const token = crypto.randomBytes(16).toString('hex')
      await database('game_scheduling_club_portals').where('id', id).update({
        token, status: 'invited', first_viewed_at: null, revoked_at: null,
        reissued_at: nowIso, expires_at: newPortalExpiry(seasonRow?.season), date_updated: nowIso,
      })
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'update',
        collection: 'game_scheduling_club_portals', recordId: id,
        data: { sport: 'basketball', reissued: true, club_name: portal.club_name },
      })
      res.json({ success: true, url: portalUrl(token) })
    } catch (err) { fail(res, 'admin/terminplanung/bb/portals/:id/reissue', err, req) }
  })

  // POST /kscw/admin/terminplanung/bb/portals/:id/revoke — kill the link.
  // The club's ANSWERS are kept: they are agreements with a third party, not
  // scratch state, and the row-level responded_by_* pair is the audit trail.
  router.post('/admin/terminplanung/bb/portals/:id/revoke', async (req, res) => {
    if (await denyUnlessBb(req, res)) return
    try {
      const id = parseInt(req.params.id, 10)
      if (!id) return res.status(400).json({ error: 'invalid id' })
      const portal = await database('game_scheduling_club_portals')
        .where({ id, sport: 'basketball' }).first()
      if (!portal) return res.status(404).json({ error: 'not found' })
      const nowIso = new Date().toISOString()
      await database('game_scheduling_club_portals').where('id', id)
        .update({ status: 'revoked', revoked_at: nowIso, date_updated: nowIso })
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'delete',
        collection: 'game_scheduling_club_portals', recordId: id,
        data: { sport: 'basketball', revoked: true, club_name: portal.club_name },
      })
      res.json({ success: true })
    } catch (err) { fail(res, 'admin/terminplanung/bb/portals/:id/revoke', err, req) }
  })

  // POST /kscw/admin/terminplanung/bb/portals/send — email the link.
  // Body: { season, ids?: number[], dry_run?: bool, reminder?: bool, allow_empty?: bool }
  //
  // dry_run returns the rendered previews so an operator reads the German copy
  // before anything leaves. Per CLAUDE.md's mass-email rule, send to ONE club
  // first (ids: [n]), read the received mail, then send the rest.
  router.post('/admin/terminplanung/bb/portals/send', async (req, res) => {
    if (await denyUnlessBb(req, res)) return
    try {
      // ⚠ FAIL-SAFE DEFAULT: a real send requires an EXPLICIT `dry_run: false`.
      // Omitting the flag previews and mails nothing. The UI always passes the
      // flag explicitly (useBasketballClubPortals.send), so this changes no app
      // behaviour — it exists so a hand-rolled curl or a future script cannot
      // blast every opponent club by forgetting one field (CLAUDE.md: never
      // mass-email real users for testing).
      const { season, ids = null, dry_run: dryRun = true, reminder = false, allow_empty: allowEmpty = false } = req.body || {}
      if (!season) return res.status(400).json({ error: 'season required' })
      const seasonRow = await database('game_scheduling_seasons').where('id', season).first()
      if (!seasonRow) return res.status(404).json({ error: 'season not found' })

      let q = database('game_scheduling_club_portals')
        .where({ season: Number(season), sport: 'basketball' })
        .whereNotIn('status', ['revoked', 'expired'])
      if (Array.isArray(ids) && ids.length) q = q.whereIn('id', ids.map(Number).filter(Number.isFinite))
      const portals = await q
      const [counts, freePitches] = await Promise.all([
        offerCountsBySeason(Number(season)),
        freePitchCountsBySeason(Number(season)),
      ])

      const previews = []; const failed = []; let sent = 0
      for (const portal of portals) {
        // A link with nothing on it reads as spam. Skip unless explicitly forced.
        //
        // ⚠ "Nothing on it" means no offers AND no pitches to pick. Testing offers alone
        // predates the opponent-picks flow and skipped every club, since a club that has not
        // been offered anything yet is exactly who the invite is for.
        const offers = counts[String(portal.bp_club)]?.total || 0
        const pickable = freePitches[String(portal.bp_club)] || 0
        if (!offers && !pickable && !allowEmpty) {
          failed.push({ id: portal.id, error: 'nothing_to_show' }); continue
        }

        const { subject, text, html } = bbClubInviteEmail({
          club: portal.club_name || '',
          season: seasonRow.season || '',
          url: portalUrl(portal.token),
          expires: fmtDate(portal.expires_at),
          reminder: !!reminder,
          // Drives which instructions the mail gives: pick dates, answer ours, or both.
          pickable,
          offers,
        })
        previews.push({
          id: portal.id, to: portal.contact_email, club_name: portal.club_name,
          offers, pickable, subject, html, text,
        })
        if (dryRun) continue

        if (!parseRecipients(portal.contact_email).length) {
          failed.push({ id: portal.id, error: 'no valid recipient' }); continue
        }
        try {
          await sendBbMail(portal.contact_email, subject, text, html)
          const nowIso = new Date().toISOString()
          await database('game_scheduling_club_portals').where('id', portal.id)
            .update(reminder ? { reminder_sent_at: nowIso, date_updated: nowIso } : { email_sent_at: nowIso, date_updated: nowIso })
          sent++
        } catch (e) { failed.push({ id: portal.id, error: e.message }) }
      }

      if (!dryRun) {
        await writeUserLog(database, log, {
          accountability: req.accountability, action: 'send',
          collection: 'game_scheduling_club_portals', recordId: null,
          data: { sport: 'basketball', season: Number(season), reminder: !!reminder, sent, failed: failed.length },
        })
      }
      res.json({ previews, sent, failed, dry_run: !!dryRun })
    } catch (err) { fail(res, 'admin/terminplanung/bb/portals/send', err, req) }
  })

  // POST /kscw/admin/terminplanung/bb/offer — publish placed games to the portal.
  // Body: { season, ids: number[], opponent_club?: number }
  //
  // draft → offered. `opponent_club` addresses the rows to a club in the same
  // call (the prep grid stores a free-text opponent TEAM; the portal needs the
  // CLUB). Rows already answered are never rewound.
  // POST /kscw/admin/terminplanung/bb/club-proposals — a planner answers what a club picked.
  //
  // Body: { season, ids: [plan ids], decision: 'accept' | 'release' }
  //
  //   accept  → proposal_status 'accepted'. Both sides now agree on the date, which is the
  //             whole deliverable of this module (WSR Art. 18) — it is still not a ProBasket
  //             fixture, but it is the agreement that excuses us from the Spielplansitzung.
  //   release → DELETE the row. That is deliberate, not a status flip: migration 278's
  //             `…_0_release_slots` trigger only fires on DELETE, so deleting is the one thing
  //             that puts the pitch back on every club's free list. A 'declined' row would
  //             hold the slot forever.
  //
  // ⚠ Only `club_proposed` rows are touched. Answering an 'offered' row is the club's job via
  // the portal, and rewriting an already-'accepted' one behind their back would silently
  // change an agreement they were told was settled.
  router.post('/admin/terminplanung/bb/club-proposals', async (req, res) => {
    if (await denyUnlessBb(req, res)) return
    try {
      const season = Number(req.body?.season)
      const ids = Array.isArray(req.body?.ids)
        ? [...new Set(req.body.ids.map(Number).filter(Number.isFinite))] : []
      const decision = String(req.body?.decision || '')
      if (!season || !ids.length) return res.status(400).json({ error: 'season and ids required' })
      if (decision !== 'accept' && decision !== 'release') {
        return res.status(400).json({ error: 'decision must be accept or release' })
      }

      const rows = await database('basketball_slot_plan')
        .where('season', season).whereIn('id', ids)
        .select('id', 'proposal_status')
      if (rows.length !== ids.length) return res.status(400).json({ error: 'invalid ids' })
      const wrongState = rows.filter((r) => r.proposal_status !== 'club_proposed')
      if (wrongState.length) {
        return res.status(400).json({ error: 'not_club_proposed', ids: wrongState.map((r) => r.id) })
      }

      const nowIso = new Date().toISOString()
      let affected
      if (decision === 'accept') {
        affected = await database('basketball_slot_plan')
          .whereIn('id', ids).where('proposal_status', 'club_proposed')
          .update({ proposal_status: 'accepted', responded_at: nowIso, date_updated: nowIso })
      } else {
        affected = await database('basketball_slot_plan')
          .whereIn('id', ids).where('proposal_status', 'club_proposed')
          .del()
      }

      await writeUserLog(database, log, {
        accountability: req.accountability, action: decision === 'accept' ? 'update' : 'delete',
        collection: 'basketball_slot_plan', recordId: null,
        data: { action: `club_proposal_${decision}`, season, ids, affected },
      })
      res.json({ success: true, affected })
    } catch (err) { fail(res, 'admin/terminplanung/bb/club-proposals', err, req) }
  })

  router.post('/admin/terminplanung/bb/offer', async (req, res) => {
    if (await denyUnlessBb(req, res)) return
    try {
      const season = Number(req.body?.season)
      // Deduped: the length comparison below is how we prove every id exists, so a
      // repeated id would otherwise read as "one of these does not exist".
      const ids = Array.isArray(req.body?.ids)
        ? [...new Set(req.body.ids.map(Number).filter(Number.isFinite))] : []
      const opponentClub = req.body?.opponent_club == null ? null : Number(req.body.opponent_club)
      if (!season || !ids.length) return res.status(400).json({ error: 'season and ids required' })
      if (opponentClub != null && !Number.isFinite(opponentClub)) return res.status(400).json({ error: 'invalid opponent_club' })
      if (opponentClub != null) {
        const club = await database('basketplan_clubs').where('id', opponentClub).first('id', 'is_own_club', 'active')
        if (!club) return res.status(404).json({ error: 'club not found' })
        if (club.is_own_club || !club.active) return res.status(400).json({ error: 'club not offerable' })
      }

      const rows = await database('basketball_slot_plan')
        .where('season', season).whereIn('id', ids)
        .select('id', 'opponent_club', 'proposal_status', 'game_type')
      if (rows.length !== ids.length) return res.status(400).json({ error: 'invalid ids' })
      // A 'guest' row is somebody else's game borrowing our hall — never an offer.
      if (rows.some((r) => r.game_type !== 'home')) return res.status(400).json({ error: 'guest_game_not_offerable' })
      const missingClub = rows.filter((r) => !r.opponent_club && opponentClub == null)
      if (missingClub.length) return res.status(400).json({ error: 'opponent_club required', ids: missingClub.map((r) => r.id) })

      const nowIso = new Date().toISOString()
      const patch = { proposal_status: 'offered', offered_at: nowIso, date_updated: nowIso }
      if (opponentClub != null) patch.opponent_club = opponentClub
      const updated = await database('basketball_slot_plan')
        .whereIn('id', ids).where('proposal_status', 'draft').update(patch)

      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'update',
        collection: 'basketball_slot_plan', recordId: null,
        data: { action: 'offer', season, ids, opponent_club: opponentClub, updated },
      })
      res.json({ success: true, updated })
    } catch (err) { fail(res, 'admin/terminplanung/bb/offer', err, req) }
  })

  // POST /kscw/admin/terminplanung/bb/unoffer — pull an offer back to draft.
  // Only rows the club has NOT answered yet: an answered row is an agreement with
  // a third party, and silently un-publishing it would hide that from the planner.
  router.post('/admin/terminplanung/bb/unoffer', async (req, res) => {
    if (await denyUnlessBb(req, res)) return
    try {
      const season = Number(req.body?.season)
      const ids = Array.isArray(req.body?.ids)
        ? [...new Set(req.body.ids.map(Number).filter(Number.isFinite))] : []
      if (!season || !ids.length) return res.status(400).json({ error: 'season and ids required' })
      const nowIso = new Date().toISOString()
      const updated = await database('basketball_slot_plan')
        .where('season', season).whereIn('id', ids)
        .where('proposal_status', 'offered').whereNull('responded_at')
        .update({ proposal_status: 'draft', offered_at: null, date_updated: nowIso })
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'update',
        collection: 'basketball_slot_plan', recordId: null,
        data: { action: 'unoffer', season, ids, updated },
      })
      res.json({ success: true, updated })
    } catch (err) { fail(res, 'admin/terminplanung/bb/unoffer', err, req) }
  })
}
