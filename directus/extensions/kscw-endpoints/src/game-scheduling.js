/**
 * Game Scheduling (Terminplanung)
 * Public: register, view slots, book home, propose away
 * Admin: generate slots, confirm away, block slot
 */

import crypto from 'crypto'
import { FRONTEND_URL, buildEmailLayout, buildInfoCard, escHtml } from './email-template.js'
import { VALID_LANGS, schedEmail, inviteEmail } from './terminplanung-emails.js'

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || ''

// Spielplanung mail identity. spielplanung.kscw.ch is SES-verified (Easy DKIM),
// so SES can send From it with DKIM-aligned DMARC. From + replies both land on
// the dedicated Migadu mailbox volleyball@spielplanung.kscw.ch. (The kscw.ch
// apex stays ClubDesk's — we never send from it.)
//
// This Directus MailService treats `from` as the ADDRESS only (the display name
// comes from the global EMAIL_FROM_NAME). Passing a combined "Name <addr>"
// string here collapses into an invalid address, so SCHEDULING_FROM must be the
// bare mailbox.
const SCHEDULING_FROM = 'volleyball@spielplanung.kscw.ch'
const SCHEDULING_REPLY_TO = 'volleyball@spielplanung.kscw.ch'

// Wrap a German admin-notify body (the internal spielplanung-mailbox emails) in
// the shared branded layout. Dates must already be Swiss-formatted by the
// caller. `infoRows` (optional) renders as an info card between the lead and any
// trailing CTA paragraph.
function adminNotifyHtml({ title, lead, infoRows, ctaText, ctaUrl, ctaLabel }) {
  const para = (s) => `<p style="font-size:14px;color:#e2e8f0;line-height:1.6;margin:0 0 12px">${escHtml(s)}</p>`
  let body = ''
  if (lead) body += para(lead)
  if (infoRows && infoRows.length) {
    body += buildInfoCard(infoRows) + '<div style="height:12px;font-size:0;line-height:0">&nbsp;</div>'
  }
  if (ctaText) body += para(ctaText)
  return buildEmailLayout(body, {
    title,
    sport: 'vb',
    ctaUrl: ctaUrl || undefined,
    ctaLabel: ctaUrl ? (ctaLabel || 'Dashboard öffnen') : undefined,
  })
}

async function verifyTurnstile(token) {
  if (!TURNSTILE_SECRET) {
    console.error('[game-scheduling] TURNSTILE_SECRET not configured — rejecting request')
    return false
  }
  const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `secret=${TURNSTILE_SECRET}&response=${token}`,
  })
  return (await resp.json()).success === true
}

// Format a stored date / naive datetime for emails as Swiss { date: dd.mm.yyyy,
// time: HH:MM }. Values arrive either as ISO strings ('YYYY-MM-DD' or
// 'YYYY-MM-DDTHH:MM…Z', a naive wall-clock stored with a Z suffix) OR — when the
// pg driver hydrates a DATE/timestamp column from `select('*')` — as a JS Date
// object. Both the date columns (UTC midnight) and the naive datetimes are
// UTC-anchored, so read Date objects via their UTC parts; slice ISO strings.
// Never fall through to String(Date), which leaks 'Fri Oct 23 2026 … GMT'.
function fmtDateMail(val) {
  if (val instanceof Date && !isNaN(val)) {
    const dd = String(val.getUTCDate()).padStart(2, '0')
    const mo = String(val.getUTCMonth() + 1).padStart(2, '0')
    const yy = val.getUTCFullYear()
    const h = val.getUTCHours(), mi = val.getUTCMinutes()
    return {
      date: `${dd}.${mo}.${yy}`,
      time: (h || mi) ? `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : '',
    }
  }
  const m = String(val || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/)
  if (!m) return { date: String(val || ''), time: '' }
  return { date: `${m[3]}.${m[2]}.${m[1]}`, time: m[4] ? `${m[4]}:${m[5]}` : '' }
}

// Weekday (Mon-Fri) home games are always at 20:00 — the slot is just the hall
// window (e.g. 19:30-21:30). Weekend slots (Spielsamstag / junior Sunday) keep
// their start time. Used in confirm + finalize emails so they match the calendar
// / export / VM push. Returns 'HH:MM'.
function weekdayHomeTime(dateYmd, startTime) {
  const dow = new Date(`${String(dateYmd || '').slice(0, 10)}T00:00:00Z`).getUTCDay() // 0=Sun..6=Sat
  return dow >= 1 && dow <= 5 ? '20:00' : String(startTime || '').slice(0, 5)
}

export function registerGameScheduling(router, { database, logger, services, getSchema }) {
  const log = logger.child({ endpoint: 'game-scheduling' })

  // Fire-and-forget push of a confirmed HOME booking's date/time/hall into
  // VolleyManager (volleymanager.volleyball.ch) via scripts/vm-push-game.mjs.
  // The child self-authenticates (sync admin + VM creds) and writes the push
  // result back onto the booking (vm_push_status/…). Never blocks the request;
  // a VM failure is recorded on the booking, not surfaced as an HTTP error.
  async function spawnVmPush(bookingId, { svrzId = null } = {}) {
    try {
      if (!process.env.VM_USERNAME || !process.env.VM_PASSWORD) {
        log.warn('VM push skipped: VM_USERNAME/VM_PASSWORD not set')
        return
      }
      if (!process.env.DIRECTUS_SYNC_EMAIL || !process.env.DIRECTUS_SYNC_PASSWORD) {
        log.warn('VM push skipped: DIRECTUS_SYNC_EMAIL/PASSWORD not set')
        return
      }
      const { spawn } = await import('node:child_process')
      const { openSync } = await import('node:fs')
      let logOut, logErr
      try { logOut = openSync('/directus/logs/vm-push.log', 'a'); logErr = logOut } catch { logOut = 'ignore'; logErr = 'ignore' }
      // Scoped env — forward only what the child needs (no process.env spread).
      const env = {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        VM_USERNAME: process.env.VM_USERNAME,
        VM_PASSWORD: process.env.VM_PASSWORD,
        VM_CLUB_UUID: process.env.VM_CLUB_UUID || '',
        KSCW_SVRZ_CLUB_ID: process.env.KSCW_SVRZ_CLUB_ID || '',
        DIRECTUS_URL: 'http://127.0.0.1:8055',
        DIRECTUS_SYNC_EMAIL: process.env.DIRECTUS_SYNC_EMAIL,
        DIRECTUS_SYNC_PASSWORD: process.env.DIRECTUS_SYNC_PASSWORD,
        BOOKING_ID: String(bookingId),
        ...(svrzId ? { FORCE_SVRZ_ID: String(svrzId) } : {}),
      }
      const child = spawn('node', ['/directus/scripts/vm-push-game.mjs'], { env, detached: true, stdio: ['ignore', logOut, logErr] })
      child.unref()
    } catch (e) {
      log.warn(`spawnVmPush failed: ${e.message}`)
    }
  }

  // An opponent's contact_email may hold SEVERAL addresses (a club often lists
  // multiple Spielplanverantwortliche) joined by comma/semicolon. Split into a
  // clean array so every contact receives the invite + all scheduling mail.
  // Directus MailService accepts a string[] for `to`/`cc`.
  // Scraped SVRZ contacts feed straight into the SMTP recipient list, so harden
  // each part: strip CR/LF (header-injection defence) and drop anything that
  // isn't a plausible bare address. Returns '' when nothing valid survives — the
  // send path skips + logs rather than handing garbage to the mailer.
  const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/
  function parseRecipients(v) {
    const clean = (s) => String(s).replace(/[\r\n]+/g, '').trim()
    const raw = Array.isArray(v) ? v.map(clean) : clean(v).split(/[,;]+/).map((s) => s.trim())
    const parts = raw.filter((s) => s && EMAIL_RE.test(s))
    return parts.length > 1 ? parts : (parts[0] || '')
  }

  // Send a Terminplanung email from the dedicated spielplanung identity.
  // Best-effort: callers wrap in try/catch so a mail failure never blocks the action.
  async function sendSchedulingMail(to, subject, text, cc = null, html = null) {
    const recipients = parseRecipients(to)
    // No valid address survived sanitisation — skip the send (don't throw).
    if (!recipients || (Array.isArray(recipients) && recipients.length === 0)) {
      log.warn(`Scheduling email skipped: no valid recipient (subject: ${subject})`)
      return
    }
    const ccRecipients = cc ? parseRecipients(cc) : undefined
    const schema = await getSchema()
    const { MailService } = services
    const mail = new MailService({ schema, knex: database })
    await mail.send({ to: recipients, cc: (ccRecipients && ccRecipients.length) ? ccRecipients : undefined, from: SCHEDULING_FROM, replyTo: SCHEDULING_REPLY_TO, subject, text, html: html || undefined })
  }

  // Coach + team-responsible emails for a KSCW team (deduped, real addresses
  // only). M2M: teams_coaches / teams_responsibles (teams_id, members_id) join
  // members.email — same pattern as contact-form.js. Used to inform team staff
  // on slot confirmations: they're told the outcome, they don't decide.
  async function teamStaffEmails(teamId) {
    if (!teamId) return []
    const [coaches, trs] = await Promise.all([
      database('teams_coaches')
        .join('members', 'members.id', 'teams_coaches.members_id')
        .where('teams_coaches.teams_id', teamId)
        .whereNotNull('members.email')
        .select('members.email'),
      database('teams_responsibles')
        .join('members', 'members.id', 'teams_responsibles.members_id')
        .where('teams_responsibles.teams_id', teamId)
        .whereNotNull('members.email')
        .select('members.email'),
    ])
    return Array.from(new Set(
      [...coaches, ...trs].map(r => r.email).filter(e => e && !e.includes('@placeholder'))
    ))
  }

  // POST /kscw/terminplanung/register — opponent registers (public + Turnstile)
  router.post('/terminplanung/register', async (req, res) => {
    try {
      const { team_name, contact_name, contact_email, turnstile_token, kscw_team, language } = req.body
      if (!team_name || !contact_name || !contact_email || !kscw_team) {
        return res.status(400).json({ error: 'team_name, contact_name, contact_email, kscw_team required' })
      }
      const lang = VALID_LANGS.includes(String(language || '').toLowerCase()) ? String(language).toLowerCase() : null
      if (!turnstile_token || !(await verifyTurnstile(turnstile_token))) {
        return res.status(400).json({ error: 'Captcha verification failed' })
      }

      const token = crypto.randomBytes(16).toString('hex')
      const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString()

      await database('game_scheduling_opponents').insert({
        team_name, contact_name, contact_email: contact_email.toLowerCase().trim(),
        token, kscw_team, status: 'active', expires_at: expiresAt, language: lang,
      })

      // Send confirmation email (branded HTML + plain-text fallback).
      try {
        const accessUrl = `${FRONTEND_URL}/terminplanung/${token}`
        const text = `Hallo ${contact_name},\n\nDein Zugangslink zur Spielplanung:\n${accessUrl}\n\nDieser Link ist 30 Tage gültig.\n\nKSC Wiedikon`
        const html = buildEmailLayout(
          `<p style="font-size:14px;color:#e2e8f0;line-height:1.6;margin:0 0 12px">Dein Zugangslink zur Spielplanung ist bereit. Der Link ist 30 Tage gültig.</p>`,
          {
            title: 'Spielplanung',
            sport: 'vb',
            greeting: `Hallo ${contact_name},`,
            ctaUrl: accessUrl,
            ctaLabel: 'Zur Spielplanung',
            footerExtra: 'Sportliche Grüsse, KSC Wiedikon',
          },
        )
        await sendSchedulingMail(contact_email, 'KSC Wiedikon – Spielplanung', text, null, html)
      } catch (mailErr) {
        log.warn(`Scheduling email failed: ${mailErr.message}`)
      }

      // Notify the spielplanung mailbox (auto-forwards to the VB Spielplanung
      // group) that a new opponent registered. Best-effort.
      try {
        const team = await database('teams').where('id', kscw_team).first('name')
        const kscw = `KSCW ${team?.name || ''}`.trim()
        const text = `${team_name} (${contact_name}, ${contact_email}) hat sich für die Spielplanung gegen ${kscw} registriert.`
        const html = adminNotifyHtml({
          title: 'Neue Anmeldung Spielplanung',
          lead: `${team_name} hat sich für die Spielplanung gegen ${kscw} registriert.`,
          infoRows: [
            { label: 'Team', value: team_name },
            { label: 'Kontakt', value: contact_name },
            { label: 'E-Mail', value: contact_email },
            { label: 'Gegner', value: kscw },
          ],
        })
        await sendSchedulingMail(SCHEDULING_REPLY_TO, `Neue Anmeldung Spielplanung – ${team_name} (${kscw})`, text, null, html)
      } catch (mailErr) {
        log.warn(`Scheduling group notice failed: ${mailErr.message}`)
      }

      // Do NOT return the token here — it travels via email only. Returning
      // it in the response would let any caller who passes Turnstile receive
      // a token bound to an arbitrary contact_email they don't control.
      res.json({ success: true, expires_at: expiresAt })
    } catch (err) {
      log.error({ msg: `terminplanung/register: ${err.message}`, endpoint: 'terminplanung/register', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // In-memory rate limiter for token lookups and writes (per IP)
  const tokenAttempts = new Map() // ip → { count, resetAt }
  const writeAttempts = new Map() // ip → { count, resetAt }
  const langAttempts = new Map()  // ip → { count, resetAt } — language flips (generous)

  function rateLimit(map, req, maxAttempts, windowMs) {
    // 2026-05-12 audit #20: prefer CF-Connecting-IP (set by Cloudflare Tunnel)
    // over `req.ip` (which is the tunnel IP under reverse proxy) over
    // X-Forwarded-For (spoofable if `trust proxy` isn't set on Express).
    // Documented gap in SECURITY.md: limiter is safe ONLY behind CF Tunnel.
    const xff = req.headers['x-forwarded-for']
    const ip = req.headers['cf-connecting-ip']
      || (typeof xff === 'string' ? xff.split(',')[0].trim() : '')
      || req.ip
      || 'unknown'
    const now = Date.now()
    const attempt = map.get(ip)
    if (attempt && now < attempt.resetAt) {
      if (attempt.count >= maxAttempts) return false
      attempt.count++
    } else {
      map.set(ip, { count: 1, resetAt: now + windowMs })
    }
    if (map.size > 1000) {
      for (const [k, v] of map) { if (now > v.resetAt) map.delete(k) }
    }
    return true
  }

  // True if the caller is a full admin OR a club-wide Spielplaner
  // (members.is_spielplaner = true). Used to gate the operational
  // /admin/terminplanung/* action endpoints (the items-API reads/writes are
  // gated by the "KSCW Terminplanung" Directus policy instead). Structural
  // season ops (restore/archive/rollover) stay admin-only.
  async function isAdminOrSpielplaner(req) {
    if (req.accountability?.admin) return true
    const userId = req.accountability?.user
    if (!userId) return false
    const member = await database('members').where('user', userId).select('is_spielplaner').first()
    return member?.is_spielplaner === true
  }

  // Per-team scheduler authorisation (migration 031 design): a caller may manage a
  // given team's scheduling if they are (a) a full admin, (b) a per-team scheduler
  // (`spielplaner_assignments` row for that team), or (c) a CLUB-WIDE Spielplaner
  // (`members.is_spielplaner = true`) with NO assignment rows — the documented
  // unrestricted role. A scoped scheduler (≥1 assignment) is limited to their
  // assigned teams; a club-wide scheduler keeps full access (never locked out).
  async function spielplanerCanManageTeam(req, teamId) {
    if (req.accountability?.admin) return true
    const userId = req.accountability?.user
    if (!userId) return false
    const member = await database('members').where('user', userId).select('id', 'is_spielplaner').first()
    if (!member) return false
    const assigns = await database('spielplaner_assignments').where('member', member.id).pluck('kscw_team')
    if (assigns.length > 0) return assigns.map(Number).includes(Number(teamId)) // scoped scheduler
    return member.is_spielplaner === true // club-wide (documented design) — unrestricted
  }

  // Default game-spacing gaps (days) when a season has no gap_config. ±N means
  // the team never plays two games closer than N days apart (date ± N → a
  // (2N+1)-day exclusion span per game). Per-season overrides live in
  // game_scheduling_seasons.gap_config (migration 083); home and away proposals
  // can differ, and the lenient 3rd away proposal can use a smaller gap.
  const DEFAULT_GAPS = { home: 4, proposal: 4, proposal3: 2 }

  // How wide a *held* first proposal (choice 1) blocks others — a soft reserve,
  // intentionally narrower than the full game-spacing gap. Choices 2 & 3 don't
  // hold (they warn; see the admin review's windowed contention: ±2 / ±1).
  const HOLD_WINDOW_DAYS = 2

  // Read the per-season gaps, falling back to DEFAULT_GAPS for missing/invalid
  // values. gap_config is jsonb → knex returns a parsed object.
  async function seasonGaps(seasonId) {
    let cfg = {}
    if (seasonId) {
      const row = await database('game_scheduling_seasons').where('id', seasonId).first('gap_config')
      if (row && row.gap_config && typeof row.gap_config === 'object') cfg = row.gap_config
    }
    const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : d)
    return {
      home: num(cfg.home, DEFAULT_GAPS.home),
      proposal: num(cfg.proposal, DEFAULT_GAPS.proposal),
      proposal3: num(cfg.proposal3, DEFAULT_GAPS.proposal3),
    }
  }

  // Advisory-lock namespace (classid) for serializing home-slot bookings per
  // team. pg_advisory_xact_lock(GSCH_BOOK_LOCK_CLASS, kscw_team) makes two
  // opponents booking different-but-nearby slots for the same team wait in line,
  // so the gap + Saturday-cap checks can't be raced (the per-slot FOR UPDATE
  // only guards the same slot row). Arbitrary constant, unused elsewhere.
  const GSCH_BOOK_LOCK_CLASS = 920601

  // Dates (YYYY-MM-DD) the KSCW team is already committed to play — real SVRZ
  // games, home slots an opponent has already booked, and confirmed away
  // proposals — each expanded ±gapDays so the team never plays games closer
  // together than that. A booked slot or a confirmed proposal therefore blocks
  // exactly like a real game: no other opponent can take that date or one within
  // the window (home-slot list + away proposals + away calendar greying). The
  // window size is caller-supplied because home games, away proposals 1-2 and
  // away proposal 3 may each use a different gap (see seasonGaps).
  //
  // opts.includeHeld: also treat the FIRST proposal of any *pending* booking as
  // committed ("held") — a held home slot-1 / away date-1 reserves the date the
  // same way a real game does, so no one else can take it. Proposals 2 & 3 never
  // hold (they're soft alternatives — the admin just gets a contention warning).
  // opts.excludeOpponent: skip that opponent's own holds, so their slot-1 reserve
  // doesn't block their own alternatives (2 & 3) or their re-proposal.
  async function committedGameDates(kscwTeamId, gapDays = DEFAULT_GAPS.home, opts = {}) {
    const set = new Set()
    const addWindow = (val, w = gapDays) => {
      if (!val) return
      const base = new Date(`${String(val).slice(0, 10)}T00:00:00Z`)
      if (Number.isNaN(base.getTime())) return
      for (let off = -w; off <= w; off++) {
        const x = new Date(base); x.setUTCDate(x.getUTCDate() + off)
        set.add(x.toISOString().slice(0, 10))
      }
    }
    const games = await database('games')
      .where('kscw_team', kscwTeamId).whereNotNull('date')
      .select(database.raw('games.date::text as d'))
    games.forEach((g) => addWindow(g.d))
    const booked = await database('game_scheduling_slots')
      .where('kscw_team', kscwTeamId).where('status', 'booked')
      .select(database.raw('date::text as d'))
    booked.forEach((s) => addWindow(s.d))
    const confirmed = await database('game_scheduling_bookings as b')
      .join('game_scheduling_opponents as o', 'o.id', 'b.opponent')
      .where('o.kscw_team', kscwTeamId)
      .where('b.type', 'away_proposal').where('b.status', 'confirmed')
      .select('b.confirmed_proposal as n', database.raw('b.proposed_datetime_1::text as d1'),
              database.raw('b.proposed_datetime_2::text as d2'), database.raw('b.proposed_datetime_3::text as d3'))
    confirmed.forEach((b) => addWindow(b[`d${b.n}`]))
    // Confirmed intra-club derby legs are real games — block their gap window
    // too (Art. 27). A team is team_a or team_b of the pair.
    const derbies = await database('game_scheduling_derbies')
      .where('confirmed', true)
      .where(function () { this.where('team_a', kscwTeamId).orWhere('team_b', kscwTeamId) })
      .select(database.raw('leg1_date::text as leg1_date'), database.raw('leg2_date::text as leg2_date'))
    derbies.forEach((r) => { addWindow(r.leg1_date); addWindow(r.leg2_date) })

    if (opts.includeHeld) {
      const heldBase = () => {
        const q = database('game_scheduling_bookings as b')
          .join('game_scheduling_opponents as o', 'o.id', 'b.opponent')
          .where('o.kscw_team', kscwTeamId).where('b.status', 'pending')
        if (opts.excludeOpponent) q.whereNot('b.opponent', opts.excludeOpponent)
        return q
      }
      // Home: pending proposed_slot_1 → its slot date. Held with the fixed,
      // narrow HOLD_WINDOW_DAYS (not the context gap) — a soft reserve.
      const heldHome = await heldBase()
        .where('b.type', 'home_slot_pick').whereNotNull('b.proposed_slot_1')
        .join('game_scheduling_slots as s', 's.id', 'b.proposed_slot_1')
        .select(database.raw('s.date::text as d'))
      heldHome.forEach((r) => addWindow(r.d, HOLD_WINDOW_DAYS))
      // Away: pending proposed_datetime_1.
      const heldAway = await heldBase()
        .where('b.type', 'away_proposal').whereNotNull('b.proposed_datetime_1')
        .select(database.raw('b.proposed_datetime_1::text as d'))
      heldAway.forEach((r) => addWindow(r.d, HOLD_WINDOW_DAYS))
    }
    return set
  }

  // ── Scheduling-rule helpers (A1–A4, C1 cross-team) ───────────────────────
  // Juniors (HU23-1, HU20, DU23-1, DU23-2, …) are detected by name pattern: a
  // "U" followed by a digit. They have no Saturday cap and are the only teams
  // eligible for Sunday home slots.
  const isJuniorTeam = (name) => /u\d/i.test(String(name || ''))

  // UTC day-of-week from a YYYY-MM-DD string (0=Sun … 6=Sat). Matches the UTC
  // date math used elsewhere in this file; never use local getDay() (TZ shift).
  const dowUTC = (ymd) => new Date(`${String(ymd).slice(0, 10)}T00:00:00Z`).getUTCDay()
  const isSaturday = (ymd) => dowUTC(ymd) === 6
  const isSunday = (ymd) => dowUTC(ymd) === 0

  // A team "has an evening slot" if it owns a KWI block ending 21:30 OR uses a
  // volleyball Döltschi slot — i.e. it would NOT fall back to the club Spielhalle
  // pool in generate-slots. Teams with no evening slot get a higher Saturday cap.
  async function hasEveningSlot(teamId, db = database) {
    const ownKwi = await db('hall_slots')
      .join('hall_slots_teams', 'hall_slots.id', 'hall_slots_teams.hall_slots_id')
      .join('halls', 'hall_slots.hall', 'halls.id')
      .where('hall_slots_teams.teams_id', teamId)
      .whereRaw("hall_slots.end_time::text LIKE '21:30%'")
      .whereRaw("LOWER(halls.name) LIKE '%kwi%'")
      .first()
    if (ownKwi) return true
    const doltschi = await db('hall_slots')
      .join('hall_slots_teams', 'hall_slots.id', 'hall_slots_teams.hall_slots_id')
      .join('halls', 'hall_slots.hall', 'halls.id')
      .where('hall_slots_teams.teams_id', teamId)
      .where('hall_slots.sport', 'volleyball')
      .whereRaw("(LOWER(halls.name) LIKE '%döltschi%' OR LOWER(halls.name) LIKE '%doltschi%')")
      .first()
    return !!doltschi
  }

  // Effective max number of Saturday home games per season for a team:
  //   junior → ∞ (A2), no evening slot → 3 (A4), otherwise → 2 (A1).
  async function teamSaturdayCap(team, db = database) {
    if (isJuniorTeam(team?.name)) return Infinity
    if (!(await hasEveningSlot(team.id, db))) return 3
    return 2
  }

  // Other team ids that share ≥1 person with this team — counting any role: a
  // real player (member_teams, guest_level 0/null), a coach (teams_coaches), or a
  // team-responsible (teams_responsibles). A person can't be in two places on the
  // same day, so e.g. someone who PLAYS for D1 and COACHES D2 makes D1 & D2
  // mutually exclusive that day. Drives the cross-team same-day rule.
  async function sharedPlayerTeams(teamId, db = database) {
    // Everyone linked to THIS team, by any role.
    const memberIds = new Set()
    ;(await db('member_teams').where('team', teamId)
      .where(function () { this.where('guest_level', 0).orWhereNull('guest_level') })
      .pluck('member')).forEach((m) => memberIds.add(m))
    ;(await db('teams_coaches').where('teams_id', teamId).pluck('members_id')).forEach((m) => memberIds.add(m))
    ;(await db('teams_responsibles').where('teams_id', teamId).pluck('members_id')).forEach((m) => memberIds.add(m))
    if (memberIds.size === 0) return []
    const ids = [...memberIds]
    // Other teams those people are linked to, by any role.
    const out = new Set()
    ;(await db('member_teams').whereIn('member', ids).whereNot('team', teamId)
      .where(function () { this.where('guest_level', 0).orWhereNull('guest_level') })
      .pluck('team')).forEach((t) => out.add(t))
    ;(await db('teams_coaches').whereIn('members_id', ids).whereNot('teams_id', teamId).pluck('teams_id')).forEach((t) => out.add(t))
    ;(await db('teams_responsibles').whereIn('members_id', ids).whereNot('teams_id', teamId).pluck('teams_id')).forEach((t) => out.add(t))
    return [...out]
  }

  // Which of the given teams have a committed game (real game, booked home slot,
  // or confirmed away proposal) on the exact date `ymd`. Returns the conflicting
  // team ids (empty = none). Drives the cross-team same-day rule + its message.
  async function teamsCommittedOnDate(teamIds, ymd, db = database) {
    const out = new Set()
    if (!teamIds || teamIds.length === 0) return []
    const day = String(ymd).slice(0, 10)
    const games = await db('games').whereIn('kscw_team', teamIds)
      .whereRaw('date::text = ?', [day]).pluck('kscw_team')
    games.forEach((id) => out.add(id))
    const booked = await db('game_scheduling_slots').whereIn('kscw_team', teamIds)
      .where('status', 'booked').whereRaw('date::text = ?', [day]).pluck('kscw_team')
    booked.forEach((id) => out.add(id))
    const confirmed = await db('game_scheduling_bookings as b')
      .join('game_scheduling_opponents as o', 'o.id', 'b.opponent')
      .whereIn('o.kscw_team', teamIds)
      .where('b.type', 'away_proposal').where('b.status', 'confirmed')
      .select('o.kscw_team as t', 'b.confirmed_proposal as n',
              database.raw('b.proposed_datetime_1::text as d1'), database.raw('b.proposed_datetime_2::text as d2'), database.raw('b.proposed_datetime_3::text as d3'))
    confirmed.forEach((b) => { if (String(b[`d${b.n}`] || '').slice(0, 10) === day) out.add(b.t) })
    return [...out]
  }

  // Distinct Saturday dates a team already has a HOME game on — booked home slots
  // (the tool's own picks) plus KSCW-home rows in `games` (home_team is KSCW),
  // deduped by date. Drives the Saturday cap (A1/A4).
  async function committedSaturdayDates(teamId, db = database) {
    const set = new Set()
    const booked = await db('game_scheduling_slots').where('kscw_team', teamId).where('status', 'booked')
      .select(db.raw('date::text as d'))
    booked.forEach((s) => { if (isSaturday(s.d)) set.add(String(s.d).slice(0, 10)) })
    const homeGames = await db('games').where('kscw_team', teamId).whereNotNull('date')
      .whereRaw("LOWER(home_team) LIKE 'ksc wiedikon%'")
      .select(db.raw('date::text as d'))
    homeGames.forEach((g) => { if (isSaturday(g.d)) set.add(String(g.d).slice(0, 10)) })
    return set
  }

  // ── Intra-club derby anchoring (Art. 27 SVRZ) ────────────────────────
  // When two KSCW teams share a league group (e.g. H1 & H3 in 2L), their two
  // head-to-head games MUST be the first game of the Vorrunde and of the
  // Rückrunde (Art. 27 Abs. 6 lit. a — forfait otherwise). The spielplaner fixes
  // those two dates manually (game_scheduling_derbies); once confirmed, every
  // OTHER home-slot offer + away-date proposal for both teams is clamped to
  // after the relevant derby date, per half.

  // Normalise a date column value (pg Date object or ISO string) → 'YYYY-MM-DD'.
  const ymdOf = (v) => {
    if (!v) return null
    if (typeof v === 'string') return v.slice(0, 10)
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return null
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }

  // Boundary between the Vorrunde and the Rückrunde = 01.01 of the season's
  // second year. Swiss indoor volleyball always spans the new year (Vorrunde
  // Sep–Dec, Rückrunde Jan–Mar), so the year turn is the reliable split and
  // needs no per-season config. Returns 'YYYY-01-01' or null if unparseable.
  const rueckrundeStart = (seasonRow) => {
    const m = String(seasonRow?.season || '').match(/(\d{4})\D+(\d{2,4})/)
    if (!m) return null
    let y2 = parseInt(m[2], 10)
    if (y2 < 100) y2 = 2000 + y2
    return `${y2}-01-01`
  }

  // Confirmed-derby anchors for a team in a season: the LATEST Vorrunde-leg date
  // and the LATEST Rückrunde-leg date across every confirmed derby the team is in
  // (latest, so ALL its derbies come first when a club has 3+ teams in a group).
  // A leg counts as Vorrunde if its date < boundary, else Rückrunde.
  async function confirmedDerbyAnchors(kscwTeamId, seasonId, boundary) {
    const anchors = { vor: null, rueck: null }
    if (!kscwTeamId || !seasonId || !boundary) return anchors
    const rows = await database('game_scheduling_derbies')
      .where('season', seasonId).where('confirmed', true)
      .where(function () { this.where('team_a', kscwTeamId).orWhere('team_b', kscwTeamId) })
      .select('leg1_date', 'leg2_date')
    for (const r of rows) {
      for (const raw of [r.leg1_date, r.leg2_date]) {
        const d = ymdOf(raw)
        if (!d) continue
        if (d < boundary) { if (!anchors.vor || d > anchors.vor) anchors.vor = d }
        else { if (!anchors.rueck || d > anchors.rueck) anchors.rueck = d }
      }
    }
    return anchors
  }

  // Is candidate date `d` blocked by the derby anchors — i.e. on/before the
  // derby date within its own half? (The derby is first; nothing else before it.)
  const derbyDateBlocked = (d, anchors, boundary) => {
    if (!d || !anchors || !boundary) return false
    const day = String(d).slice(0, 10)
    return day < boundary
      ? !!(anchors.vor && day <= anchors.vor)
      : !!(anchors.rueck && day <= anchors.rueck)
  }

  // Materialise the blocked dates across the season window (used to grey the
  // away calendar, which works off explicit date lists). ~270 iterations.
  const buildDerbyBlockedSet = (anchors, boundary, seasonRow) => {
    const set = new Set()
    if (!anchors || (!anchors.vor && !anchors.rueck) || !boundary) return set
    const m = String(seasonRow?.season || '').match(/(\d{4})\D+(\d{2,4})/)
    if (!m) return set
    const y1 = parseInt(m[1], 10)
    let y2 = parseInt(m[2], 10)
    if (y2 < 100) y2 = 2000 + y2
    const cur = new Date(`${y1}-08-01T00:00:00Z`)
    const end = new Date(`${y2}-04-30T00:00:00Z`)
    for (; cur <= end; cur.setUTCDate(cur.getUTCDate() + 1)) {
      const day = cur.toISOString().slice(0, 10)
      if (derbyDateBlocked(day, anchors, boundary)) set.add(day)
    }
    return set
  }

  // ── Item 3: home-proposal health (revalidation) ──────────────────────────
  // A pending home_slot_pick proposal can silently rot after it was made: the
  // slot gets booked by another opponent, blocked, hit by a hall closure, lands
  // too close to a newly-confirmed game, or falls before a confirmed derby. This
  // re-validates every pending home proposal against the LIVE state (read-only),
  // mirroring the confirm-home guards that bite day to day: taken / team event /
  // team block / hall closure / gap (too close) / derby / Döltschi cap + date.
  // The rarer Saturday-cap and cross-team races stay enforced HARD at confirm
  // time, so a stale "valid" here can never become a bad booking. `reason` is a
  // short code the admin UI maps to a localised label.
  async function homeProposalHealth(seasonId) {
    const bookings = await database('game_scheduling_bookings as b')
      .join('game_scheduling_opponents as o', 'o.id', 'b.opponent')
      .where('b.season', seasonId)
      .where('b.type', 'home_slot_pick')
      .where('b.status', 'pending')
      .select(
        'b.id as booking_id', 'b.opponent as opponent_id', 'b.svrz_game_id',
        'b.proposed_slot_1', 'b.proposed_slot_2', 'b.proposed_slot_3',
        'o.kscw_team', 'o.club_name', 'o.team_name',
      )
    if (!bookings.length) return []

    const seasonRow = await database('game_scheduling_seasons').where('id', seasonId).first()
    const gaps = await seasonGaps(seasonId)
    const boundary = rueckrundeStart(seasonRow)
    const doltschiHallIds = await database('halls')
      .whereRaw("LOWER(name) LIKE '%döltschi%' OR LOWER(name) LIKE '%doltschi%'").pluck('id')

    // Every slot referenced by any proposal (one fetch).
    const slotIds = [...new Set(bookings.flatMap((b) =>
      [b.proposed_slot_1, b.proposed_slot_2, b.proposed_slot_3]).filter(Boolean))]
    const slotRows = slotIds.length
      ? await database('game_scheduling_slots').whereIn('id', slotIds).select('*')
      : []
    const slotById = new Map(slotRows.map((s) => [s.id, s]))

    // Closures (whole table; checked per slot in JS against hall + date range).
    const closureRows = await database('hall_closures')
      .select('hall', database.raw('start_date::text as s'), database.raw('end_date::text as e'))

    // Döltschi: club-wide booked DATES (one game per date) + the season count.
    let doltschiCount = 0
    const doltschiDates = new Set()
    if (doltschiHallIds.length) {
      const bookedD = await database('game_scheduling_slots')
        .where('season', seasonId).where('status', 'booked')
        .whereIn('hall', doltschiHallIds).select(database.raw('date::text as d'))
      doltschiCount = bookedD.length
      for (const r of bookedD) doltschiDates.add(String(r.d).slice(0, 10))
    }

    const expandDays = (s, e) => {
      const out = []
      if (!s) return out
      const start = new Date(`${String(s).slice(0, 10)}T00:00:00Z`)
      const end = e ? new Date(`${String(e).slice(0, 10)}T00:00:00Z`) : start
      for (let d = new Date(start), g = 0; d <= end && g < 400; d.setUTCDate(d.getUTCDate() + 1), g++) {
        out.push(d.toISOString().slice(0, 10))
      }
      return out
    }

    // Per-team caches (a season has few teams; many opponents reuse them).
    const teamCache = new Map()
    const getTeamCtx = async (teamId) => {
      if (teamCache.has(teamId)) return teamCache.get(teamId)
      const committedHome = await committedGameDates(teamId, gaps.home)
      const committedProposal3 = await committedGameDates(teamId, gaps.proposal3)
      const derbyAnchors = await confirmedDerbyAnchors(teamId, seasonId, boundary)
      const eventRows = await database('events as e')
        .join('events_teams as et', 'et.events_id', 'e.id')
        .where('et.teams_id', teamId)
        .select(
          database.raw("(e.start_date AT TIME ZONE 'Europe/Zurich')::date::text as s"),
          database.raw("(COALESCE(e.end_date, e.start_date) AT TIME ZONE 'Europe/Zurich')::date::text as e"),
        )
      const eventDates = new Set(eventRows.flatMap((r) => expandDays(r.s, r.e)))
      const blockRows = await database('scheduling_blocks')
        .where('team', teamId)
        .select(database.raw('start_date::text as s'), database.raw('end_date::text as e'))
      const blockDates = new Set(blockRows.flatMap((r) => expandDays(r.s, r.e)))

      // Saturday cap (A1/A4) — how many Saturday home games this team may have and
      // which Saturdays it already uses.
      const teamRow = await database('teams').where('id', teamId).first('id', 'name')
      const satCap = await teamSaturdayCap(teamRow)
      const satDates = await committedSaturdayDates(teamId)

      // Cross-team (C1): exact dates any team sharing a person with this one is
      // already committed to — those days are blocked for this team too.
      const sharedTeams = await sharedPlayerTeams(teamId)
      const sharedCommitted = new Set()
      if (sharedTeams.length) {
        ;(await database('games').whereIn('kscw_team', sharedTeams).whereNotNull('date')
          .select(database.raw('date::text as d'))).forEach((r) => sharedCommitted.add(String(r.d).slice(0, 10)))
        ;(await database('game_scheduling_slots').whereIn('kscw_team', sharedTeams).where('status', 'booked')
          .select(database.raw('date::text as d'))).forEach((r) => sharedCommitted.add(String(r.d).slice(0, 10)))
        ;(await database('game_scheduling_bookings as bk')
          .join('game_scheduling_opponents as o', 'o.id', 'bk.opponent')
          .whereIn('o.kscw_team', sharedTeams).where('bk.type', 'away_proposal').where('bk.status', 'confirmed')
          .select('bk.confirmed_proposal as n', database.raw('bk.proposed_datetime_1::text as d1'), database.raw('bk.proposed_datetime_2::text as d2'), database.raw('bk.proposed_datetime_3::text as d3')))
          .forEach((r) => { const d = r[`d${r.n}`]; if (d) sharedCommitted.add(String(d).slice(0, 10)) })
      }

      const ctx = { committedHome, committedProposal3, derbyAnchors, eventDates, blockDates, satCap, satDates, sharedCommitted }
      teamCache.set(teamId, ctx)
      return ctx
    }

    const validate = (ctx, slotId, n) => {
      const slot = slotById.get(slotId)
      if (!slot) return { valid: false, reason: 'taken' }
      if (slot.status !== 'available') return { valid: false, reason: 'taken' }
      const day = ymdOf(slot.date)
      if (ctx.eventDates.has(day)) return { valid: false, reason: 'team_event' }
      if (ctx.blockDates.has(day)) return { valid: false, reason: 'team_block' }
      if (closureRows.some((c) => c.hall === slot.hall
        && day >= String(c.s).slice(0, 10) && day <= String(c.e).slice(0, 10))) {
        return { valid: false, reason: 'hall_closed' }
      }
      if (derbyDateBlocked(day, ctx.derbyAnchors, boundary)) return { valid: false, reason: 'derby' }
      if (ctx.sharedCommitted.has(day)) return { valid: false, reason: 'cross_team' }
      const gapSet = n < 3 ? ctx.committedHome : ctx.committedProposal3
      if (gapSet.has(day)) return { valid: false, reason: 'too_close' }
      if (isSaturday(day) && !ctx.satDates.has(day) && ctx.satDates.size >= ctx.satCap) {
        return { valid: false, reason: 'saturday_cap' }
      }
      if (doltschiHallIds.includes(slot.hall)) {
        if (doltschiCount >= 10) return { valid: false, reason: 'doltschi_cap' }
        if (doltschiDates.has(day)) return { valid: false, reason: 'doltschi_taken' }
      }
      return { valid: true, reason: null }
    }

    const out = []
    for (const b of bookings) {
      const ctx = await getTeamCtx(b.kscw_team)
      const proposals = []
      for (const n of [1, 2, 3]) {
        const sid = b[`proposed_slot_${n}`]
        if (sid == null) continue
        const v = validate(ctx, sid, n)
        proposals.push({ num: n, slot_id: sid, valid: v.valid, reason: v.reason })
      }
      const aliveCount = proposals.filter((p) => p.valid).length
      out.push({
        booking_id: b.booking_id,
        opponent_id: b.opponent_id,
        svrz_game_id: b.svrz_game_id || null,
        opponent_label: b.team_name || b.club_name || '',
        kscw_team: b.kscw_team,
        proposals,
        alive_count: aliveCount,
        all_dead: proposals.length > 0 && aliveCount === 0,
      })
    }
    return out
  }

  // GET /kscw/terminplanung/team-calendar/:teamId — read-only schedule for one
  // team, visible to ANY authenticated member (the team page is open to all
  // logged-in users). Reads via knex (bypasses item permissions) and returns
  // ONLY the fields the calendar needs — never the opponent's contact name,
  // contact email, invite token, or admin notes. Mirrors the active-season
  // pick the frontend makes (status='open', else most recent).
  router.get('/terminplanung/team-calendar/:teamId', async (req, res) => {
    try {
      if (!req.accountability?.user && !req.accountability?.admin) {
        return res.status(401).json({ error: 'Authentication required' })
      }
      const teamId = Number(req.params.teamId)
      if (!Number.isFinite(teamId)) return res.status(400).json({ error: 'Invalid team' })

      const seasons = await database('game_scheduling_seasons')
        .select('id', 'season', 'status', 'spielsamstage')
        .orderBy('date_created', 'desc')
      const season = seasons.find((s) => s.status === 'open') || seasons[0] || null
      if (!season) return res.json({ season: null, slots: [], bookings: [] })

      const slots = await database('game_scheduling_slots')
        .where({ season: season.id, kscw_team: teamId })
        .select(
          'id', database.raw('date::text as date'), 'start_time', 'end_time',
          'status', 'source', 'hall', 'kscw_team', 'booking',
        )
        .orderBy('date', 'asc')

      // Opponents of this team → their bookings. Only safe label fields are
      // selected; contact_email / contact_name / token are never read here.
      const opponents = await database('game_scheduling_opponents')
        .where({ season: season.id, kscw_team: teamId })
        .select('id', 'kscw_team', 'club_name', 'team_name')
      const oppById = new Map(opponents.map((o) => [o.id, o]))
      const oppIds = opponents.map((o) => o.id)

      let bookings = []
      if (oppIds.length) {
        const rows = await database('game_scheduling_bookings')
          .where('season', season.id)
          .whereIn('opponent', oppIds)
          .select(
            'id', 'type', 'status', 'opponent', 'slot', 'confirmed_proposal',
            database.raw('proposed_datetime_1::text as proposed_datetime_1'),
            database.raw('proposed_datetime_2::text as proposed_datetime_2'),
            database.raw('proposed_datetime_3::text as proposed_datetime_3'),
            'proposed_slot_1', 'proposed_slot_2', 'proposed_slot_3',
          )
        bookings = rows.map((b) => ({ ...b, opponent: oppById.get(b.opponent) || null }))
      }

      return res.json({ season, slots, bookings })
    } catch (err) {
      log.error({ msg: `team-calendar: ${err.message}`, endpoint: 'terminplanung/team-calendar', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      return res.status(500).json({ error: 'Failed to load team calendar' })
    }
  })

  // GET /kscw/terminplanung/slots/:token — view available slots
  router.get('/terminplanung/slots/:token', async (req, res) => {
    try {
      // Rate limit: max 60 token lookups per 15 min per IP. This is a read-only
      // lookup the opponent page re-fetches on EVERY action (initial load +
      // after propose-home / propose-away / save-note / language flips), so it
      // needs a far higher budget than the write routes (10–20). 10 was tripping
      // 429s during normal use/testing and for clubs behind shared NAT. Keyed on
      // cf-connecting-ip (real client IP), so still tight against token scraping.
      if (!rateLimit(tokenAttempts, req, 60, 15 * 60 * 1000)) {
        return res.status(429).json({ error: 'Too many requests. Try again later.' })
      }

      const opponent = await database('game_scheduling_opponents')
        .where('token', req.params.token)
        .whereIn('status', ['active', 'invited', 'viewed', 'booked'])
        .first()
      if (!opponent) return res.status(404).json({ error: 'Invalid or expired link' })
      // A booked opponent may always VIEW their confirmed schedule past expiry;
      // only block fresh proposals (the propose endpoints re-check expiry below).
      if (opponent.status !== 'booked' && opponent.expires_at && new Date() > new Date(opponent.expires_at)) {
        return res.status(400).json({ error: 'Link expired' })
      }

      // Status lifecycle: first view transitions invited → viewed
      if (opponent.status === 'invited') {
        const nowIso = new Date().toISOString()
        await database('game_scheduling_opponents')
          .where('id', opponent.id)
          .update({ status: 'viewed', first_viewed_at: nowIso })
        opponent.status = 'viewed'
        opponent.first_viewed_at = nowIso
      }

      // Games, booked home slots and confirmed away proposals — expanded by the
      // season's gap. Home slots use the home gap; away proposals use the
      // proposal gap (1-2) and the lenient proposal-3 gap.
      const gaps = await seasonGaps(opponent.season)
      // Include other opponents' held first-proposals (slot-1 / date-1 reserve the
      // date); exclude this opponent's own holds so their alternatives stay open.
      const held = { includeHeld: true, excludeOpponent: opponent.id }
      const committedHome = await committedGameDates(opponent.kscw_team, gaps.home, held)
      const committedProposal = await committedGameDates(opponent.kscw_team, gaps.proposal, held)
      const committedProposal3 = await committedGameDates(opponent.kscw_team, gaps.proposal3, held)

      // Intra-club derby clamp (Art. 27): once this team's derby dates are
      // confirmed, nothing may be offered/booked before the relevant derby date
      // within its half — neither a home slot nor an away date. `derbyBlocked` is
      // the materialised set of pre-derby dates, applied to home slots below and
      // merged into the away strict/loose sets further down.
      const seasonRow = await database('game_scheduling_seasons').where('id', opponent.season).first()
      const rueckStart = rueckrundeStart(seasonRow)
      const derbyAnchors = await confirmedDerbyAnchors(opponent.kscw_team, opponent.season, rueckStart)
      const derbyBlocked = buildDerbyBlockedSet(derbyAnchors, rueckStart, seasonRow)

      // Döltschi rules: the club may schedule at most DOLTSCHI_SEASON_CAP games in
      // Döltschi per season (club-wide), and a Döltschi DATE counts as ONE slot —
      // irrespective of the time (19:00 / 20:30) or which hall (Döltschi 1 or 2).
      // So only one Döltschi game per date, club-wide. From booked Döltschi slots.
      const DOLTSCHI_SEASON_CAP = 10
      const doltschiHallIds = await database('halls')
        .whereRaw("LOWER(name) LIKE '%döltschi%' OR LOWER(name) LIKE '%doltschi%'").pluck('id')
      const isDoltschiHall = (h) => h != null && doltschiHallIds.includes(h)
      let doltschiFull = false
      const doltschiTakenDates = new Set() // 'YYYY-MM-DD' already booked in Döltschi (any time/hall)
      if (doltschiHallIds.length) {
        const bookedDoltschi = await database('game_scheduling_slots')
          .where('season', opponent.season).where('status', 'booked')
          .whereIn('hall', doltschiHallIds)
          .select(database.raw('date::text as d'))
        doltschiFull = bookedDoltschi.length >= DOLTSCHI_SEASON_CAP
        for (const r of bookedDoltschi) {
          doltschiTakenDates.add(String(r.d).slice(0, 10))
        }
      }
      // Offer at most one Döltschi slot per DATE (time + hall 1/2 irrelevant).
      const offeredDoltschiDates = new Set()

      // Exclude slots whose date falls within any event linked to this team
      // (single-day or multi-day) — e.g. tournament weekend, team trip. Filter
      // at read time (not generation) so events added after slot generation
      // are respected without regenerating. Applies even on Spielsamstage.
      const slotRows = await database('game_scheduling_slots')
        .where('kscw_team', opponent.kscw_team)
        // Only offer available slots — a booked KWI A drops out so KWI B shows alone.
        .where('status', 'available')
        .whereNotExists(function () {
          this.select(database.raw('1'))
            .from('events as e')
            .join('events_teams as et', 'et.events_id', 'e.id')
            .whereRaw('et.teams_id = ?', [opponent.kscw_team])
            .whereRaw(
              'game_scheduling_slots.date BETWEEN ' +
              "(e.start_date AT TIME ZONE 'Europe/Zurich')::date " +
              "AND (COALESCE(e.end_date, e.start_date) AT TIME ZONE 'Europe/Zurich')::date"
            )
        })
        // Team blocking (migration 085) — a hard block on every proposal, like an
        // event. Dates are plain `date` columns so no TZ conversion needed.
        .whereNotExists(function () {
          this.select(database.raw('1'))
            .from('scheduling_blocks as sb')
            .whereRaw('sb.team = ?', [opponent.kscw_team])
            .whereRaw('game_scheduling_slots.date BETWEEN sb.start_date AND sb.end_date')
        })
        // Hall closures (e.g. gcal-synced Hallen-geschlossen / external hall use)
        // block HOME slots whose own hall is closed that day — you can't host
        // there. HOME-ONLY on purpose: away games are at the opponent's hall, so
        // a KWI closure must NOT block away proposals (the away sets below never
        // read hall_closures).
        .whereNotExists(function () {
          this.select(database.raw('1'))
            .from('hall_closures as hc')
            .whereRaw('hc.hall = game_scheduling_slots.hall')
            .whereRaw('game_scheduling_slots.date BETWEEN hc.start_date AND hc.end_date')
        })
        // Games / booked slots / confirmed proposals are filtered in JS below via
        // the committed sets. Per-slot absent-player count is kept as a COLUMN
        // (not a hard filter) so the tiering below can offer absence-laden slots
        // only as the lenient 3rd pick — mirrors the away strict/loose split.
        // (one-off blocking absences affecting games; guests + weekly don't count)
        .select('game_scheduling_slots.*', database.raw(
          '(SELECT count(DISTINCT a.member) FROM absences a ' +
          'JOIN member_teams mt ON mt.member = a.member ' +
          'WHERE mt.team = ? AND (mt.guest_level = 0 OR mt.guest_level IS NULL) ' +
          "AND a.type IS DISTINCT FROM 'weekly' " +
          'AND a.blocking IS NOT FALSE ' +
          'AND a.start_date::date <= game_scheduling_slots.date AND a.end_date::date >= game_scheduling_slots.date ' +
          "AND (a.affects::jsonb @> '\"all\"' OR a.affects::jsonb @> '\"games\"')) as abs_count",
          [opponent.kscw_team],
        ))
        .orderBy('date')

      // Shape the raw slot rows into the SlotData the opponent UI expects:
      // hall_name (rows only carry the hall id), date as yyyy-MM-dd (pg returns
      // a Date/ISO — use local getters so it isn't shifted a day by TZ), HH:MM.
      const hallNameById = {}
      ;(await database('halls').select('id', 'name')).forEach((h) => { hallNameById[h.id] = h.name })
      const ymd = (v) => {
        if (typeof v === 'string') return v.slice(0, 10)
        const d = new Date(v)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      }
      const team = await database('teams').where('id', opponent.kscw_team).first()
      const isJr = isJuniorTeam(team?.name)
      // Junior Sunday priority: a Sunday on a Spielsamstag weekend ranks above a
      // standalone Sunday. seasonRow (fetched above for the derby clamp) holds the
      // Spielsamstag dates that tell them apart.
      const spielsamstagDates = new Set(
        (Array.isArray(seasonRow?.spielsamstage)
          ? seasonRow.spielsamstage
          : (() => { try { return JSON.parse(seasonRow?.spielsamstage || '[]') } catch { return [] } })())
          .map((x) => String(x?.date || '').slice(0, 10)).filter(Boolean),
      )
      const isSpielsamstagWeekendSunday = (date) => {
        const sat = new Date(`${date}T00:00:00Z`)
        sat.setUTCDate(sat.getUTCDate() - 1)
        return spielsamstagDates.has(sat.toISOString().slice(0, 10))
      }
      // Two-tier home slots: a slot is OFFERED if it clears the LOOSE bar
      // (proposal-3 gap + <3 absences). `strict` marks the stricter bar (home
      // gap + 0 absences) required for home picks 1 & 2; pick 3 may use any
      // offered slot. Mirrors the away strict/loose split.
      const slots = slotRows
        .map((s) => {
          const date = ymd(s.date)
          const absCount = Number(s.abs_count || 0)
          if (committedProposal3.has(date) || absCount >= 3) return null
          if (derbyBlocked.has(date)) return null  // before the derby in this half (Art. 27)
          const startHM = String(s.start_time).slice(0, 5)
          if (isDoltschiHall(s.hall)) {
            // Döltschi: drop if the season cap is reached, this date is already
            // booked in Döltschi, or we've already offered this date — one Döltschi
            // game per date (time + hall 1/2 irrelevant).
            if (doltschiFull || doltschiTakenDates.has(date) || offeredDoltschiDates.has(date)) return null
            offeredDoltschiDates.add(date)
          }
          return {
            id: s.id,
            date,
            start_time: startHM,
            end_time: String(s.end_time).slice(0, 5),
            source: s.source,
            hall_id: s.hall,
            hall_name: hallNameById[s.hall] || '',
            // Juniors: the Friday Spielhalle pool AND Sundays are last-resort —
            // never strict, so they can only be the 3rd (lenient) home pick.
            // Picks 1 & 2 take the own slot / Spielsamstag / Döltschi; pick 3
            // then prefers Friday Spielhalle, then Sundays (front-end tiering).
            strict: !committedHome.has(date) && absCount === 0 && !(isJr && (isSunday(date) || s.source === 'spielhalle')),
          }
        })
        .filter(Boolean)

      const bookings = await database('game_scheduling_bookings')
        .where('opponent', opponent.id)
        .select('*')

      // Attach the chosen home slot's date/time/hall so the opponent sees the
      // decided home game (the slot itself is no longer in the available list).
      for (const b of bookings) {
        if (b.type === 'home_slot_pick' && b.slot) {
          const sl = await database('game_scheduling_slots').where('id', b.slot).first()
          if (sl) {
            b.slot_date = ymd(sl.date)
            b.slot_start = String(sl.start_time).slice(0, 5)
            b.slot_end = String(sl.end_time).slice(0, 5)
            b.slot_hall_name = hallNameById[sl.hall] || ''
          }
        }
        // Pending home proposal: resolve the up-to-3 proposed slots so the
        // opponent sees what they proposed + whether each is still available.
        if (b.type === 'home_slot_pick' && b.status === 'pending') {
          const ids = [b.proposed_slot_1, b.proposed_slot_2, b.proposed_slot_3].filter((x) => x != null)
          const sls = ids.length ? await database('game_scheduling_slots').whereIn('id', ids).select('*') : []
          const byId = new Map(sls.map((x) => [x.id, x]))
          b.proposed_slots = ids.map((id) => {
            const sl = byId.get(id)
            if (!sl) return { slot_id: id, available: false }
            return {
              slot_id: id,
              date: ymd(sl.date),
              start: String(sl.start_time).slice(0, 5),
              end: String(sl.end_time).slice(0, 5),
              hall_name: hallNameById[sl.hall] || '',
              available: sl.status === 'available',
            }
          })
        }
      }

      // Blocked away-proposal dates for this team — team events, games (±1 day)
      // and one-off PLAYER absences (guests + weekly unavailabilities don't
      // count). The opponent's calendar greys these out (mirrors the
      // propose-away rejection below).
      // Conflict dates for away proposals. Events are HARD blocks on every
      // proposal. Games / booked slots / confirmed proposals are gap-expanded:
      // proposals 1 & 2 use the proposal gap, proposal 3 the (smaller) proposal-3
      // gap. Absences are graded: proposals 1 & 2 reject ANY player absence;
      // proposal 3 rejects only 3+ absent. So expose two sets — strict (events ∪
      // proposal-gap games ∪ any-absence) and loose (events ∪ proposal3-gap games
      // ∪ 3+-absence).
      const eventSet = new Set()
      const addRange = (s, e) => {
        if (!s) return
        const d = new Date(`${s}T00:00:00Z`)
        const end = new Date(`${e || s}T00:00:00Z`)
        for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) eventSet.add(d.toISOString().slice(0, 10))
      }
      const evRows = await database('events as e')
        .join('events_teams as et', 'et.events_id', 'e.id')
        .where('et.teams_id', opponent.kscw_team)
        .select(
          database.raw("(e.start_date AT TIME ZONE 'Europe/Zurich')::date::text as s"),
          database.raw("(COALESCE(e.end_date, e.start_date) AT TIME ZONE 'Europe/Zurich')::date::text as e"),
        )
      evRows.forEach((r) => addRange(r.s, r.e))
      // Team blocking (migration 085) — merged into eventSet so it lands in BOTH
      // strictSet and looseSet: a hard block on away proposals 1, 2 AND 3.
      const blockRows = await database('scheduling_blocks')
        .where('team', opponent.kscw_team)
        .select(database.raw('start_date::text as s'), database.raw('end_date::text as e'))
      blockRows.forEach((r) => addRange(r.s, r.e))
      // Intra-club derby clamp — pre-derby dates hard-block every away proposal
      // too (merged into eventSet → lands in both strictSet and looseSet).
      for (const d of derbyBlocked) eventSet.add(d)
      const absRows = await database('absences as a')
        .join('member_teams as mt', 'mt.member', 'a.member')
        .where('mt.team', opponent.kscw_team)
        .where(function () { this.where('mt.guest_level', 0).orWhereNull('mt.guest_level') })
        .whereRaw("a.type IS DISTINCT FROM 'weekly'")
        .whereRaw('a.blocking IS NOT FALSE') // non-blocking absences (injury, maternity) don't block scheduling
        .whereRaw("(a.affects::jsonb @> '\"all\"' OR a.affects::jsonb @> '\"games\"')")
        .select(database.raw('a.member as member'), database.raw('a.start_date::text as s'), database.raw('a.end_date::text as e'))
      const absByDate = {}
      for (const r of absRows) {
        const d = new Date(`${r.s}T00:00:00Z`)
        const end = new Date(`${r.e || r.s}T00:00:00Z`)
        for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
          const k = d.toISOString().slice(0, 10)
          ;(absByDate[k] || (absByDate[k] = new Set())).add(r.member)
        }
      }
      const strictSet = new Set(eventSet)
      for (const d of committedProposal) strictSet.add(d)
      const looseSet = new Set(eventSet)
      for (const d of committedProposal3) looseSet.add(d)
      for (const [k, members] of Object.entries(absByDate)) {
        strictSet.add(k)                        // proposals 1 & 2: any absence
        if (members.size >= 3) looseSet.add(k)  // proposal 3: only 3+ absent
      }
      const blocked_away_strict = [...strictSet].sort()
      const blocked_away_loose = [...looseSet].sort()

      // SVRZ fixtures between this KSCW team and this opponent — one card per
      // fixture on the page (multi-game pairings get 2-3). Season-scoped +
      // our-side-checked, in the deterministic order bookings are keyed by.
      const svrzGames = await opponentSvrzFixtures(opponent)

      // Season window (Sep 1 → Mar 31) so the away calendar can bound itself.
      // (seasonRow already fetched above for the derby clamp.)
      let season_window = null
      const sm = String(seasonRow?.season || '').match(/(\d{4})\D+(\d{2,4})/)
      if (sm) {
        const y1 = parseInt(sm[1], 10)
        let y2 = parseInt(sm[2], 10)
        if (y2 < 100) y2 = 2000 + y2
        season_window = { start: `${y1}-09-01`, end: `${y2}-03-31` }
      }

      // Junior Sunday steer: a Sunday slot is "preferred" when it lands on a
      // Spielsamstag weekend (rule: Spielsamstag-weekend Sundays before other
      // Sundays) OR on a Sunday another junior team already plays a HOME game on
      // (cluster juniors onto shared Sundays). No hard block — Sundays stay
      // bookable, but only as the 3rd home pick (strict=false above).
      let slotsOut = slots
      if (isJr) {
        const juniorIds = await database('teams')
          .where('sport', 'volleyball').where('active', true)
          .whereRaw("name ~* 'u[0-9]'").whereNot('id', opponent.kscw_team).pluck('id')
        const usedJuniorSundays = new Set()
        if (juniorIds.length) {
          const bk = await database('game_scheduling_slots').whereIn('kscw_team', juniorIds)
            .where('status', 'booked').select(database.raw('date::text as d'))
          const hg = await database('games').whereIn('kscw_team', juniorIds).whereNotNull('date')
            .whereRaw("LOWER(home_team) LIKE 'ksc wiedikon%'").select(database.raw('date::text as d'))
          ;[...bk, ...hg].forEach((r) => { const d = String(r.d).slice(0, 10); if (isSunday(d)) usedJuniorSundays.add(d) })
        }
        slotsOut = slots.map((s) => ({
          ...s,
          preferred: s.source === 'spielsonntag' && (isSpielsamstagWeekendSunday(s.date) || usedJuniorSundays.has(s.date)),
        }))
      }

      res.json({
        opponent: {
          id: opponent.id,
          club_name: opponent.club_name || opponent.team_name || '',
          team_name: opponent.team_name || '',
          contact_name: opponent.contact_name || '',
          contact_email: opponent.contact_email || '',
          kscw_team_id: opponent.kscw_team,
          kscw_team_name: team?.name || '',
          home_game: opponent.home_game,
          away_game: opponent.away_game,
          source: opponent.source || 'self_registration',
          status: opponent.status || 'active',
          language: opponent.language || null,
          kscw_note: opponent.kscw_note || '',
          opponent_note: opponent.opponent_note || '',
        },
        games: svrzGames,
        slots: slotsOut,
        bookings,
        blocked_away_strict,
        blocked_away_loose,
        season_window,
      })
    } catch (err) {
      log.error({ msg: `terminplanung/slots: ${err.message}`, endpoint: 'terminplanung/slots', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /kscw/terminplanung/propose-home/:token — propose exactly 3 home slots
  // (opponent picks slots in OUR hall; the spielplaner confirms one). Mirrors
  // propose-away. Slots are NOT reserved on proposal — only the confirmed one
  // books the slot, so two opponents may propose the same slot (admin arbitrates;
  // the opponent + admin are warned a proposed slot might not be available).
  router.post('/terminplanung/propose-home/:token', async (req, res) => {
    try {
      if (!rateLimit(writeAttempts, req, 10, 15 * 60 * 1000)) {
        return res.status(429).json({ error: 'Too many requests. Try again later.' })
      }

      const opponent = await database('game_scheduling_opponents')
        .where('token', req.params.token)
        .whereIn('status', ['active', 'invited', 'viewed', 'booked'])
        .first()
      if (!opponent) return res.status(404).json({ error: 'Invalid link' })
      if (opponent.expires_at && new Date() > new Date(opponent.expires_at)) {
        return res.status(400).json({ error: 'Link expired' })
      }

      // Remember the language the opponent is acting in (for emails).
      const lang = VALID_LANGS.includes(String(req.body?.language || '').toLowerCase()) ? String(req.body.language).toLowerCase() : null
      if (lang) {
        await database('game_scheduling_opponents').where('id', opponent.id).update({ language: lang })
        opponent.language = lang
      }

      const ids = Array.isArray(req.body?.slot_ids) ? req.body.slot_ids.map((x) => Number(x)) : []
      if (ids.length !== 3 || ids.some((x) => !Number.isInteger(x) || x <= 0)) {
        return res.status(400).json({ error: 'exactly 3 slot_ids required' })
      }
      if (new Set(ids).size !== 3) {
        return res.status(400).json({ error: 'slot_ids must be distinct' })
      }

      // Multi-game: which fixture of this pairing the picks are for. Absent
      // svrz_game_id targets the first home fixture (legacy clients).
      const fixtures = await opponentSvrzFixtures(opponent)
      const target = resolveTargetFixture(fixtures, true, req.body?.svrz_game_id || null)
      if (!target) return res.status(400).json({ error: 'Invalid game for this opponent' })
      // The same opponent's OTHER home games: their picks must not collide —
      // each fixture needs its own 3 distinct slots — and a fixture that's
      // already booked can't be re-proposed (the unique index would trip too).
      const allHome = await database('game_scheduling_bookings')
        .where({ opponent: opponent.id, type: 'home_slot_pick' })
        .orderBy('id').select('*')
      if (allHome.some((b) => bookingMatchesFixture(b, target) && b.status === 'confirmed')) {
        return res.status(400).json({ error: 'This game is already booked' })
      }
      const siblingSlotIds = new Set(
        allHome.filter((b) => !bookingMatchesFixture(b, target))
          .flatMap((b) => [b.proposed_slot_1, b.proposed_slot_2, b.proposed_slot_3, b.slot])
          .filter((v) => v != null).map((v) => Number(v)),
      )
      if (ids.some((x) => siblingSlotIds.has(x))) {
        return res.status(400).json({ error: 'A chosen slot is already proposed for another of your games — each game needs its own slots.' })
      }

      // Validate each proposed slot against its tier (picks 1-2 strict: home gap
      // + 0 absences; pick 3 lenient: proposal-3 gap + <3 absences), mirroring the
      // read-time list. Slots are not held.
      const gaps = await seasonGaps(opponent.season)
      const held = { includeHeld: true, excludeOpponent: opponent.id }
      const committedHome = await committedGameDates(opponent.kscw_team, gaps.home, held)
      const committedProposal3 = await committedGameDates(opponent.kscw_team, gaps.proposal3, held)
      const toYmd = (v) => (typeof v === 'string' ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10))
      const homeTeam = await database('teams').where('id', opponent.kscw_team).first()
      const homeIsJr = isJuniorTeam(homeTeam?.name)
      // Intra-club derby clamp (Art. 27): a stale page must not submit a slot
      // before this team's confirmed derby date within its half.
      const homeSeasonRow = await database('game_scheduling_seasons').where('id', opponent.season).first()
      const homeRueckStart = rueckrundeStart(homeSeasonRow)
      const homeDerbyAnchors = await confirmedDerbyAnchors(opponent.kscw_team, opponent.season, homeRueckStart)

      for (let i = 0; i < 3; i++) {
        const slot = await database('game_scheduling_slots').where('id', ids[i]).first()
        if (!slot || slot.kscw_team !== opponent.kscw_team) {
          return res.status(400).json({ error: `Slot ${i + 1} is invalid` })
        }
        if (slot.status !== 'available') {
          return res.status(400).json({ error: `Slot ${i + 1} is no longer available — please pick another.` })
        }
        const day = toYmd(slot.date)
        // Juniors: the Friday Spielhalle pool and Sundays are last-resort — only
        // allowed as the 3rd pick (picks 1 & 2 = own slot / Spielsamstag / Döltschi).
        if (homeIsJr && i < 2 && (isSunday(day) || slot.source === 'spielhalle')) {
          return res.status(400).json({ error: `Slot ${i + 1} must be the own slot, Spielsamstag or Döltschi — Friday Spielhalle and Sundays are only allowed as your 3rd choice.` })
        }
        const eventCover = await database('events as e')
          .join('events_teams as et', 'et.events_id', 'e.id')
          .where('et.teams_id', opponent.kscw_team)
          .whereRaw("?::date BETWEEN (e.start_date AT TIME ZONE 'Europe/Zurich')::date AND (COALESCE(e.end_date, e.start_date) AT TIME ZONE 'Europe/Zurich')::date", [day])
          .first()
        if (eventCover) return res.status(400).json({ error: `Slot ${i + 1} falls on a team event — please pick another.` })

        const blockCover = await database('scheduling_blocks')
          .where('team', opponent.kscw_team)
          .whereRaw('?::date BETWEEN start_date AND end_date', [day])
          .first()
        if (blockCover) return res.status(400).json({ error: `Slot ${i + 1} falls on a team block — please pick another.` })

        if (derbyDateBlocked(day, homeDerbyAnchors, homeRueckStart)) {
          return res.status(400).json({ error: `Slot ${i + 1} falls before the intra-club derby for this half — please pick another.` })
        }

        const absRow = await database('absences as a')
          .join('member_teams as mt', 'mt.member', 'a.member')
          .where('mt.team', opponent.kscw_team)
          .where(function () { this.where('mt.guest_level', 0).orWhereNull('mt.guest_level') })
          .whereRaw("a.type IS DISTINCT FROM 'weekly'")
          .whereRaw('a.blocking IS NOT FALSE')
          .whereRaw('a.start_date::date <= ?::date AND a.end_date::date >= ?::date', [day, day])
          .whereRaw("(a.affects::jsonb @> '\"all\"' OR a.affects::jsonb @> '\"games\"')")
          .countDistinct('a.member as c')
          .first()
        const absCount = Number(absRow?.c || 0)
        const gapSet = i < 2 ? committedHome : committedProposal3
        const absMax = i < 2 ? 0 : 2
        if (gapSet.has(day)) {
          return res.status(400).json({ error: `Slot ${i + 1} is too close to an existing game — please pick another.` })
        }
        if (absCount > absMax) {
          return res.status(400).json({ error: `Slot ${i + 1} has too many absent players — please pick another.` })
        }
      }

      // Replace any prior PENDING home proposal FOR THIS FIXTURE in place so the
      // booking id stays stable across re-proposals — a delete+insert mints a new
      // id, and an admin dashboard still holding the old id then 400s with
      // "Invalid booking" on confirm. Confirmed proposals + other fixtures'
      // bookings stay intact. The update also stamps svrz_game_id, upgrading a
      // legacy NULL row to its fixture.
      const priorHome = allHome
        .filter((b) => bookingMatchesFixture(b, target) && b.status === 'pending')
        .map((b) => b.id)
      if (priorHome.length > 0) {
        await database('game_scheduling_bookings').where('id', priorHome[0]).update({
          season: opponent.season,
          svrz_game_id: target.fixtureId,
          proposed_slot_1: ids[0],
          proposed_slot_2: ids[1],
          proposed_slot_3: ids[2],
          confirmed_proposal: null,
          slot: null,
        })
        if (priorHome.length > 1) {
          await database('game_scheduling_bookings').whereIn('id', priorHome.slice(1)).del()
        }
      } else {
        await database('game_scheduling_bookings').insert({
          opponent: opponent.id,
          season: opponent.season,
          type: 'home_slot_pick',
          status: 'pending',
          svrz_game_id: target.fixtureId,
          proposed_slot_1: ids[0],
          proposed_slot_2: ids[1],
          proposed_slot_3: ids[2],
        })
      }

      await database('game_scheduling_opponents')
        .where('id', opponent.id)
        .whereIn('status', ['invited', 'viewed'])
        .update({ status: 'booked' })
      // Fresh proposals clear any pending "pick new slots" re-request flag.
      await database('game_scheduling_opponents')
        .where('id', opponent.id).update({ new_slots_requested_at: null })

      // Receipt to the opponent (their language) + KSCW notify. Best-effort.
      try {
        const team = await database('teams').where('id', opponent.kscw_team).first()
        const hallNameById = {}
        ;(await database('halls').select('id', 'name')).forEach((h) => { hallNameById[h.id] = h.name })
        const kscw = `KSCW ${team?.name || ''}`.trim()
        const opp = opponent.club_name || opponent.team_name || ''
        const slotsFull = await database('game_scheduling_slots').whereIn('id', ids).select('*')
        const byId = new Map(slotsFull.map((s) => [s.id, s]))
        // Structured rows for HTML info cards + parallel plain-text lines.
        const slotRowsMail = ids.map((id) => {
          const s = byId.get(id)
          if (!s) return null
          const { date } = fmtDateMail(s.date)
          const hall = hallNameById[s.hall] || ''
          return { date, time: weekdayHomeTime(s.date, s.start_time), hall }
        }).filter(Boolean)
        const list = slotRowsMail.map((r) => `• ${r.date}, ${r.time}${r.hall ? `, ${r.hall}` : ''}`).join('\n')
        if (opponent.contact_email) {
          const { subject, text, html } = schedEmail(opponent.language, 'home_proposals_sent', {
            contact: opponent.contact_name || '', kscw, opp, list, slots: slotRowsMail,
          })
          await sendSchedulingMail(opponent.contact_email, subject, text, null, html)
        }
        const adminText = `${opp} hat Heimspiel-Slots vorgeschlagen (${kscw}):\n${list}\n\nBitte im Dashboard einen bestätigen:\n${FRONTEND_URL}/admin/terminplanung/dashboard`
        const adminHtml = adminNotifyHtml({
          title: 'Heim-Slot-Vorschläge',
          lead: `${opp} hat Heimspiel-Slots vorgeschlagen (${kscw}):`,
          infoRows: slotRowsMail.map((r, i) => ({ label: `Slot ${i + 1}`, value: `${r.date}, ${r.time}${r.hall ? `, ${r.hall}` : ''}` })),
          ctaText: 'Bitte im Dashboard einen Slot bestätigen.',
          ctaUrl: `${FRONTEND_URL}/admin/terminplanung/dashboard`,
        })
        await sendSchedulingMail(SCHEDULING_REPLY_TO, `Heim-Slot-Vorschläge – ${opp} (${kscw})`, adminText, null, adminHtml)
      } catch (mailErr) {
        log.warn(`propose-home email failed: ${mailErr.message}`)
      }

      res.json({ success: true, proposals_count: 3 })
    } catch (err) {
      log.error({ msg: `terminplanung/propose-home: ${err.message}`, endpoint: 'terminplanung/propose-home', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /kscw/terminplanung/admin/confirm-home — confirm one of an opponent's 3
  // proposed home slots. Body: { booking_id, proposal_number (1-3), admin_notes? }.
  // Mirrors confirm-away, but books a real slot: it applies the SAME locks the old
  // instant-book did (advisory lock + FOR UPDATE + availability + event + gap +
  // Saturday cap + cross-team), marks the chosen slot booked and copies it into
  // `slot`. Pick 3 (n===3) uses the lenient gap, mirroring how it was proposed.
  router.post('/terminplanung/admin/confirm-home', async (req, res) => {
    try {
      const { booking_id, proposal_number, admin_notes } = req.body || {}
      const n = Number(proposal_number)
      if (!booking_id || ![1, 2, 3].includes(n)) {
        return res.status(400).json({ error: 'booking_id and proposal_number (1-3) required' })
      }
      const booking = await database('game_scheduling_bookings').where('id', booking_id).first()
      if (!booking || booking.type !== 'home_slot_pick') {
        return res.status(400).json({ error: 'Invalid booking' })
      }
      // Only a pending proposal may be confirmed. Re-confirming a second proposal
      // of an already-confirmed booking would book a new slot while orphaning the
      // first one as `booked` forever — reject instead.
      if (booking.status !== 'pending') {
        return res.status(400).json({ error: 'This proposal is already confirmed' })
      }
      const slotId = booking[`proposed_slot_${n}`]
      if (!slotId) return res.status(400).json({ error: `Proposal ${n} is empty` })
      const opponent = await database('game_scheduling_opponents').where('id', booking.opponent).first()
      if (!opponent) return res.status(400).json({ error: 'Opponent not found' })
      if (!(await spielplanerCanManageTeam(req, opponent.kscw_team))) return res.status(403).json({ error: 'Not authorized for this team' })

      await database.transaction(async (trx) => {
        await trx.raw('SELECT pg_advisory_xact_lock(?, ?)', [GSCH_BOOK_LOCK_CLASS, opponent.kscw_team])
        const slot = await trx('game_scheduling_slots').where('id', slotId).forUpdate().first()
        if (!slot || slot.status === 'blocked' || slot.status === 'booked') {
          throw Object.assign(new Error('Slot is no longer available'), { httpStatus: 400 })
        }
        if (slot.kscw_team !== opponent.kscw_team) {
          throw Object.assign(new Error('Slot does not belong to this team'), { httpStatus: 400 })
        }
        const slotYmd = (typeof slot.date === 'string' ? slot.date : new Date(slot.date).toISOString()).slice(0, 10)

        const eventCover = await trx('events as e')
          .join('events_teams as et', 'et.events_id', 'e.id')
          .where('et.teams_id', opponent.kscw_team)
          .whereRaw("?::date BETWEEN (e.start_date AT TIME ZONE 'Europe/Zurich')::date AND (COALESCE(e.end_date, e.start_date) AT TIME ZONE 'Europe/Zurich')::date", [slot.date])
          .first()
        if (eventCover) throw Object.assign(new Error('Slot falls on a team event'), { httpStatus: 400 })

        const blockCover = await trx('scheduling_blocks')
          .where('team', opponent.kscw_team)
          .whereRaw('?::date BETWEEN start_date AND end_date', [slot.date])
          .first()
        if (blockCover) throw Object.assign(new Error('Slot falls on a team block'), { httpStatus: 400 })

        // Home-only: can't host in a hall that's closed that day (gcal closures etc).
        const closureCover = await trx('hall_closures')
          .where('hall', slot.hall)
          .whereRaw('?::date BETWEEN start_date AND end_date', [slot.date])
          .first()
        if (closureCover) throw Object.assign(new Error('Slot falls on a hall closure'), { httpStatus: 400 })

        // Intra-club derby clamp (Art. 27): nothing may be booked before this
        // team's confirmed derby date within its half. Mirrors offer-time + health.
        const derbySeasonRow = await trx('game_scheduling_seasons').where('id', opponent.season).first()
        const derbyRueckStart = rueckrundeStart(derbySeasonRow)
        const derbyAnchors = await confirmedDerbyAnchors(opponent.kscw_team, opponent.season, derbyRueckStart)
        if (derbyDateBlocked(slotYmd, derbyAnchors, derbyRueckStart)) {
          throw Object.assign(new Error('Slot falls before the intra-club derby for this half'), { httpStatus: 400 })
        }

        const gaps = await seasonGaps(opponent.season)
        const gap = n < 3 ? gaps.home : gaps.proposal3
        const committed = await committedGameDates(opponent.kscw_team, gap)
        if (committed.has(slotYmd)) throw Object.assign(new Error('Too close to another game for this team'), { httpStatus: 400 })

        // Döltschi: club-wide season cap (10) + one game per DATE there — a Döltschi
        // date is ONE slot regardless of the time (19:00 / 20:30) or hall (1 or 2).
        // Checked across all teams. (Admin confirms are sequential in practice; the
        // per-team advisory lock above doesn't serialise cross-team, but a stray
        // race is caught on the next confirm.)
        const doltschiHallIds = await trx('halls')
          .whereRaw("LOWER(name) LIKE '%döltschi%' OR LOWER(name) LIKE '%doltschi%'").pluck('id')
        if (doltschiHallIds.includes(slot.hall)) {
          const bookedD = await trx('game_scheduling_slots')
            .where('season', opponent.season).where('status', 'booked')
            .whereIn('hall', doltschiHallIds)
            .select(trx.raw('date::text as d'))
          if (bookedD.length >= 10) {
            throw Object.assign(new Error('Döltschi season limit (10 games) reached'), { httpStatus: 400 })
          }
          // One Döltschi game per date (time + hall 1/2 irrelevant).
          if (bookedD.some((r) => String(r.d).slice(0, 10) === slotYmd)) {
            throw Object.assign(new Error('Another game is already booked in Döltschi that day'), { httpStatus: 400 })
          }
        }

        const team = await trx('teams').where('id', opponent.kscw_team).first('id', 'name')
        if (isSaturday(slotYmd)) {
          const cap = await teamSaturdayCap(team, trx)
          const satDates = await committedSaturdayDates(team.id, trx)
          if (satDates.size + 1 > cap) throw Object.assign(new Error('Saturday home-game cap reached for this team'), { httpStatus: 400 })
        }
        const others = await sharedPlayerTeams(team.id, trx)
        const conflictTeams = await teamsCommittedOnDate(others, slotYmd, trx)
        if (conflictTeams.length) {
          const names = await trx('teams').whereIn('id', conflictTeams).pluck('name')
          throw Object.assign(new Error(`Cross-team conflict: ${names.join(', ')} already play that day`), { httpStatus: 400 })
        }

        await trx('game_scheduling_bookings').where('id', booking_id).update({
          status: 'confirmed',
          confirmed_proposal: n,
          slot: slotId,
          admin_notes: admin_notes || booking.admin_notes || null,
        })
        await trx('game_scheduling_slots').where('id', slotId).update({ status: 'booked' })
      })

      // Confirmation email to the opponent (their language) + mailbox notice.
      try {
        const slot = await database('game_scheduling_slots').where('id', slotId).first()
        const team = await database('teams').where('id', opponent.kscw_team).first()
        const hall = slot?.hall ? await database('halls').where('id', slot.hall).first() : null
        const { date } = fmtDateMail(slot?.date)
        const timeRange = weekdayHomeTime(slot?.date, slot?.start_time)
        const kscw = `KSCW ${team?.name || ''}`.trim()
        const opp = opponent.club_name || opponent.team_name || ''
        if (opponent.contact_email) {
          const { subject, text, html } = schedEmail(opponent.language, 'home_booked', {
            contact: opponent.contact_name || '', kscw, opp, date, time: timeRange, hall: hall?.name || '',
          })
          await sendSchedulingMail(opponent.contact_email, subject, text, null, html)
        }
        const adminText = `Heimspiel bestätigt:\n\n${kscw} (Heim) vs ${opp}\n${date}, ${timeRange} Uhr${hall?.name ? `, ${hall.name}` : ''}.`
        const adminHtml = adminNotifyHtml({
          title: 'Heimspiel bestätigt',
          lead: `${kscw} (Heim) vs ${opp}`,
          infoRows: [
            { label: 'Spiel', value: `${kscw} (Heim) vs ${opp}` },
            { label: 'Datum', value: date, halfWidth: true },
            { label: 'Zeit', value: timeRange, halfWidth: true },
            ...(hall?.name ? [{ label: 'Halle', value: hall.name }] : []),
          ],
        })
        await sendSchedulingMail(SCHEDULING_REPLY_TO, `Heimspiel bestätigt – ${opp} (${kscw})`, adminText, null, adminHtml)
      } catch (mailErr) {
        log.warn(`confirm-home email failed: ${mailErr.message}`)
      }

      // Push the confirmed date/time/hall into VolleyManager (best-effort). A
      // fixture-keyed booking pushes to exactly that VM game — no needs_pick
      // ambiguity when the pairing has several home fixtures.
      try {
        await database('game_scheduling_bookings').where('id', booking_id).update({ vm_push_status: 'queued', vm_push_error: null })
        await spawnVmPush(booking_id, { svrzId: booking.svrz_game_id || null })
      } catch (pushErr) {
        log.warn(`confirm-home VM push enqueue failed: ${pushErr.message}`)
      }

      res.json({ success: true, confirmed_proposal: n })
    } catch (err) {
      if (err && err.httpStatus) {
        return res.status(err.httpStatus).json({ error: err.message })
      }
      log.error({ msg: `confirm-home: ${err.message}`, endpoint: 'terminplanung/admin/confirm-home', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /kscw/terminplanung/propose-away/:token — propose 3 away dates
  router.post('/terminplanung/propose-away/:token', async (req, res) => {
    try {
      // Rate limit: max 10 proposal attempts per 15 min per IP
      if (!rateLimit(writeAttempts, req, 10, 15 * 60 * 1000)) {
        return res.status(429).json({ error: 'Too many requests. Try again later.' })
      }

      const opponent = await database('game_scheduling_opponents')
        .where('token', req.params.token)
        .whereIn('status', ['active', 'invited', 'viewed', 'booked'])
        .first()
      if (!opponent) return res.status(404).json({ error: 'Invalid link' })
      if (opponent.expires_at && new Date() > new Date(opponent.expires_at)) {
        return res.status(400).json({ error: 'Link expired' })
      }

      // Remember the language the opponent is acting in (for emails).
      const lang = VALID_LANGS.includes(String(req.body?.language || '').toLowerCase()) ? String(req.body.language).toLowerCase() : null
      if (lang) {
        await database('game_scheduling_opponents').where('id', opponent.id).update({ language: lang })
        opponent.language = lang
      }

      const { proposals } = req.body
      if (!Array.isArray(proposals) || proposals.length === 0 || proposals.length > 3) {
        return res.status(400).json({ error: '1-3 proposals required' })
      }

      // Multi-game: which away fixture of this pairing the proposals are for.
      // Absent svrz_game_id targets the first away fixture (legacy clients).
      const fixtures = await opponentSvrzFixtures(opponent)
      const target = resolveTargetFixture(fixtures, false, req.body?.svrz_game_id || null)
      if (!target) return res.status(400).json({ error: 'Invalid game for this opponent' })
      const allAway = await database('game_scheduling_bookings')
        .where({ opponent: opponent.id, type: 'away_proposal' })
        .orderBy('id').select('*')
      if (allAway.some((b) => bookingMatchesFixture(b, target) && b.status === 'confirmed')) {
        return res.status(400).json({ error: 'This game is already confirmed' })
      }

      // Schema stores up to 3 proposals as parallel columns on a single booking row
      const row = {
        opponent: opponent.id,
        // Without season the admin dashboard never sees the proposal — it filters
        // bookings by season, so a null-season row is silently dropped (opponent
        // submits, admin sees "Pending" forever). opponent.season is the season id,
        // the same value the home booking copies from slot.season.
        season: opponent.season,
        type: 'away_proposal',
        status: 'pending',
        svrz_game_id: target.fixtureId,
      }
      // 2026-05-12 audit #22: validate date/time/location before storing or
      // later emailing. Token-flow rate-limit + auth are intact, but garbage
      // data lands in admin UI + outbound emails (HTML-rendered). Return a
      // proper 400 with the message (was throwing into the generic 500 catch).
      const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
      const TIME_RE = /^\d{2}:\d{2}(?::\d{2})?$/

      const team = await database('teams').where('id', opponent.kscw_team).first('id', 'name')
      const isJunior = isJuniorTeam(team?.name)

      // A3 — for non-junior teams, the away proposals may include at most one
      // Saturday and no Sunday (hard reject). Juniors are exempt. Malformed dates
      // are caught per-proposal in the loop below.
      if (!isJunior) {
        const validDates = proposals.filter((p) => p?.date && DATE_RE.test(String(p.date)))
        if (validDates.some((p) => isSunday(p.date))) {
          return res.status(400).json({ error: 'away_no_sunday' })
        }
        if (validDates.filter((p) => isSaturday(p.date)).length > 1) {
          return res.status(400).json({ error: 'away_max_one_saturday' })
        }
      }

      // C1 cross-team — teams sharing players with this one must not already play
      // on a proposed date (checked per proposal in the loop). Applies to juniors
      // too — it's player-driven, not team-type-driven.
      const sharedTeams = await sharedPlayerTeams(opponent.kscw_team)

      // Games / booked home slots / confirmed away proposals — a new proposal
      // can't land within the gap of any of them. Proposals 1-2 use the proposal
      // gap; proposal 3 the (smaller) proposal-3 gap (mirrors the strict/loose
      // sets the calendar greys with).
      const proposalGaps = await seasonGaps(opponent.season)
      const held = { includeHeld: true, excludeOpponent: opponent.id }
      const committedStrict = await committedGameDates(opponent.kscw_team, proposalGaps.proposal, held)
      const committedLoose = await committedGameDates(opponent.kscw_team, proposalGaps.proposal3, held)
      // Intra-club derby clamp (Art. 27): reject any away date before this team's
      // confirmed derby date within its half.
      const awaySeasonRow = await database('game_scheduling_seasons').where('id', opponent.season).first()
      const awayRueckStart = rueckrundeStart(awaySeasonRow)
      const awayDerbyAnchors = await confirmedDerbyAnchors(opponent.kscw_team, opponent.season, awayRueckStart)
      for (let i = 0; i < proposals.length; i++) {
        const p = proposals[i]
        if (!p.date || !DATE_RE.test(String(p.date))) {
          return res.status(400).json({ error: 'Each proposal needs a valid date (YYYY-MM-DD)' })
        }
        if (p.start_time && !TIME_RE.test(String(p.start_time))) {
          return res.status(400).json({ error: 'start_time must be HH:MM' })
        }
        // Reject dates before this team's confirmed derby in that half (Art. 27).
        if (derbyDateBlocked(p.date, awayDerbyAnchors, awayRueckStart)) {
          return res.status(400).json({ error: 'away_before_derby' })
        }
        // Reject dates that hit an event for this KSCW team — the team is busy
        // (mirrors the home-slot event exclusion). Zurich-local date compare.
        const eventCover = await database('events as e')
          .join('events_teams as et', 'et.events_id', 'e.id')
          .where('et.teams_id', opponent.kscw_team)
          .whereRaw(
            "?::date BETWEEN (e.start_date AT TIME ZONE 'Europe/Zurich')::date " +
            "AND (COALESCE(e.end_date, e.start_date) AT TIME ZONE 'Europe/Zurich')::date",
            [String(p.date)],
          )
          .first('e.title')
        if (eventCover) {
          return res.status(400).json({ error: `${p.date} falls on a team event${eventCover.title ? ` (${eventCover.title})` : ''} — please pick another date.` })
        }
        // Reject if the team already plays within the gap of this date — a real
        // game, a home slot another opponent booked, or a confirmed away proposal
        // (pending proposals don't count). Proposal 3 (i===2) uses the lenient gap.
        const committedForProposal = i < 2 ? committedStrict : committedLoose
        if (committedForProposal.has(String(p.date).slice(0, 10))) {
          return res.status(400).json({ error: `${p.date} is too close to an existing game — please pick another date.` })
        }
        // C1 cross-team: a roster-sharing team must not already play this date.
        const xTeams = await teamsCommittedOnDate(sharedTeams, String(p.date), database)
        if (xTeams.length) {
          const names = await database('teams').whereIn('id', xTeams).pluck('name')
          return res.status(400).json({ error: 'conflict_cross_team', teams: names.join(', ') })
        }
        // Reject if any rostered member has a one-off absence (NOT a weekly
        // unavailability) affecting games on that date. "No game if absence."
        const absRow = await database('absences as a')
          .join('member_teams as mt', 'mt.member', 'a.member')
          .where('mt.team', opponent.kscw_team)
          // Players only — guests (guest_level > 0) don't block.
          .where(function () { this.where('mt.guest_level', 0).orWhereNull('mt.guest_level') })
          // One-off absences only, not weekly unavailabilities. IS DISTINCT FROM
          // so a NULL type (legacy one-off) still counts (`!= 'weekly'` is NULL).
          .whereRaw("a.type IS DISTINCT FROM 'weekly'")
          // Non-blocking absences (long-term injury, maternity) don't block scheduling.
          .whereRaw('a.blocking IS NOT FALSE')
          .whereRaw("a.start_date::date <= ?::date AND a.end_date::date >= ?::date", [String(p.date), String(p.date)])
          .whereRaw("(a.affects::jsonb @> '\"all\"' OR a.affects::jsonb @> '\"games\"')")
          .countDistinct('a.member as c')
          .first()
        // Proposals 1 & 2 (i < 2) must be absence-free; proposal 3 (i === 2)
        // tolerates 1-2 absences and only blocks at 3+.
        const absThreshold = i < 2 ? 1 : 3
        if (Number(absRow?.c || 0) >= absThreshold) {
          return res.status(400).json({
            error: i < 2
              ? `${p.date}: proposals 1 and 2 must have no player absences.`
              : `${p.date} has 3 or more players absent — please pick another date.`,
          })
        }
        const rawPlace = String(p.location || p.place || '').slice(0, 200)
        const dt = p.start_time ? `${p.date}T${p.start_time}` : p.date
        row[`proposed_datetime_${i + 1}`] = dt
        row[`proposed_place_${i + 1}`] = rawPlace
      }
      // "Update proposals" re-submits via the same endpoint — replace any prior
      // pending away_proposal FOR THIS FIXTURE in place so the booking id stays
      // stable (a delete+insert mints a new id and the admin dashboard's stale id
      // then 400s "Invalid booking" on confirm). Confirmed bookings and other
      // fixtures' proposals are left intact; `row` stamps svrz_game_id, upgrading
      // a legacy NULL row to its fixture.
      const priorAway = allAway
        .filter((b) => bookingMatchesFixture(b, target) && b.status === 'pending')
        .map((b) => b.id)
      if (priorAway.length > 0) {
        await database('game_scheduling_bookings').where('id', priorAway[0]).update({
          // Clear all proposal columns first so a shorter re-proposal doesn't
          // leave a stale slot 3 behind; `row` re-sets the submitted ones.
          proposed_datetime_1: null, proposed_datetime_2: null, proposed_datetime_3: null,
          proposed_place_1: null, proposed_place_2: null, proposed_place_3: null,
          ...row,
          confirmed_proposal: null,
          slot: null,
        })
        if (priorAway.length > 1) {
          await database('game_scheduling_bookings').whereIn('id', priorAway.slice(1)).del()
        }
      } else {
        await database('game_scheduling_bookings').insert(row)
      }

      // Status lifecycle: away proposal transitions invited/viewed → booked
      await database('game_scheduling_opponents')
        .where('id', opponent.id)
        .whereIn('status', ['invited', 'viewed'])
        .update({ status: 'booked' })

      // Receipt email to the opponent (their language) + KSCW notify to confirm.
      // Best-effort — never blocks the submission.
      try {
        const team = await database('teams').where('id', opponent.kscw_team).first()
        const kscw = `KSCW ${team?.name || ''}`.trim()
        const opp = opponent.club_name || opponent.team_name || ''
        // Structured rows for HTML info cards + parallel plain-text lines.
        // Away proposals carry a datetime → render as dd.mm.yyyy HH:MM.
        const slotRowsMail = []
        for (let i = 1; i <= 3; i++) {
          const dt = row[`proposed_datetime_${i}`]
          if (!dt) continue
          const { date, time } = fmtDateMail(dt)
          slotRowsMail.push({ date, time })
        }
        const list = slotRowsMail.map((r) => `• ${r.date}${r.time ? `, ${r.time}` : ''}`).join('\n')
        if (opponent.contact_email) {
          const { subject, text, html } = schedEmail(opponent.language, 'proposals_sent', {
            contact: opponent.contact_name || '', kscw, opp, list, slots: slotRowsMail,
          })
          await sendSchedulingMail(opponent.contact_email, subject, text, null, html)
        }
        const adminText = `${opp} hat Auswärts-Termine vorgeschlagen (${kscw}):\n${list}\n\nBitte im Dashboard einen bestätigen:\n${FRONTEND_URL}/admin/terminplanung/dashboard`
        const adminHtml = adminNotifyHtml({
          title: 'Auswärts-Terminvorschläge',
          lead: `${opp} hat Auswärts-Termine vorgeschlagen (${kscw}):`,
          infoRows: slotRowsMail.map((r, i) => ({ label: `Termin ${i + 1}`, value: `${r.date}${r.time ? `, ${r.time}` : ''}` })),
          ctaText: 'Bitte im Dashboard einen Termin bestätigen.',
          ctaUrl: `${FRONTEND_URL}/admin/terminplanung/dashboard`,
        })
        await sendSchedulingMail(SCHEDULING_REPLY_TO, `Auswärts-Terminvorschläge – ${opp} (${kscw})`, adminText, null, adminHtml)
      } catch (mailErr) {
        log.warn(`propose-away email failed: ${mailErr.message}`)
      }

      res.json({ success: true, proposals_count: proposals.length })
    } catch (err) {
      log.error({ msg: `terminplanung/propose-away: ${err.message}`, endpoint: 'terminplanung/propose-away', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /kscw/terminplanung/set-language/:token — remember the opponent's UI
  // language so transactional emails go out in it. Called on page load and each
  // time the opponent flips the language switcher. Idempotent.
  router.post('/terminplanung/set-language/:token', async (req, res) => {
    try {
      if (!rateLimit(langAttempts, req, 40, 15 * 60 * 1000)) {
        return res.status(429).json({ error: 'Too many requests. Try again later.' })
      }
      const language = String(req.body?.language || '').toLowerCase()
      if (!VALID_LANGS.includes(language)) {
        return res.status(400).json({ error: 'Invalid language' })
      }
      const updated = await database('game_scheduling_opponents')
        .where('token', req.params.token)
        .whereIn('status', ['active', 'invited', 'viewed', 'booked'])
        .update({ language })
      if (!updated) return res.status(404).json({ error: 'Invalid link' })
      res.json({ success: true })
    } catch (err) {
      log.error({ msg: `terminplanung/set-language: ${err.message}`, endpoint: 'terminplanung/set-language', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /kscw/terminplanung/note/:token — the opponent saves/updates their free
  // -text remark to KSCW (shown to the spielplaner in the dashboard). Token-gated,
  // independent of proposing so they can leave a note even with no workable slot.
  router.post('/terminplanung/note/:token', async (req, res) => {
    try {
      if (!rateLimit(writeAttempts, req, 20, 15 * 60 * 1000)) {
        return res.status(429).json({ error: 'Too many requests. Try again later.' })
      }
      const note = String(req.body?.note ?? '').slice(0, 2000)
      const updated = await database('game_scheduling_opponents')
        .where('token', req.params.token)
        .whereIn('status', ['active', 'invited', 'viewed', 'booked'])
        .update({ opponent_note: note })
      if (!updated) return res.status(404).json({ error: 'Invalid link' })
      res.json({ success: true })
    } catch (err) {
      log.error({ msg: `terminplanung/note: ${err.message}`, endpoint: 'terminplanung/note', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /kscw/admin/terminplanung/opponent-note — the spielplaner saves the note
  // shown to an opponent on their proposal page. Body: { opponent_id, kscw_note }.
  router.post('/admin/terminplanung/opponent-note', async (req, res) => {
    try {
      const opponentId = Number(req.body?.opponent_id)
      if (!opponentId) return res.status(400).json({ error: 'opponent_id required' })
      const opp = await database('game_scheduling_opponents').where('id', opponentId).first()
      if (!opp) return res.status(404).json({ error: 'Opponent not found' })
      if (!(await spielplanerCanManageTeam(req, opp.kscw_team))) return res.status(403).json({ error: 'Not authorized for this team' })
      const note = String(req.body?.kscw_note ?? '').slice(0, 2000)
      await database('game_scheduling_opponents').where('id', opponentId).update({ kscw_note: note })
      res.json({ success: true })
    } catch (err) {
      log.error({ msg: `admin/terminplanung/opponent-note: ${err.message}`, endpoint: 'admin/terminplanung/opponent-note', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /kscw/terminplanung/admin/generate-slots — (re)generate home slots for
  // a season from its Spielsamstage + per-team slot config. Body: { season_id }.
  // Idempotent: clears existing *available* slots for the season (booked/blocked
  // survive), then regenerates for each team with an explicit team_slot_config
  // entry ('spielsamstag' → Game-Saturday pool; 'hall_slot' → the team's weekly
  // hall slots expanded across the picked-Saturday span; 'manual' → skipped).
  router.post('/terminplanung/admin/generate-slots', async (req, res) => {
    if (!(await isAdminOrSpielplaner(req))) return res.status(403).json({ error: 'Admin only' })
    try {
      const { season_id } = req.body || {}
      if (!season_id) return res.status(400).json({ error: 'season_id required' })

      const season = await database('game_scheduling_seasons').where('id', season_id).first()
      if (!season) return res.status(404).json({ error: 'Season not found' })

      // JSON columns — jsonb comes back parsed, but guard against a string.
      const parseJson = (v, fallback) => {
        if (v == null) return fallback
        if (typeof v === 'string') { try { return JSON.parse(v) } catch { return fallback } }
        return v
      }
      const spielsamstage = parseJson(season.spielsamstage, [])
      const teamConfig = parseJson(season.team_slot_config, {})
      const seasonKey = String(season_id)

      // "Overwrites not-yet-booked slots": drop existing available slots for the
      // season before regenerating. Booked + blocked rows are preserved — AND so
      // are slots a PENDING home proposal points to, otherwise regenerating mints
      // new slot ids and orphans the proposal (confirm then 400s "Slot is no
      // longer available"). The clash check below skips re-creating a duplicate.
      const heldRows = await database('game_scheduling_bookings')
        .where('season', seasonKey).where('type', 'home_slot_pick').where('status', 'pending')
        .select('proposed_slot_1', 'proposed_slot_2', 'proposed_slot_3')
      const heldSlotIds = [...new Set(
        heldRows.flatMap((r) => [r.proposed_slot_1, r.proposed_slot_2, r.proposed_slot_3]).filter((v) => v != null),
      )]
      await database('game_scheduling_slots')
        .where('season', seasonKey).where('status', 'available')
        .modify((q) => { if (heldSlotIds.length) q.whereNotIn('id', heldSlotIds) })
        .del()

      const addHours = (hhmm, hrs) => {
        const [h, m] = String(hhmm).split(':').map(Number)
        const d = new Date(Date.UTC(2000, 0, 1, h || 0, m || 0))
        d.setUTCHours(d.getUTCHours() + hrs)
        return d.toISOString().slice(11, 16)
      }

      // Evening (hall_slot) mode repeats weekly across the volleyball season
      // window: Sep 1 (first year) → Mar 31 (second year), parsed from the
      // season name (e.g. "2026/27").
      const seasonWindow = (name) => {
        const m = String(name || '').match(/(\d{4})\D+(\d{2,4})/)
        if (!m) return null
        const y1 = parseInt(m[1], 10)
        let y2 = parseInt(m[2], 10)
        if (y2 < 100) y2 = 2000 + y2
        return { start: new Date(Date.UTC(y1, 8, 1)), end: new Date(Date.UTC(y2, 2, 31)) }
      }
      const eveningWindow = seasonWindow(season.season)

      // Club-wide Spielhalle pool: the shared game-hall slots (label
      // 'Spielhalle', no team assigned — KWI A/B on Friday). Any team without
      // its own 21:30 Döltschi/KWI slot falls back to these.
      const spielhalleSlots = await database('hall_slots')
        .whereRaw("LOWER(label) = 'spielhalle'")
        .select('day_of_week', 'start_time', 'end_time', 'hall')

      // Shared VOLLEYBALL Döltschi pool: the Under teams take each other's
      // Tuesday Döltschi slots. Volleyball only — the BB Döltschi slots stay out.
      const doltschiVbPool = await database('hall_slots')
        .join('halls', 'hall_slots.hall', 'halls.id')
        .where('hall_slots.sport', 'volleyball')
        .whereRaw("(LOWER(halls.name) LIKE '%döltschi%' OR LOWER(halls.name) LIKE '%doltschi%')")
        .select('hall_slots.day_of_week', 'hall_slots.start_time', 'hall_slots.end_time', 'hall_slots.hall')

      // KWI game halls — used for junior Sunday slots (rule A2/C1). Juniors may
      // play home games on any Sunday; the times are fixed.
      const kwiHalls = await database('halls')
        .whereRaw("LOWER(name) LIKE '%kwi%'").orderBy('name').select('id')
      const SUNDAY_TIMES = ['11:00', '13:00', '15:00']

      // Teams excluded from Terminplanung entirely (no league fixtures to
      // schedule) — mirrors SCHEDULING_EXCLUDED_TEAM_NAMES in the frontend
      // (src/modules/gameScheduling/utils/schedulableTeams.ts). No slots generated.
      const SCHEDULING_EXCLUDED_TEAM_NAMES = ['MiniVB', 'DU20']
      const teams = await database('teams')
        .where('sport', 'volleyball').where('active', true)
        .whereNotIn('name', SCHEDULING_EXCLUDED_TEAM_NAMES).select('id', 'name')

      // B1/B2 — Friday gym split with basketball. Until the October vacation
      // (Herbstferien) volleyball uses both halls every Friday. After it, Fridays
      // alternate VB / BB, so VB only gets every other Friday. Parity (documented):
      // the first Friday on/after Herbstferien end is a VB Friday. If no
      // Herbstferien closure is found, keep the pre-vacation behaviour (all Fridays).
      let herbstStart = null
      let herbstEndExclusive = null // first open day after the vacation
      if (eveningWindow) {
        const herbst = await database('hall_closures')
          .where('source', 'school_holidays')
          .whereRaw("LOWER(reason) LIKE '%herbst%'")
          .andWhere('end_date', '>=', eveningWindow.start)
          .andWhere('start_date', '<=', eveningWindow.end)
          .select(database.raw('MIN(start_date)::text as s'), database.raw('MAX(end_date)::text as e'))
          .first()
        if (herbst?.s) herbstStart = new Date(`${herbst.s.slice(0, 10)}T00:00:00Z`)
        if (herbst?.e) herbstEndExclusive = new Date(`${herbst.e.slice(0, 10)}T00:00:00Z`)
      }
      // The reference VB Friday after the vacation = the first Friday on/after the
      // first open day. Used to compute alternating-week parity.
      let firstPostHerbstFriday = null
      if (herbstEndExclusive) {
        const d = new Date(herbstEndExclusive)
        while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1)
        firstPostHerbstFriday = d
      }
      // Smart alternating: VB shares post-vacation Fridays 50/50 with basketball
      // (the gym is VB or BB on a given Friday, club-wide — can't differ per team).
      // Of the two every-other-Friday parities, pick the one that leaves the
      // WORST-AFFECTED Friday team with the fewest absence-hit VB Fridays — i.e.
      // protect the team that has the most absences on its Friday slots (minimax),
      // tie → fewest overall. Only NON-junior teams without their own KWI evening
      // slot count here: those genuinely depend on the Friday Spielhalle as a home
      // option. Juniors are excluded — Friday Spielhalle is a low-priority fallback
      // for them (their priority is own slot / Spielsamstag / Döltschi / Sunday),
      // so their Friday absences shouldn't drive the offset. Strict alternation is
      // preserved; only the offset is chosen.
      let vbFridaySet = null
      if (eveningWindow && herbstStart && firstPostHerbstFriday) {
        const teamsWithOwnSlot = new Set(
          await database('hall_slots')
            .join('hall_slots_teams', 'hall_slots.id', 'hall_slots_teams.hall_slots_id')
            .join('halls', 'hall_slots.hall', 'halls.id')
            .whereRaw("hall_slots.end_time::text LIKE '21:30%'")
            .whereRaw("LOWER(halls.name) LIKE '%kwi%'")
            .distinct('hall_slots_teams.teams_id')
            .pluck('hall_slots_teams.teams_id'),
        )
        const fridayTeamIds = teams
          .filter((tm) => !isJuniorTeam(tm.name) && !teamsWithOwnSlot.has(tm.id))
          .map((tm) => tm.id)
        const absRows = fridayTeamIds.length
          ? await database('absences as a')
              .join('member_teams as mt', 'mt.member', 'a.member')
              .whereIn('mt.team', fridayTeamIds)
              .where(function () { this.where('mt.guest_level', 0).orWhereNull('mt.guest_level') })
              .whereRaw("a.type IS DISTINCT FROM 'weekly'")
              .whereRaw('a.blocking IS NOT FALSE')
              .whereRaw("(a.affects::jsonb @> '\"all\"' OR a.affects::jsonb @> '\"games\"')")
              .where('a.end_date', '>=', eveningWindow.start)
              .where('a.start_date', '<=', eveningWindow.end)
              .select(database.raw('mt.team as team'), database.raw('a.start_date::date::text as s'), database.raw('a.end_date::date::text as e'))
          : []
        const fridays = []
        for (const d = new Date(firstPostHerbstFriday); d <= eveningWindow.end; d.setUTCDate(d.getUTCDate() + 7)) {
          fridays.push(d.toISOString().slice(0, 10))
        }
        // Which teams have a game-affecting absence on each Friday.
        const teamsAbsentOn = new Map()
        for (const r of absRows) {
          for (const f of fridays) {
            if (r.s <= f && f <= r.e) {
              if (!teamsAbsentOn.has(f)) teamsAbsentOn.set(f, new Set())
              teamsAbsentOn.get(f).add(r.team)
            }
          }
        }
        // For an offset: worst = the most absence-hit VB Fridays any single team
        // would carry; total = the same summed over all teams. Pick the offset
        // that minimises the WORST team first, then the total as a tiebreaker.
        const burdenStats = (parity) => {
          const cnt = new Map()
          fridays.forEach((f, i) => {
            if (i % 2 !== parity) return
            for (const team of teamsAbsentOn.get(f) || []) cnt.set(team, (cnt.get(team) || 0) + 1)
          })
          const vals = [...cnt.values()]
          return { worst: vals.length ? Math.max(...vals) : 0, total: vals.reduce((a, b) => a + b, 0) }
        }
        const b0 = burdenStats(0)
        const b1 = burdenStats(1)
        const vbParity = b1.worst !== b0.worst
          ? (b1.worst < b0.worst ? 1 : 0)
          : (b1.total < b0.total ? 1 : 0) // worst-team tie → fewer absences overall; full tie → 0 (default)
        vbFridaySet = new Set(fridays.filter((_, i) => i % 2 === vbParity))
      }
      // Should a Friday `spielhalle` slot be generated for volleyball on `date`?
      const fridayIsVolleyball = (date) => {
        if (!herbstStart || !firstPostHerbstFriday) return true // no Herbst data → all Fridays
        if (date < herbstStart) return true                    // before vacation → every Friday
        if (date < firstPostHerbstFriday) return false         // inside vacation / pre-first-VB-Friday
        if (!vbFridaySet) return true
        return vbFridaySet.has(date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10))
      }

      let total_created = 0
      for (const team of teams) {
        const cfg = teamConfig[String(team.id)]
        // Additive sources. Default (no config) = both. Explicit empty = manual.
        let sources
        if (Array.isArray(cfg?.sources)) sources = cfg.sources
        else if (cfg?.source === 'manual') sources = []
        else if (cfg?.source) sources = [cfg.source]
        else sources = ['hall_slot', 'spielsamstag']
        if (sources.length === 0) continue

        const candidates = []

        // Game-Saturday pool: every picked Saturday × its configured slots.
        if (sources.includes('spielsamstag')) {
          for (const sat of (Array.isArray(spielsamstage) ? spielsamstage : [])) {
            if (!sat?.date || !Array.isArray(sat.slots)) continue
            for (const s of sat.slots) {
              if (!s?.time || !s?.hall_id) continue
              candidates.push({
                date: sat.date, start_time: s.time, end_time: addHours(s.time, 2),
                hall: parseInt(s.hall_id, 10) || null, source: 'spielsamstag',
              })
            }
          }
          // A2/C1 — juniors may play home games on ANY Sunday. Generate a Sunday
          // slot on every Sunday in the season window at the fixed times × KWI
          // halls. Not a curated "game-Sunday" list; the soft clustering onto
          // Sundays another junior already uses happens at slot-display time.
          if (isJuniorTeam(team.name) && eveningWindow) {
            const d = new Date(eveningWindow.start)
            while (d <= eveningWindow.end) {
              if (d.getUTCDay() === 0) {
                const date = d.toISOString().slice(0, 10)
                for (const time of SUNDAY_TIMES) {
                  for (const h of kwiHalls) {
                    candidates.push({
                      date, start_time: time, end_time: addHours(time, 2),
                      hall: h.id, source: 'spielsonntag',
                    })
                  }
                }
              }
              d.setUTCDate(d.getUTCDate() + 1)
            }
          }
        }

        // Standard slot (volleyball-only generator):
        //  - KWI teams: their own latest KWI block (ends 21:30).
        //  - Döltschi (Under) teams: the SHARED volleyball Döltschi pool — any
        //    team that uses Döltschi can take any VB Döltschi slot.
        //  - Neither: fall back to the club Spielhalle pool (KWI A/B Friday).
        // day_of_week is 0=Mon in the DB -> JS getUTCDay (0=Sun) via (dow + 1) % 7.
        if (sources.includes('hall_slot') && eveningWindow) {
          const ownKwi = await database('hall_slots')
            .join('hall_slots_teams', 'hall_slots.id', 'hall_slots_teams.hall_slots_id')
            .join('halls', 'hall_slots.hall', 'halls.id')
            .where('hall_slots_teams.teams_id', team.id)
            .whereRaw("hall_slots.end_time::text LIKE '21:30%'")
            .whereRaw("LOWER(halls.name) LIKE '%kwi%'")
            .select('hall_slots.day_of_week', 'hall_slots.start_time', 'hall_slots.end_time', 'hall_slots.hall')
          const usesDoltschi = await database('hall_slots')
            .join('hall_slots_teams', 'hall_slots.id', 'hall_slots_teams.hall_slots_id')
            .join('halls', 'hall_slots.hall', 'halls.id')
            .where('hall_slots_teams.teams_id', team.id)
            .where('hall_slots.sport', 'volleyball')
            .whereRaw("(LOWER(halls.name) LIKE '%döltschi%' OR LOWER(halls.name) LIKE '%doltschi%')")
            .first()
          // Build (slot, source-tag) entries. Juniors (Under teams) ALWAYS get the
          // shared VB Döltschi pool — they may play in Döltschi even when it isn't
          // their own slot — AND the club Spielhalle pool (both). Non-juniors keep
          // their own KWI slot, take the Döltschi pool only if assigned, and fall
          // back to Spielhalle only when they have no evening slot at all.
          const isJr = isJuniorTeam(team.name)
          const stdEntries = ownKwi.map((hs) => ({ hs, tag: 'hall_slot' }))
          if (usesDoltschi || isJr) {
            for (const hs of doltschiVbPool) stdEntries.push({ hs, tag: 'hall_slot' })
          }
          if (isJr) {
            for (const hs of spielhalleSlots) stdEntries.push({ hs, tag: 'spielhalle' })
          } else if (stdEntries.length === 0) {
            for (const hs of spielhalleSlots) stdEntries.push({ hs, tag: 'spielhalle' })
          }
          for (const { hs, tag } of stdEntries) {
            const targetJsDay = (hs.day_of_week + 1) % 7
            const d = new Date(eveningWindow.start)
            while (d <= eveningWindow.end) {
              if (d.getUTCDay() === targetJsDay) {
                // B1/B2 — the shared Friday Spielhalle pool alternates with
                // basketball after the October vacation. Skip VB-off Fridays.
                const isFridaySpielhalle = tag === 'spielhalle' && targetJsDay === 5
                if (!isFridaySpielhalle || fridayIsVolleyball(d)) {
                  candidates.push({
                    date: d.toISOString().slice(0, 10), start_time: hs.start_time,
                    end_time: hs.end_time, hall: hs.hall, source: tag,
                  })
                }
              }
              d.setUTCDate(d.getUTCDate() + 1)
            }
          }
        }

        for (const c of candidates) {
          // Don't duplicate a surviving booked/blocked slot at the same key.
          const clash = await database('game_scheduling_slots')
            .where({ kscw_team: team.id, date: c.date, start_time: c.start_time })
            .modify((q) => { if (c.hall != null) q.where('hall', c.hall) })
            .first()
          if (clash) continue
          await database('game_scheduling_slots').insert({
            season: seasonKey, kscw_team: team.id, date: c.date,
            start_time: c.start_time, end_time: c.end_time, hall: c.hall,
            source: c.source, status: 'available',
          })
          total_created++
        }
      }

      // Auto-cleanup: drop any PENDING home proposal left orphaned — none of its
      // proposed_slot_1/2/3 reference a slot that still exists. The held-slot
      // exclusion above keeps live proposals intact, so this only removes ones
      // whose slots were already gone (otherwise confirm would 400 forever with
      // "Slot is no longer available").
      const pendingHome = await database('game_scheduling_bookings')
        .where('season', seasonKey).where('type', 'home_slot_pick').where('status', 'pending')
        .select('id', 'proposed_slot_1', 'proposed_slot_2', 'proposed_slot_3')
      let orphans_deleted = 0
      if (pendingHome.length) {
        const refIds = [...new Set(
          pendingHome.flatMap((b) => [b.proposed_slot_1, b.proposed_slot_2, b.proposed_slot_3]).filter((v) => v != null),
        )]
        const liveIds = new Set(
          refIds.length
            ? (await database('game_scheduling_slots').whereIn('id', refIds).pluck('id')).map((v) => String(v))
            : [],
        )
        const deadBookingIds = pendingHome
          .filter((b) => ![b.proposed_slot_1, b.proposed_slot_2, b.proposed_slot_3].some((s) => s != null && liveIds.has(String(s))))
          .map((b) => b.id)
        if (deadBookingIds.length) {
          await database('game_scheduling_bookings').whereIn('id', deadBookingIds).del()
          orphans_deleted = deadBookingIds.length
        }
      }

      res.json({ success: true, total_created, orphans_deleted })
    } catch (err) {
      log.error({ msg: `generate-slots: ${err.message}`, endpoint: 'terminplanung/admin/generate-slots', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /kscw/terminplanung/admin/confirm-away — confirm one of an opponent's
  // away-date proposals. Body: { booking_id, proposal_number (1-3), admin_notes? }.
  // Away proposals live on a single booking row (type 'away_proposal', status
  // 'pending') with up to 3 proposed_datetime_N / proposed_place_N columns.
  router.post('/terminplanung/admin/confirm-away', async (req, res) => {
    try {
      const { booking_id, proposal_number, admin_notes } = req.body || {}
      const n = Number(proposal_number)
      if (!booking_id || ![1, 2, 3].includes(n)) {
        return res.status(400).json({ error: 'booking_id and proposal_number (1-3) required' })
      }

      const booking = await database('game_scheduling_bookings').where('id', booking_id).first()
      if (!booking || booking.type !== 'away_proposal') {
        return res.status(400).json({ error: 'Invalid booking' })
      }
      const chosenDateTime = booking[`proposed_datetime_${n}`]
      if (!chosenDateTime) return res.status(400).json({ error: `Proposal ${n} is empty` })

      const awayOpponent = await database('game_scheduling_opponents').where('id', booking.opponent).first()
      if (!awayOpponent) return res.status(400).json({ error: 'Opponent not found' })
      if (!(await spielplanerCanManageTeam(req, awayOpponent.kscw_team))) return res.status(403).json({ error: 'Not authorized for this team' })

      // Re-validate the chosen proposal against the same offer-time guards (state
      // may have changed since the opponent proposed): derby clamp (Art. 27), team
      // event, game-spacing gap and cross-team same-day. Mirrors propose-away.
      {
        // proposed_datetime_N comes back from knex as a JS Date — String(Date)
        // gives "Sat Feb 13 …", so slice(0,10) yields garbage that 500s the
        // ?::date guards below. Normalise to a YYYY-MM-DD first.
        const chosenDay = String(chosenDateTime instanceof Date ? chosenDateTime.toISOString() : chosenDateTime).slice(0, 10)
        const awaySeasonRow = await database('game_scheduling_seasons').where('id', awayOpponent.season).first()
        const awayRueckStart = rueckrundeStart(awaySeasonRow)
        const awayDerbyAnchors = await confirmedDerbyAnchors(awayOpponent.kscw_team, awayOpponent.season, awayRueckStart)
        if (derbyDateBlocked(chosenDay, awayDerbyAnchors, awayRueckStart)) {
          return res.status(400).json({ error: 'away_before_derby' })
        }
        const eventCover = await database('events as e')
          .join('events_teams as et', 'et.events_id', 'e.id')
          .where('et.teams_id', awayOpponent.kscw_team)
          .whereRaw(
            "?::date BETWEEN (e.start_date AT TIME ZONE 'Europe/Zurich')::date " +
            "AND (COALESCE(e.end_date, e.start_date) AT TIME ZONE 'Europe/Zurich')::date",
            [chosenDay],
          )
          .first('e.title')
        if (eventCover) {
          return res.status(400).json({ error: `${chosenDay} falls on a team event${eventCover.title ? ` (${eventCover.title})` : ''} — please pick another date.` })
        }
        // Gap: the chosen proposal slot decides strict vs lenient (1-2 strict, 3 loose).
        const awayGaps = await seasonGaps(awayOpponent.season)
        const held = { includeHeld: true, excludeOpponent: awayOpponent.id }
        const committedGap = await committedGameDates(awayOpponent.kscw_team, n < 3 ? awayGaps.proposal : awayGaps.proposal3, held)
        if (committedGap.has(chosenDay)) {
          return res.status(400).json({ error: `${chosenDay} is too close to an existing game — please pick another date.` })
        }
        const sharedTeams = await sharedPlayerTeams(awayOpponent.kscw_team)
        const xTeams = await teamsCommittedOnDate(sharedTeams, chosenDay, database)
        if (xTeams.length) {
          const names = await database('teams').whereIn('id', xTeams).pluck('name')
          return res.status(400).json({ error: 'conflict_cross_team', teams: names.join(', ') })
        }
      }

      await database('game_scheduling_bookings').where('id', booking_id).update({
        status: 'confirmed',
        confirmed_proposal: n,
        admin_notes: admin_notes || booking.admin_notes || null,
      })

      // Confirmation email to the opponent in their language — final date +
      // "enter it in VolleyManager, we'll do the home game". Best-effort.
      try {
        const opponent = await database('game_scheduling_opponents').where('id', booking.opponent).first()
        if (opponent) {
          const team = await database('teams').where('id', opponent.kscw_team).first()
          const kscw = `KSCW ${team?.name || ''}`.trim()
          const opp = opponent.club_name || opponent.team_name || ''
          const { date, time } = fmtDateMail(chosenDateTime)
          const place = booking[`proposed_place_${n}`] || ''

          // Opponent confirmation (their language).
          if (opponent.contact_email) {
            const { subject, text, html } = schedEmail(opponent.language, 'game_confirmed', {
              contact: opponent.contact_name || '', kscw, opp, date, time,
            })
            await sendSchedulingMail(opponent.contact_email, subject, text, null, html)
          }

          // Per-leg notice → spielplanung mailbox only (auto-forwards to the VB
          // Spielplanung group). Coaches/TR are NOT notified here — they get a
          // single combined summary once the full schedule is confirmed.
          const adminText = `Auswärtsspiel bestätigt:\n\n${kscw} (Auswärts) bei ${opp}\n${date}${time ? `, ${time} Uhr` : ''}${place ? `, ${place}` : ''}`
          const adminHtml = adminNotifyHtml({
            title: 'Auswärtsspiel bestätigt',
            lead: `${kscw} (Auswärts) bei ${opp}`,
            infoRows: [
              { label: 'Spiel', value: `${kscw} (Auswärts) bei ${opp}` },
              { label: 'Datum', value: date, halfWidth: !!time },
              ...(time ? [{ label: 'Zeit', value: time, halfWidth: true }] : []),
              ...(place ? [{ label: 'Ort', value: place }] : []),
            ],
          })
          await sendSchedulingMail(SCHEDULING_REPLY_TO, `Auswärtsspiel bestätigt – ${opp} (${kscw})`, adminText, null, adminHtml)
        }
      } catch (mailErr) {
        log.warn(`Confirm-away email failed: ${mailErr.message}`)
      }

      res.json({ success: true, confirmed_proposal: n })
    } catch (err) {
      log.error({ msg: `confirm-away: ${err.message}`, endpoint: 'terminplanung/admin/confirm-away', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /kscw/terminplanung/admin/manual-booking — record an already-agreed
  // matchup directly, skipping the opponent's propose/choose flow. Used when the
  // spielplaner has settled the date(s) by email/phone outside the tool. Body:
  //   { opponent_id, home?: { date, start_time, end_time?, hall }, away?: { date, start_time?, place? } }
  // Either leg (or both) may be supplied. The home leg books a real slot (reusing
  // an existing open slot at that date/time/hall if one exists, else creating a
  // manual one) so it shows on the season calendar and feeds the cross-team /
  // Döltschi checks going forward. No emails are sent — the agreement already
  // happened; coaches get the combined summary via finalize-notify. Deliberately
  // permissive (no Saturday-cap / gap / cross-team rejection): the admin is
  // overriding on purpose. The one hard guard is "don't steal a slot another
  // opponent already booked".
  router.post('/terminplanung/admin/manual-booking', async (req, res) => {
    try {
      const { opponent_id, home, away } = req.body || {}
      if (!opponent_id) return res.status(400).json({ error: 'opponent_id required' })
      if (!home && !away) return res.status(400).json({ error: 'Provide a home and/or away game' })
      const opponent = await database('game_scheduling_opponents').where('id', opponent_id).first()
      if (!opponent) return res.status(404).json({ error: 'Opponent not found' })
      if (!(await spielplanerCanManageTeam(req, opponent.kscw_team))) return res.status(403).json({ error: 'Not authorized for this team' })
      const seasonId = String(opponent.season)
      let homeBookingId = null

      // Multi-game: each leg may name its fixture; absent → first of its side.
      const fixtures = await opponentSvrzFixtures(opponent)
      const homeTarget = home ? resolveTargetFixture(fixtures, true, home.svrz_game_id || null) : null
      if (home && !homeTarget) return res.status(400).json({ error: 'Invalid home game for this opponent' })
      const awayTarget = away ? resolveTargetFixture(fixtures, false, away.svrz_game_id || null) : null
      if (away && !awayTarget) return res.status(400).json({ error: 'Invalid away game for this opponent' })

      const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
      const TIME_RE = /^\d{2}:\d{2}(?::\d{2})?$/

      if (home) {
        if (!DATE_RE.test(String(home.date || ''))) return res.status(400).json({ error: 'home.date must be YYYY-MM-DD' })
        if (!home.start_time || !TIME_RE.test(String(home.start_time))) return res.status(400).json({ error: 'home.start_time must be HH:MM' })
        if (home.end_time && !TIME_RE.test(String(home.end_time))) return res.status(400).json({ error: 'home.end_time must be HH:MM' })
        if (!home.hall) return res.status(400).json({ error: 'home.hall required' })

        await database.transaction(async (trx) => {
          await trx.raw('SELECT pg_advisory_xact_lock(?, ?)', [GSCH_BOOK_LOCK_CLASS, opponent.kscw_team])
          // Releasing-on-overwrite: if this opponent already had a confirmed home
          // slot FOR THIS FIXTURE, free it (set back to available) so a re-entry
          // doesn't orphan a booked slot on the calendar. Captured before we
          // delete the booking. Other fixtures' bookings stay untouched.
          const prior = await scopeToFixture(
            trx('game_scheduling_bookings')
              .where({ opponent: opponent.id, type: 'home_slot_pick', status: 'confirmed' }),
            homeTarget,
          ).whereNotNull('slot').first()
          const priorSlotId = prior ? prior.slot : null

          // Reuse an existing slot at this exact key so the calendar doesn't end up
          // with a duplicate (one available, one booked). Else mint a manual slot.
          const existing = await trx('game_scheduling_slots')
            .where({ kscw_team: opponent.kscw_team, date: home.date, start_time: home.start_time })
            .where('hall', home.hall)
            .forUpdate().first()
          let slotId
          if (existing) {
            // Booked by a DIFFERENT opponent → real conflict. Booked by this same
            // opponent (re-confirming the identical slot) → fine, just re-book it.
            if (existing.status === 'booked' && String(existing.id) !== String(priorSlotId)) {
              throw Object.assign(new Error('A game is already booked in that slot'), { httpStatus: 400 })
            }
            // Never silently promote a deliberately blocked slot to booked.
            if (existing.status === 'blocked') {
              throw Object.assign(new Error('That slot is blocked — unblock it first'), { httpStatus: 400 })
            }
            await trx('game_scheduling_slots').where('id', existing.id)
              .update({ status: 'booked', end_time: home.end_time || existing.end_time || null })
            slotId = existing.id
          } else {
            const inserted = await trx('game_scheduling_slots').insert({
              season: seasonId, kscw_team: opponent.kscw_team, date: home.date,
              start_time: home.start_time, end_time: home.end_time || null, hall: home.hall,
              source: 'manual', status: 'booked',
            }).returning('id')
            slotId = typeof inserted[0] === 'object' ? inserted[0].id : inserted[0]
          }
          await scopeToFixture(
            trx('game_scheduling_bookings').where({ opponent: opponent.id, type: 'home_slot_pick' }),
            homeTarget,
          ).del()
          // Free the previously-booked slot (now detached) unless it's the one we
          // just re-booked. A 'manual' source slot left empty is just deleted.
          if (priorSlotId && String(priorSlotId) !== String(slotId)) {
            const priorSlot = await trx('game_scheduling_slots').where('id', priorSlotId).first()
            if (priorSlot && priorSlot.source === 'manual') {
              await trx('game_scheduling_slots').where('id', priorSlotId).del()
            } else if (priorSlot) {
              await trx('game_scheduling_slots').where('id', priorSlotId).update({ status: 'available' })
            }
          }
          const insHome = await trx('game_scheduling_bookings').insert({
            opponent: opponent.id, season: seasonId, type: 'home_slot_pick',
            status: 'confirmed', confirmed_proposal: 1, proposed_slot_1: slotId, slot: slotId,
            svrz_game_id: homeTarget.fixtureId,
            admin_notes: 'Manuell erfasst',
          }).returning('id')
          homeBookingId = typeof insHome[0] === 'object' ? insHome[0].id : insHome[0]
        })
        // Push the manually-booked date/time/hall into VolleyManager (best-effort).
        if (homeBookingId) {
          try {
            await database('game_scheduling_bookings').where('id', homeBookingId).update({ vm_push_status: 'queued', vm_push_error: null })
            await spawnVmPush(homeBookingId, { svrzId: homeTarget.fixtureId || null })
          } catch (pushErr) { log.warn(`manual-booking VM push enqueue failed: ${pushErr.message}`) }
        }
      }

      if (away) {
        if (!DATE_RE.test(String(away.date || ''))) return res.status(400).json({ error: 'away.date must be YYYY-MM-DD' })
        if (away.start_time && !TIME_RE.test(String(away.start_time))) return res.status(400).json({ error: 'away.start_time must be HH:MM' })
        const dt = away.start_time ? `${away.date}T${away.start_time}` : away.date
        await scopeToFixture(
          database('game_scheduling_bookings').where({ opponent: opponent.id, type: 'away_proposal' }),
          awayTarget,
        ).del()
        await database('game_scheduling_bookings').insert({
          opponent: opponent.id, season: seasonId, type: 'away_proposal',
          status: 'confirmed', confirmed_proposal: 1,
          svrz_game_id: awayTarget.fixtureId,
          proposed_datetime_1: dt, proposed_place_1: String(away.place || '').slice(0, 200),
          admin_notes: 'Manuell erfasst',
        })
      }

      await database('game_scheduling_opponents').where('id', opponent.id).update({ status: 'booked' })
      res.json({ success: true })
    } catch (err) {
      if (err && err.httpStatus) return res.status(err.httpStatus).json({ error: err.message })
      log.error({ msg: `manual-booking: ${err.message}`, endpoint: 'terminplanung/admin/manual-booking', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /kscw/admin/terminplanung/vm-push — (re)push a confirmed HOME booking's
  // date/time/hall into VolleyManager. Used for manual retry of a failed push and
  // for resolving an ambiguous match: pass svrz_persistence_id to pick the exact
  // fixture when the booking is in 'needs_pick'. Fire-and-forget; the child writes
  // the result back onto the booking (vm_push_status/…).
  router.post('/admin/terminplanung/vm-push', async (req, res) => {
    try {
      if (!(await isAdminOrSpielplaner(req))) return res.status(403).json({ error: 'Admin only' })
      const { booking_id, svrz_persistence_id } = req.body || {}
      if (!booking_id) return res.status(400).json({ error: 'booking_id required' })
      const booking = await database('game_scheduling_bookings').where('id', booking_id).first()
      if (!booking || booking.type !== 'home_slot_pick') return res.status(400).json({ error: 'Not a home booking' })
      if (booking.status !== 'confirmed') return res.status(400).json({ error: 'Booking is not confirmed' })
      const opponent = await database('game_scheduling_opponents').where('id', booking.opponent).first()
      if (!opponent || !(await spielplanerCanManageTeam(req, opponent.kscw_team))) return res.status(403).json({ error: 'Not authorized for this team' })
      await database('game_scheduling_bookings').where('id', booking_id).update({ vm_push_status: 'queued', vm_push_error: null })
      await spawnVmPush(booking_id, { svrzId: svrz_persistence_id || null })
      res.json({ queued: true })
    } catch (err) {
      log.error({ msg: `vm-push: ${err.message}`, endpoint: 'admin/terminplanung/vm-push', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /kscw/terminplanung/admin/finalize-notify — send the finalized schedule
  // (all confirmed home + away games) for one team+season to the team's coaches
  // + team-responsibles AND the spielplanung mailbox (which auto-forwards to the
  // VB Spielplanung group). Manual: the spielplaner clicks this once the schedule
  // is complete. Opponents are NOT included — they already received per-leg
  // confirmations, and a team-wide summary would leak other clubs' games.
  // Body: { team_id, season_id }.
  router.post('/terminplanung/admin/finalize-notify', async (req, res) => {
    try {
      const teamId = Number(req.body?.team_id)
      const seasonId = Number(req.body?.season_id)
      if (!teamId || !seasonId) return res.status(400).json({ error: 'team_id and season_id required' })
      if (!(await spielplanerCanManageTeam(req, teamId))) return res.status(403).json({ error: 'Not authorized for this team' })

      const [team, season] = await Promise.all([
        database('teams').where('id', teamId).first('id', 'name'),
        database('game_scheduling_seasons').where('id', seasonId).first('id', 'season'),
      ])
      if (!team) return res.status(404).json({ error: 'Team not found' })
      const kscw = `KSCW ${team.name || ''}`.trim()
      const seasonLabel = season?.season || ''

      const opponents = await database('game_scheduling_opponents')
        .where('kscw_team', teamId).where('season', seasonId)
        .whereNotIn('status', ['revoked', 'expired'])
        .select('id', 'team_name', 'club_name')
      const oppName = (o) => (o && (o.club_name || o.team_name)) || '—'
      const oppById = new Map(opponents.map((o) => [o.id, o]))
      const oppIds = opponents.map((o) => o.id)

      let homeRows = [], awayRows = []
      if (oppIds.length) {
        ;[homeRows, awayRows] = await Promise.all([
          database('game_scheduling_bookings as b')
            .join('game_scheduling_slots as s', 's.id', 'b.slot')
            .leftJoin('halls as h', 'h.id', 's.hall')
            .whereIn('b.opponent', oppIds).where('b.type', 'home_slot_pick').where('b.status', 'confirmed')
            .select('b.opponent', 's.date', 's.start_time', 's.end_time', 'h.name as hall'),
          database('game_scheduling_bookings')
            .whereIn('opponent', oppIds).where('type', 'away_proposal').where('status', 'confirmed')
            .select('opponent', 'confirmed_proposal',
              'proposed_datetime_1', 'proposed_datetime_2', 'proposed_datetime_3',
              'proposed_place_1', 'proposed_place_2', 'proposed_place_3'),
        ])
      }

      const homeCountByOpp = new Map()
      homeRows.forEach((r) => homeCountByOpp.set(r.opponent, (homeCountByOpp.get(r.opponent) || 0) + 1))
      const awayCountByOpp = new Map()
      awayRows.forEach((r) => awayCountByOpp.set(r.opponent, (awayCountByOpp.get(r.opponent) || 0) + 1))

      // Home game lines, sorted by date.
      const homeLines = homeRows.map((r) => {
        const { date } = fmtDateMail(r.date)
        const start = String(r.start_time || '').slice(0, 5)
        const end = String(r.end_time || '').slice(0, 5)
        const time = start ? `${start}${end ? `–${end}` : ''}` : ''
        return { sort: String(r.date || ''), text: `• ${date}${time ? `, ${time} Uhr` : ''}${r.hall ? `, ${r.hall}` : ''} – vs ${oppName(oppById.get(r.opponent))}` }
      }).sort((a, b) => a.sort.localeCompare(b.sort)).map((x) => x.text)

      // Away game lines (confirmed proposal), sorted by datetime.
      const awayLines = awayRows.map((r) => {
        const dt = r[`proposed_datetime_${r.confirmed_proposal}`]
        const place = r[`proposed_place_${r.confirmed_proposal}`] || ''
        const { date, time } = fmtDateMail(dt)
        return { sort: String(dt || ''), text: `• ${date}${time ? `, ${time} Uhr` : ''}${place ? `, ${place}` : ''} – bei ${oppName(oppById.get(r.opponent))}` }
      }).sort((a, b) => a.sort.localeCompare(b.sort)).map((x) => x.text)

      // Opponents still missing a confirmed game — per FIXTURE: a pairing can
      // be played 2-3× (junior triple round-robin), so compare confirmed
      // bookings per side against the synced fixture count (1+1 fallback when
      // the opponent has no synced fixtures).
      const pending = []
      for (const o of opponents) {
        const fixtures = await opponentSvrzFixtures({ ...o, kscw_team: teamId, season: seasonId })
        const homeTotal = fixtures.length ? fixtures.filter((f) => f.is_home_kscw).length : 1
        const awayTotal = fixtures.length ? fixtures.filter((f) => !f.is_home_kscw).length : 1
        const homeMiss = homeTotal - (homeCountByOpp.get(o.id) || 0)
        const awayMiss = awayTotal - (awayCountByOpp.get(o.id) || 0)
        const miss = []
        if (homeMiss > 0) miss.push(homeMiss > 1 ? `${homeMiss} Heimspiele` : 'Heimspiel')
        if (awayMiss > 0) miss.push(awayMiss > 1 ? `${awayMiss} Auswärtsspiele` : 'Auswärtsspiel')
        if (miss.length) pending.push(`• ${oppName(o)}: ${miss.join(' + ')} offen`)
      }

      const parts = [`Spielplan ${kscw}${seasonLabel ? ` – Saison ${seasonLabel}` : ''}`, '']
      parts.push(`Heimspiele (${homeLines.length}):`, ...(homeLines.length ? homeLines : ['• keine']), '')
      parts.push(`Auswärtsspiele (${awayLines.length}):`, ...(awayLines.length ? awayLines : ['• keine']))
      if (pending.length) parts.push('', `Noch offen (${pending.length}):`, ...pending)
      const text = parts.join('\n')

      // Branded HTML — render each section as its own info card (strip the leading
      // `• ` from the already Swiss-formatted lines). Dates are produced via
      // fmtDateMail above, never raw Date strings.
      const stripBullet = (s) => String(s).replace(/^•\s*/, '')
      const sectionCard = (heading, lines, empty) => {
        const para = `<p style="font-size:13px;text-transform:uppercase;letter-spacing:0.5px;color:#94a3b8;font-weight:700;margin:0 0 8px">${escHtml(heading)}</p>`
        const rows = (lines.length ? lines : [empty]).map((l, i) => ({ label: String(i + 1), value: stripBullet(l) }))
        return para + buildInfoCard(rows) + '<div style="height:14px;font-size:0;line-height:0">&nbsp;</div>'
      }
      let finalizeBody = sectionCard(`Heimspiele (${homeLines.length})`, homeLines, '• keine')
      finalizeBody += sectionCard(`Auswärtsspiele (${awayLines.length})`, awayLines, '• keine')
      if (pending.length) finalizeBody += sectionCard(`Noch offen (${pending.length})`, pending, '')
      const finalizeHtml = buildEmailLayout(finalizeBody, {
        title: 'Spielplan',
        subtitle: `${kscw}${seasonLabel ? ` – Saison ${seasonLabel}` : ''}`,
        sport: 'vb',
        footerExtra: 'Sportliche Grüsse, KSC Wiedikon',
      })

      // To: the spielplanung mailbox (auto-forwards to the VB Spielplanung
      // group). Cc: the team's coaches + team-responsibles.
      const staff = await teamStaffEmails(teamId)
      await sendSchedulingMail(SCHEDULING_REPLY_TO, `Spielplan ${kscw}${seasonLabel ? ` ${seasonLabel}` : ''}`, text, staff.length ? staff.join(',') : null, finalizeHtml)

      res.json({ success: true, staff: staff.length, home: homeLines.length, away: awayLines.length, pending: pending.length })
    } catch (err) {
      log.error({ msg: `finalize-notify: ${err.message}`, endpoint: 'terminplanung/admin/finalize-notify', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /kscw/admin/terminplanung/restore-season/:id — undo an archive
  // Reactivates volleyball teams for the season and flips status archived → closed.
  // Does NOT reissue individual invites that were expired by the archive
  // (those tokens stay dead — admin can reissue per invite if needed).
  router.post('/admin/terminplanung/restore-season/:id', async (req, res) => {
    if (!req.accountability?.admin) return res.status(403).json({ error: 'Admin only' })
    try {
      const seasonId = parseInt(req.params.id, 10)
      if (!seasonId) return res.status(400).json({ error: 'invalid season id' })

      const season = await database('game_scheduling_seasons').where('id', seasonId).first()
      if (!season) return res.status(404).json({ error: 'season not found' })
      if (season.status !== 'archived') {
        return res.status(400).json({ error: 'only archived seasons can be restored' })
      }
      if (!season.season) return res.status(400).json({ error: 'season has no name — cannot match teams' })

      // Guard against the rollover double-activation trap: if a NEWER season
      // already has active volleyball teams, this season was rolled forward and
      // reactivating it would leave two active teams per logical team — the
      // exact dual-active state migration 075 had to clean up (broken calendar
      // name/sport resolution, duplicate rosters). 'YYYY/YY' sorts correctly as
      // a string within this century. Caller can force past it knowingly.
      const newerActive = await database('teams')
        .where('sport', 'volleyball')
        .where('active', true)
        .where('season', '>', season.season)
        .first()
      if (newerActive && req.body?.force !== true) {
        return res.status(409).json({
          error: 'A newer active season exists — this season was rolled over. Restoring would create duplicate active teams. Re-send with { "force": true } to override.',
        })
      }

      const teamsRestored = await database('teams')
        .where('sport', 'volleyball')
        .where('season', season.season)
        .where('active', false)
        .update({ active: true })

      await database('game_scheduling_seasons').where('id', seasonId).update({ status: 'closed' })

      // Un-archive the restored teams' chats (inverse of archive-season below).
      await database.raw(
        `UPDATE conversation_members cm SET archived = false
         FROM conversations c
         WHERE cm.conversation = c.id AND c.type = 'team'
           AND c.team IN (SELECT id FROM teams WHERE sport = 'volleyball' AND season = ? AND active = true)`,
        [season.season],
      )

      log.info({
        msg: `restore-season id=${seasonId} (${season.season})`,
        teams_restored: teamsRestored,
        userId: req.accountability?.user || null,
      })
      res.json({ success: true, season: season.season, teams_restored: teamsRestored })
    } catch (err) {
      log.error({ msg: `restore-season: ${err.message}`, endpoint: 'admin/terminplanung/restore-season', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /kscw/admin/terminplanung/archive-season/:id — volleyball-only
  // Season must already be 'closed'. Marks teams inactive, expires lingering
  // invites, flips season status to 'archived'. Reversible by flipping
  // teams.active back to true in Directus admin.
  router.post('/admin/terminplanung/archive-season/:id', async (req, res) => {
    if (!req.accountability?.admin) return res.status(403).json({ error: 'Admin only' })
    try {
      const seasonId = parseInt(req.params.id, 10)
      if (!seasonId) return res.status(400).json({ error: 'invalid season id' })

      const season = await database('game_scheduling_seasons').where('id', seasonId).first()
      if (!season) return res.status(404).json({ error: 'season not found' })
      if (season.status !== 'closed') {
        return res.status(400).json({ error: 'season must be closed before it can be archived' })
      }
      if (!season.season) return res.status(400).json({ error: 'season has no name — cannot match teams' })

      // 1. Deactivate volleyball teams for this season string
      const teamsArchived = await database('teams')
        .where('sport', 'volleyball')
        .where('season', season.season)
        .where('active', true)
        .update({ active: false })

      // 2. Expire any lingering active invites for this season
      const invitesExpired = await database('game_scheduling_opponents')
        .where('season', seasonId)
        .whereIn('status', ['active', 'invited', 'viewed', 'booked'])
        .update({ status: 'expired' })

      // 2b. Archive the archived teams' chats so they drop off members' inboxes
      // (restore-season un-archives them). Mirrors the rollover archive step.
      await database.raw(
        `UPDATE conversation_members cm SET archived = true
         FROM conversations c
         WHERE cm.conversation = c.id AND c.type = 'team'
           AND c.team IN (SELECT id FROM teams WHERE sport = 'volleyball' AND season = ? AND active = false)`,
        [season.season],
      )

      // 3. Flip season to 'archived'
      await database('game_scheduling_seasons').where('id', seasonId).update({ status: 'archived' })

      log.info({
        msg: `archive-season id=${seasonId} (${season.season})`,
        teams_archived: teamsArchived,
        invites_expired: invitesExpired,
        userId: req.accountability?.user || null,
      })
      res.json({
        success: true,
        season: season.season,
        teams_archived: teamsArchived,
        invites_expired: invitesExpired,
      })
    } catch (err) {
      log.error({ msg: `archive-season: ${err.message}`, endpoint: 'admin/terminplanung/archive-season', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /kscw/admin/terminplanung/rollover-season — club-wide season rollover
  // Deep-clones every team of `from_season` into `to_season` (all sports), carrying
  // coaches, responsibles, captain, sponsors, hall-slot assignments and the full
  // roster (member_teams, incl. guests), then archives the source season's teams
  // (active=false). Idempotent: teams already present in `to_season` (matched by
  // external team_id, falling back to name) are skipped, so re-runs fill gaps
  // without duplicating. Whole operation runs in one transaction. With
  // `dry_run: true` the work is rolled back and only the projected counts return —
  // used to populate the confirmation dialog. Full Directus admin only.
  router.post('/admin/terminplanung/rollover-season', async (req, res) => {
    if (!req.accountability?.admin) return res.status(403).json({ error: 'Admin only' })
    try {
      // Derive defaults from the Jun 1 cutover (mirrors currentSeasonLong in
      // src/.../formatSeason.ts — Swiss Volley publishes new-season fixtures in June).
      const now = new Date()
      const startYear = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1
      const short = (a, b) => `${a}/${String(b).slice(-2)}`
      const defaultTo = short(startYear, startYear + 1)
      const defaultFrom = short(startYear - 1, startYear)

      const fromSeason = (req.body?.from_season || defaultFrom).trim()
      const toSeason = (req.body?.to_season || defaultTo).trim()
      const dryRun = req.body?.dry_run === true

      if (!fromSeason || !toSeason) return res.status(400).json({ error: 'from_season and to_season required' })
      if (fromSeason === toSeason) return res.status(400).json({ error: 'from_season and to_season must differ' })

      // Columns never copied verbatim onto the clone
      const OMIT = new Set(['id', 'date_created', 'date_updated'])

      let counts
      try {
        await database.transaction(async (trx) => {
          // Idempotency keys already present in the target season
          const existing = await trx('teams').where('season', toSeason).select('team_id', 'name')
          const seen = new Set(existing.map((t) => t.team_id || `name:${t.name}`))

          const sourceTeams = await trx('teams').where('season', fromSeason)
          if (sourceTeams.length === 0) {
            const err = new Error('no teams found in from_season')
            err.httpStatus = 400
            throw err
          }

          const map = {} // oldTeamId -> newTeamId
          let teamsCloned = 0
          let skipped = 0
          for (const team of sourceTeams) {
            const key = team.team_id || `name:${team.name}`
            if (seen.has(key)) { skipped++; continue }
            const row = {}
            for (const [k, v] of Object.entries(team)) {
              if (OMIT.has(k)) continue
              row[k] = v
            }
            row.season = toSeason
            row.active = true
            // Stamp audit timestamps — raw knex inserts bypass Directus' date
            // managers, so before this every rolled-over team/roster row landed
            // with a NULL date_created.
            row.date_created = now
            row.date_updated = now
            // Stale per-team dashboard window — let the new season recompute its default
            row.dashboard_range_from = null
            row.dashboard_range_to = null
            // json/jsonb columns: pg won't accept a parsed object in a
            // parameterised insert — stringify both (recruiting_positions is
            // jsonb and would otherwise throw and abort the whole rollover).
            if (row.features_enabled != null && typeof row.features_enabled === 'object') {
              row.features_enabled = JSON.stringify(row.features_enabled)
            }
            if (row.recruiting_positions != null && typeof row.recruiting_positions === 'object') {
              row.recruiting_positions = JSON.stringify(row.recruiting_positions)
            }
            const inserted = await trx('teams').insert(row).returning('id')
            const newId = typeof inserted[0] === 'object' ? inserted[0].id : inserted[0]
            map[team.id] = newId
            teamsCloned++
          }

          // Clone team junctions for every freshly-cloned team
          const cloneJunction = async (table, cols) => {
            let n = 0
            for (const [oldId, newId] of Object.entries(map)) {
              const rows = await trx(table).where('teams_id', oldId)
              for (const r of rows) {
                const ins = { teams_id: newId }
                for (const c of cols) ins[c] = r[c]
                await trx(table).insert(ins)
                n++
              }
            }
            return n
          }
          const coaches = await cloneJunction('teams_coaches', ['members_id'])
          const responsibles = await cloneJunction('teams_responsibles', ['members_id'])
          const sponsors = await cloneJunction('teams_sponsors', ['sponsors_id'])

          // Clone a team-owned config table (FK column `fkCol`) old->new team.
          // Copies every column except id / audit fields / the FK, repoints the
          // FK, JSON-stringifies object columns (jsonb like fine_rules.tiers),
          // and renders pg `date` columns (returned by pg-node as a Date at
          // LOCAL midnight) back to a YYYY-MM-DD string via the local calendar
          // parts — avoids the documented pg-node date TZ-shift gotcha.
          // `restrict` optionally narrows which source rows clone.
          const pad2 = (x) => String(x).padStart(2, '0')
          const cloneTeamTable = async (table, fkCol, restrict) => {
            const OMIT_ROW = new Set(['id', 'date_created', 'date_updated', 'user_created', 'user_updated', fkCol])
            let n = 0
            for (const [oldId, newId] of Object.entries(map)) {
              let q = trx(table).where(fkCol, oldId)
              if (restrict) q = restrict(q)
              const rows = await q
              for (const r of rows) {
                const ins = { [fkCol]: Number(newId) }
                for (const [k, v] of Object.entries(r)) {
                  if (OMIT_ROW.has(k)) continue
                  if (v instanceof Date) {
                    ins[k] = `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`
                  } else if (v != null && typeof v === 'object') {
                    ins[k] = JSON.stringify(v)
                  } else {
                    ins[k] = v
                  }
                }
                await trx(table).insert(ins)
                n++
              }
            }
            return n
          }
          // Fine catalog + per-team game-scheduling blackouts + spielplaner
          // assignments are team CONFIG, not history — they must follow the
          // active team or the new season silently starts with an empty fine
          // catalog (auto-fine engine returns null), no blackout dates, and a
          // per-team Spielplaner who loses sandbox edit access. scheduling_blocks
          // only carry forward blocks that still end in the future.
          const startIsoRoll = now.toISOString().slice(0, 10)
          const fineRules = await cloneTeamTable('fine_rules', 'team')
          const spielplanerAssignments = await cloneTeamTable('spielplaner_assignments', 'kscw_team')
          const schedulingBlocks = await cloneTeamTable('scheduling_blocks', 'team', (q) => q.where('end_date', '>=', startIsoRoll))

          // Hall-plan links MOVE to the new team (re-point), they do NOT
          // duplicate. The recurring hall_slots are shared club infrastructure
          // and must follow the active team, not stay pinned to the team we're
          // about to archive. Cloning here (the pre-fix behaviour) left every
          // slot dual-linked [archived, active] with the archived team sorting
          // first — which broke the calendar's name/sport resolution and the
          // VB/BB filter (migration 075 cleans up the rows that bug already
          // wrote). Re-point where the new team isn't already on the slot, then
          // drop any leftover old links so the archived team leaves the plan.
          let hallSlots = 0
          for (const [oldId, newId] of Object.entries(map)) {
            const moved = await trx('hall_slots_teams')
              .where('teams_id', oldId)
              .whereNotIn('hall_slots_id', trx('hall_slots_teams').select('hall_slots_id').where('teams_id', newId))
              .update({ teams_id: newId })
            hallSlots += moved
            await trx('hall_slots_teams').where('teams_id', oldId).del()
          }

          // Clone the roster (member_teams, all guest levels) for cloned teams only
          let memberTeams = 0
          const clonedOldIds = Object.keys(map).map(Number)
          if (clonedOldIds.length > 0) {
            const mtRows = await trx('member_teams')
              .where('season', fromSeason)
              .whereIn('team', clonedOldIds)
            const inserts = mtRows
              .filter((r) => map[r.team])
              .map((r) => ({ member: r.member, team: map[r.team], season: toSeason, guest_level: r.guest_level, date_created: now }))
            if (inserts.length > 0) {
              await trx('member_teams').insert(inserts)
              memberTeams = inserts.length
            }
          }

          // Archive the source season's teams (club-wide, all sports)
          const teamsArchived = await trx('teams')
            .where('season', fromSeason)
            .where('active', true)
            .update({ active: false })

          // Carry UPCOMING events onto the new-season teams: re-point future
          // events_teams links from each cloned old team to its new id, so
          // event-day blocking (the Terminplanung slot picker) follows the
          // active team. Past events stay on the archived team as history.
          // Skip events already linked to the new team (avoids a dup junction).
          let eventsRelinked = 0
          for (const [oldId, newId] of Object.entries(map)) {
            const updated = await trx('events_teams')
              .where('teams_id', oldId)
              .whereIn('events_id', trx('events').select('id').where('start_date', '>=', now))
              .whereNotIn('events_id', trx('events_teams').select('events_id').where('teams_id', newId))
              .update({ teams_id: newId })
            eventsRelinked += updated
          }

          // Same for OPEN team-scoped forms — re-point their forms_teams links from
          // each cloned old team to its new id so the form still reaches the
          // rolled-over roster. Draft/closed forms stay on the archived team.
          // Skip forms already linked to the new team (avoids a dup junction).
          let formsRelinked = 0
          for (const [oldId, newId] of Object.entries(map)) {
            const updated = await trx('forms_teams')
              .where('teams_id', oldId)
              .whereIn('forms_id', trx('forms').select('id').where('status', 'open'))
              .whereNotIn('forms_id', trx('forms_teams').select('forms_id').where('teams_id', newId))
              .update({ teams_id: newId })
            formsRelinked += updated
          }

          // Carry UPCOMING trainings onto the new-season teams. The recurring
          // hall_slots already moved to the new team above, and the nightly
          // slot-cascade generates fresh trainings against whichever team owns
          // the slot — but the ~12 weeks of trainings ALREADY generated still
          // point at the old team. Without this re-point they're stranded on
          // the archived team: invisible to the rolled-over roster, so every
          // player's training list (and home-page RSVP) breaks the morning
          // after rollover (the 2026-06-01 incident — 341 trainings orphaned).
          // Re-point future trainings old->new, preserving id + hall_slot so
          // existing RSVPs/absence-declines survive and the cron's
          // hall_slot+date dedup never double-generates. Suppress
          // trg_trainings_notify (GUC, txn-local) so the bulk move is silent.
          // SYNCED games are intentionally NOT re-pointed: future fixtures
          // re-sync from Swiss Volley / Basketplan onto the active team daily
          // (kscw_team is now in their COMPARE_FIELDS so an unchanged fixture
          // re-points on the next sync). MANUAL (sandbox) games never re-sync,
          // so they ARE re-pointed below.
          let trainingsRelinked = 0
          {
            const startIso = now.toISOString().slice(0, 10)
            await trx.raw("SELECT set_config('kscw.skip_trainings_notify', 'on', true)")
            for (const [oldId, newId] of Object.entries(map)) {
              const moved = await trx('trainings')
                .where('team', oldId)
                .andWhere('date', '>=', startIso)
                .update({ team: newId })
              trainingsRelinked += moved
            }
          }

          // Carry UPCOMING manual games onto the new-season teams. Unlike synced
          // games these never re-sync, so without this they strand on the
          // archived team and vanish from the team-scoped games/home/calendar
          // views. Suppress trg_games_notify (GUC, txn-local — added in
          // migration 095) so the bulk move doesn't fan out "game updated" pushes.
          let manualGamesRelinked = 0
          {
            const startIso = now.toISOString().slice(0, 10)
            await trx.raw("SELECT set_config('kscw.skip_games_notify', 'on', true)")
            for (const [oldId, newId] of Object.entries(map)) {
              const moved = await trx('games')
                .where('kscw_team', oldId)
                .andWhere('source', 'manual')
                .andWhere('date', '>=', startIso)
                .update({ kscw_team: newId })
              manualGamesRelinked += moved
            }
          }

          // Expire pending join requests to the now-archived source teams — they
          // can't be approved into an archived team, and the member should
          // re-request the new-season team (a different id).
          const sourceTeamIds = sourceTeams.map((t) => t.id)
          const requestsExpired = await trx('team_requests')
            .whereIn('team', sourceTeamIds)
            .where('status', 'pending')
            .update({ status: 'expired' })

          // Archive the dead season's team chats. The clone INSERT already fired
          // the messaging trigger to auto-create a fresh team conversation for
          // each new team (roster auto-joined), so without this every member
          // would carry both the old (dead) and new team chat in their inbox,
          // accreting one stale chat per season. restore-season un-archives them.
          await trx.raw(
            `UPDATE conversation_members cm SET archived = true
             FROM conversations c
             WHERE cm.conversation = c.id AND c.type = 'team'
               AND c.team IN (SELECT id FROM teams WHERE season = ? AND active = false)`,
            [fromSeason],
          )

          counts = {
            from_season: fromSeason,
            to_season: toSeason,
            teams_cloned: teamsCloned,
            skipped,
            coaches,
            responsibles,
            sponsors,
            hall_slots: hallSlots,
            member_teams: memberTeams,
            fine_rules: fineRules,
            spielplaner_assignments: spielplanerAssignments,
            scheduling_blocks: schedulingBlocks,
            teams_archived: teamsArchived,
            events_relinked: eventsRelinked,
            forms_relinked: formsRelinked,
            trainings_relinked: trainingsRelinked,
            manual_games_relinked: manualGamesRelinked,
            team_requests_expired: requestsExpired,
          }

          if (dryRun) {
            const rollback = new Error('__dry_run__')
            rollback.__dryRun = true
            throw rollback
          }
        })
      } catch (err) {
        if (!err?.__dryRun) {
          if (err?.httpStatus) return res.status(err.httpStatus).json({ error: err.message })
          throw err
        }
      }

      log.info({
        msg: `rollover-season ${counts.from_season} → ${counts.to_season}${dryRun ? ' (dry-run)' : ''}`,
        ...counts,
        dry_run: dryRun,
        userId: req.accountability?.user || null,
      })
      res.json({ success: true, dry_run: dryRun, ...counts })
    } catch (err) {
      log.error({ msg: `rollover-season: ${err.message}`, endpoint: 'admin/terminplanung/rollover-season', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /kscw/terminplanung/admin/block-slot — block/unblock a slot.
  // Body: { slot_id, action: 'block' | 'unblock' }.
  router.post('/terminplanung/admin/block-slot', async (req, res) => {
    try {
      const { slot_id, action } = req.body || {}
      if (!slot_id) return res.status(400).json({ error: 'slot_id required' })
      const slot = await database('game_scheduling_slots').where('id', slot_id).first()
      if (!slot) return res.status(404).json({ error: 'Slot not found' })
      if (!(await spielplanerCanManageTeam(req, slot.kscw_team))) return res.status(403).json({ error: 'Not authorized for this team' })
      // Only available ⇄ blocked transitions — never overwrite a booked slot.
      if (slot.status !== 'available' && slot.status !== 'blocked') {
        return res.status(400).json({ error: 'Slot is booked — free it before blocking' })
      }
      await database('game_scheduling_slots').where('id', slot_id)
        .update({ status: action === 'block' ? 'blocked' : 'available' })
      res.json({ success: true })
    } catch (err) {
      log.error({ msg: `block-slot: ${err.message}`, endpoint: 'terminplanung/admin/block-slot', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /kscw/admin/terminplanung/svrz-sync — manual trigger for bulk SVRZ sync
  // Spawns the sync script detached; the HTTP caller returns immediately.
  // Child stdout + stderr are piped to /directus/logs/svrz-sync.log so failures
  // in the detached run leave a trail. The daily cron path uses execSync and
  // already emits to Sentry via logCronError on non-zero exit.
  router.post('/admin/terminplanung/svrz-sync', async (req, res) => {
    if (!(await isAdminOrSpielplaner(req))) return res.status(403).json({ error: 'Admin only' })
    try {
      const { season_uuid, season_name } = req.body || {}
      const auth = req.headers?.authorization || ''
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
      if (!token) return res.status(401).json({ error: 'Missing bearer token' })

      // Derive defaults from the current date (Jun 1 cutover — Swiss Volley
      // publishes new-season fixtures in June). Look up the matching SVRZ UUID
      // from the most recent sync for that season; fall back to the 2025/26 UUID.
      const now = new Date()
      const startYear = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1
      const defaultSeasonName = `${startYear}/${startYear + 1}`
      const known = await database('svrz_spielplaner_contacts')
        .where('season_name', defaultSeasonName).whereNotNull('season_uuid').first()
      const defaultSeasonUuid = known?.season_uuid || 'dcafddfe-8139-4e02-baad-d3f88ec00cd0'

      const { spawn } = await import('node:child_process')
      // Pipe child stdout + stderr to a persistent log so the detached run
      // leaves a trail when it fails. Without this, stdio: 'ignore' would
      // silently swallow all output and we'd never know why a sync failed.
      const { openSync } = await import('node:fs')
      let logOut, logErr
      try {
        logOut = openSync('/directus/logs/svrz-sync.log', 'a')
        logErr = openSync('/directus/logs/svrz-sync.log', 'a')
      } catch {
        logOut = 'ignore'; logErr = 'ignore'
      }
      // Scoped env — do NOT spread process.env; forward only the secrets the child needs
      const env = {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        VM_USERNAME: process.env.VM_USERNAME,
        VM_PASSWORD: process.env.VM_PASSWORD,
        DIRECTUS_URL: 'http://127.0.0.1:8055',
        DIRECTUS_TOKEN: token,
        SVRZ_SEASON_UUID: season_uuid || defaultSeasonUuid,
        SVRZ_SEASON_NAME: season_name || defaultSeasonName,
      }
      const child = spawn('node', ['/directus/scripts/svrz-scheduling-sync.mjs'], {
        env,
        detached: true,
        stdio: ['ignore', logOut, logErr],
      })
      child.unref()
      log.info({ msg: `svrz-sync spawned`, pid: child.pid, userId: req.accountability?.user })
      res.json({ started: true, pid: child.pid })
    } catch (err) {
      log.error({ msg: `svrz-sync: ${err.message}`, endpoint: 'admin/terminplanung/svrz-sync', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Admin invites (per-verein tokenized links, auto-populated from SVRZ)
  // ─────────────────────────────────────────────────────────────────────────

  // Invite links stay valid until the season's scheduling deadline (30.06 of the
  // season's END year), not a rolling TTL — every opponent works to the same
  // VolleyManager cutoff, derived per-season so links never mint born-expired.
  const ACTIVE_INVITE_STATUSES = ['invited', 'viewed', 'booked', 'active']
  const KSCW_SVRZ_CLUB_ID = process.env.KSCW_SVRZ_CLUB_ID || '912530'

  // ─── Stable team-ID matching (VM is the source of truth for names) ──────────
  // SVRZ fixture labels ("KSC Wiedikon DU23-1") can lag VM's renames: when a
  // junior team changes Stärkeklasse it becomes e.g. DU23-2 in VM (which owns
  // teams.name) before the SVRZ feed catches up. Matching our team to its
  // fixtures by NAME then silently breaks (0 opponents). But VM and SVRZ key the
  // team by the SAME stable `staticTeamIdentifier`, which we already store as
  // `teams.team_id` ("vb_2301"). Match on that id so VM can own the display name
  // without breaking fixture resolution. Falls back to the name label when a
  // fixture's raw payload lacks the id (older rows / non-SVRZ data).
  const staticIdFromTeamId = (teamId) => {
    const m = String(teamId || '').match(/(\d+)\s*$/)
    return m ? Number(m[1]) : null
  }
  // staticTeamIdentifier on a given side ('home'|'away') of an svrz_games row,
  // read from the stored raw payload; null if absent/unparseable.
  const sideStaticId = (g, side) => {
    let raw = g && g.raw
    if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch { return null } }
    const enc = raw && raw.encounter
    const team = enc && (side === 'home' ? enc.teamHome : enc.teamAway)
    const v = team && team.staticTeamIdentifier
    return v == null ? null : Number(v)
  }
  // staticTeamIdentifier of the KSCW side of a fixture (home/away decided by which
  // side carries our club id), or null if raw lacks it.
  const kscwSideStaticId = (g) =>
    sideStaticId(g, String(g.home_club_id) === String(KSCW_SVRZ_CLUB_ID) ? 'home' : 'away')

  // ── Multi-game per opponent: bookings are keyed per SVRZ fixture ──────────
  // A pairing can be played 2-3× per season (junior triple round-robin), so a
  // booking carries `svrz_game_id` (= svrz_games.svrz_persistence_id). This
  // resolves an opponent row to its season fixtures: KSCW club one side + the
  // opponent's team_name the other, scoped to the season's start year +
  // open/waitingForApproval, and the KSCW side must be THIS kscw_team
  // (static-id match, name fallback) — otherwise a club facing two KSCW teams
  // in one group (H1 & H3 in 2L) would leak the other team's fixtures into
  // this opponent's page. Deterministic order (starting_date_time, then id):
  // the FIRST fixture of a side also "owns" legacy bookings whose
  // svrz_game_id is NULL (pre-migration-105 rows / non-SVRZ opponents).
  async function opponentSvrzFixtures(opponent) {
    if (!opponent || !opponent.team_name) return []
    const seasonRow = opponent.season
      ? await database('game_scheduling_seasons').where('id', opponent.season).first('season')
      : null
    const svrzSeasonName = String(seasonRow?.season || '').split('/')[0].trim()
    const team = await database('teams').where('id', opponent.kscw_team).first('id', 'name', 'team_id')
    const ourStaticId = staticIdFromTeamId(team?.team_id)
    const wantName = `ksc wiedikon ${String(team?.name || '').trim().toLowerCase()}`
    const rows = await database('svrz_games')
      .whereIn('status', ['open', 'waitingForApproval'])
      .modify((q) => { if (svrzSeasonName) q.where('season_name', svrzSeasonName) })
      .where(function () {
        this.where(function () {
          this.where('home_club_id', KSCW_SVRZ_CLUB_ID).where('away_team_name', opponent.team_name)
        }).orWhere(function () {
          this.where('away_club_id', KSCW_SVRZ_CLUB_ID).where('home_team_name', opponent.team_name)
        })
      })
      .orderBy([
        { column: 'starting_date_time', order: 'asc' },
        { column: 'svrz_persistence_id', order: 'asc' },
      ])
    return rows
      .filter((g) => {
        const sid = kscwSideStaticId(g)
        if (sid != null && ourStaticId != null) return sid === ourStaticId
        const isHomeKscw = String(g.home_club_id) === String(KSCW_SVRZ_CLUB_ID)
        return String((isHomeKscw ? g.home_team_name : g.away_team_name) || '').trim().toLowerCase() === wantName
      })
      .map((g) => ({
        id: g.svrz_persistence_id,
        display_name: g.display_name,
        starting_date_time: g.starting_date_time,
        is_home_kscw: String(g.home_club_id) === String(KSCW_SVRZ_CLUB_ID),
        league: g.league_short,
        status: g.status,
      }))
  }

  // Resolve + validate the fixture a proposal/booking targets on one side
  // (home/away). `requestedId` comes from the request body; absent → the first
  // fixture of that side (matches the legacy single-game clients). Returns
  // { fixtureId, isFirst } — fixtureId null when the opponent has no synced
  // fixtures at all (non-SVRZ flow: bookings keep svrz_game_id NULL) — or null
  // when the requested id isn't one of this opponent's fixtures on that side.
  const resolveTargetFixture = (fixtures, isHome, requestedId) => {
    const side = fixtures.filter((f) => f.is_home_kscw === isHome)
    if (side.length === 0) return requestedId ? null : { fixtureId: null, isFirst: true }
    if (!requestedId) return { fixtureId: side[0].id, isFirst: true }
    const idx = side.findIndex((f) => String(f.id) === String(requestedId))
    if (idx === -1) return null
    return { fixtureId: side[idx].id, isFirst: idx === 0 }
  }

  // Does a booking row belong to the target fixture? Exact svrz_game_id match;
  // a NULL (legacy) row belongs to the FIRST fixture of its side.
  const bookingMatchesFixture = (b, target) => {
    if (!target) return false
    if (target.fixtureId == null) return b.svrz_game_id == null
    if (String(b.svrz_game_id || '') === String(target.fixtureId)) return true
    return target.isFirst && b.svrz_game_id == null
  }

  // SQL flavour of bookingMatchesFixture for scoped UPDATE/DELETE.
  const scopeToFixture = (q, target) => {
    if (target.fixtureId == null) return q.whereNull('svrz_game_id')
    if (target.isFirst) {
      return q.where(function () {
        this.where('svrz_game_id', String(target.fixtureId)).orWhereNull('svrz_game_id')
      })
    }
    return q.where('svrz_game_id', String(target.fixtureId))
  }

  // Expiry = 30.06 of the season's END year, parsed from a "YYYY/YY" season
  // string (e.g. "2026/27" → 2027-06-30T23:59:59Z; end year = start + 1). If the
  // season string is missing/unparseable, fall back to now + 1 year so a link is
  // never born already expired.
  function newInviteExpiry(seasonStr) {
    const m = String(seasonStr || '').match(/(\d{4})/)
    if (m) {
      const endYear = Number(m[1]) + 1
      return new Date(`${endYear}-06-30T23:59:59.000Z`).toISOString()
    }
    const d = new Date()
    d.setUTCFullYear(d.getUTCFullYear() + 1)
    return d.toISOString()
  }

  // GET /admin/terminplanung/svrz-available-seasons — list seasons seen in synced data
  router.get('/admin/terminplanung/svrz-available-seasons', async (req, res) => {
    if (!(await isAdminOrSpielplaner(req))) return res.status(403).json({ error: 'Admin only' })
    try {
      const rows = await database('svrz_spielplaner_contacts')
        .distinct('season_uuid', 'season_name')
        .whereNotNull('season_uuid')
        .orderBy('season_name', 'desc')
      res.json({ data: rows.map((r) => ({ uuid: r.season_uuid, name: r.season_name })) })
    } catch (err) {
      log.error({ msg: `svrz-available-seasons: ${err.message}`, endpoint: 'admin/terminplanung/svrz-available-seasons', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // GET /admin/terminplanung/svrz-status?season_name= — at-a-glance summary of the
  // synced SVRZ feed for a season: last sync time + game counts (total / KSCW home
  // / KSCW away). Shown next to "Sync SVRZ now".
  router.get('/admin/terminplanung/svrz-status', async (req, res) => {
    if (!(await isAdminOrSpielplaner(req))) return res.status(403).json({ error: 'Admin only' })
    try {
      const seasonName = String(req.query.season_name || '').split('/')[0].trim()
      const row = await database('svrz_games')
        .modify((q) => { if (seasonName) q.where('season_name', seasonName) })
        .select(
          database.raw('count(*)::int as total'),
          database.raw('count(*) FILTER (WHERE home_club_id = ?)::int as home', [KSCW_SVRZ_CLUB_ID]),
          database.raw('count(*) FILTER (WHERE away_club_id = ?)::int as away', [KSCW_SVRZ_CLUB_ID]),
          database.raw('max(last_synced_at) as last_synced_at'),
        )
        .first()
      res.json({
        total: Number(row?.total) || 0,
        home: Number(row?.home) || 0,
        away: Number(row?.away) || 0,
        last_synced_at: row?.last_synced_at || null,
      })
    } catch (err) {
      log.error({ msg: `svrz-status: ${err.message}`, endpoint: 'admin/terminplanung/svrz-status', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /admin/terminplanung/invites — create tokenized invites
  router.post('/admin/terminplanung/invites', async (req, res) => {
    try {
      const { kscw_team, season, rows } = req.body || {}
      if (!kscw_team || !season || !Array.isArray(rows)) {
        return res.status(400).json({ error: 'kscw_team, season, rows[] required' })
      }
      if (!(await spielplanerCanManageTeam(req, kscw_team))) return res.status(403).json({ error: 'Not authorized for this team' })
      const seasonRow = await database('game_scheduling_seasons').where('id', season).first()
      const created = []
      const existing = []
      for (const r of rows) {
        const email = (r.contact_email || '').toLowerCase().trim()
        if (!email || !r.team_name) continue
        const existingRow = await database('game_scheduling_opponents')
          .where({ kscw_team, season, contact_email: email })
          .whereIn('status', ACTIVE_INVITE_STATUSES)
          .first()
        if (existingRow) {
          existing.push({ id: existingRow.id, token: existingRow.token, email, team_name: existingRow.team_name })
          continue
        }
        const token = crypto.randomBytes(16).toString('hex')
        const expiresAt = newInviteExpiry(seasonRow?.season)
        const inserted = await database('game_scheduling_opponents').insert({
          kscw_team, season, team_name: r.team_name, contact_email: email,
          contact_name: r.contact_name || '', token, status: 'invited',
          source: r.source || 'manual', created_by_admin: true, expires_at: expiresAt,
        }).returning(['id'])
        const newId = Array.isArray(inserted) ? (inserted[0]?.id ?? inserted[0]) : inserted
        created.push({ id: newId, token, email, team_name: r.team_name })
      }
      res.json({ created: created.length, existing: existing.length, rows: [...created, ...existing] })
    } catch (err) {
      log.error({ msg: `invites create: ${err.message}`, endpoint: 'admin/terminplanung/invites', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // GET /admin/terminplanung/invites?kscw_team=&season= — list invites
  router.get('/admin/terminplanung/invites', async (req, res) => {
    try {
      const { kscw_team, season } = req.query
      if (!kscw_team) return res.status(400).json({ error: 'kscw_team required' })
      if (!(await spielplanerCanManageTeam(req, kscw_team))) return res.status(403).json({ error: 'Not authorized for this team' })
      const q = database('game_scheduling_opponents').where('kscw_team', kscw_team)
      if (season) q.where('season', season)
      const invites = await q.orderBy('date_created', 'desc')
      res.json({ data: invites })
    } catch (err) {
      log.error({ msg: `invites list: ${err.message}`, endpoint: 'admin/terminplanung/invites', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /admin/terminplanung/invites/:id/reissue — new token + reset lifecycle
  router.post('/admin/terminplanung/invites/:id/reissue', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10)
      if (!id) return res.status(400).json({ error: 'invalid id' })
      const opp = await database('game_scheduling_opponents').where('id', id).first()
      if (!opp) return res.status(404).json({ error: 'not found' })
      if (!(await spielplanerCanManageTeam(req, opp.kscw_team))) return res.status(403).json({ error: 'Not authorized for this team' })
      const seasonRow = opp.season ? await database('game_scheduling_seasons').where('id', opp.season).first() : null
      const token = crypto.randomBytes(16).toString('hex')
      const expiresAt = newInviteExpiry(seasonRow?.season)
      await database('game_scheduling_opponents')
        .where('id', id)
        .update({ token, status: 'invited', first_viewed_at: null, expires_at: expiresAt })
      res.json({ success: true, expires_at: expiresAt })
    } catch (err) {
      log.error({ msg: `invites reissue: ${err.message}`, endpoint: 'admin/terminplanung/invites/:id/reissue', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /admin/terminplanung/invites/:id/revoke — disable token
  router.post('/admin/terminplanung/invites/:id/revoke', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10)
      if (!id) return res.status(400).json({ error: 'invalid id' })
      const opp = await database('game_scheduling_opponents').where('id', id).first()
      if (!opp) return res.status(404).json({ error: 'not found' })
      if (!(await spielplanerCanManageTeam(req, opp.kscw_team))) return res.status(403).json({ error: 'Not authorized for this team' })
      await database('game_scheduling_opponents')
        .where('id', id).update({ status: 'revoked' })
      res.json({ success: true })
    } catch (err) {
      log.error({ msg: `invites revoke: ${err.message}`, endpoint: 'admin/terminplanung/invites/:id/revoke', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /admin/terminplanung/invites/:id/mark-sent — flag that the invite email
  // was sent outside the bulk flow (the per-card "Draft email" mailto opens the
  // admin's mail client, which the app can't observe). Stamps email_sent_at so
  // the list flips from "Not sent" to "Invited". Idempotent; never touches the
  // lifecycle status.
  router.post('/admin/terminplanung/invites/:id/mark-sent', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10)
      if (!id) return res.status(400).json({ error: 'invalid id' })
      const opp = await database('game_scheduling_opponents').where('id', id).first()
      if (!opp) return res.status(404).json({ error: 'not found' })
      if (!(await spielplanerCanManageTeam(req, opp.kscw_team))) return res.status(403).json({ error: 'Not authorized for this team' })
      await database('game_scheduling_opponents')
        .where('id', id).update({ email_sent_at: new Date().toISOString() })
      res.json({ success: true })
    } catch (err) {
      log.error({ msg: `invites mark-sent: ${err.message}`, endpoint: 'admin/terminplanung/invites/:id/mark-sent', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /admin/terminplanung/invites/send — bulk-send (or preview) invite emails
  // for a team. Body: { ids:number[], dry_run?:bool, season_name, kscw_team_name,
  // kscw_league }. dry_run=true renders the emails WITHOUT sending, so the admin's
  // preview is byte-identical to what goes out. Emails are bilingual DE+EN (the
  // club hasn't picked a language yet) and go from the spielplanung identity;
  // contact_email may hold several addresses (parseRecipients splits them). The
  // invite link base is the env-aware FRONTEND_URL, not a client value.
  router.post('/admin/terminplanung/invites/send', async (req, res) => {
    try {
      const { ids, dry_run, season_name = '', kscw_team_name = '', kscw_league = '' } = req.body || {}
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids[] required' })
      const rows = await database('game_scheduling_opponents')
        .whereIn('id', ids)
        .whereNotIn('status', ['revoked', 'expired'])
      // Authorise against every distinct team the selected invites belong to —
      // a scoped scheduler may only send for their own team(s).
      const sendTeamIds = [...new Set(rows.map((r) => r.kscw_team))]
      for (const tId of sendTeamIds) {
        if (!(await spielplanerCanManageTeam(req, tId))) return res.status(403).json({ error: 'Not authorized for this team' })
      }
      const fmtDate = (ts) => {
        if (!ts) return ''
        const d = new Date(ts)
        if (isNaN(d.getTime())) return ''
        const p = (n) => String(n).padStart(2, '0')
        return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`
      }
      const previews = []
      const failed = []
      let sent = 0
      for (const row of rows) {
        const url = `${FRONTEND_URL}/terminplanung/${row.token}`
        const { subject, text, html } = inviteEmail({
          contact: row.contact_name || '',
          kscw: kscw_team_name,
          league: kscw_league,
          season: season_name,
          url,
          expires: fmtDate(row.expires_at),
        })
        previews.push({ id: row.id, to: row.contact_email, team_name: row.team_name, subject, html, text })
        if (!dry_run) {
          // Skip rows with no valid (sanitised) recipient — count as failed, don't
          // stamp them as sent.
          const recipients = parseRecipients(row.contact_email)
          if (!recipients || (Array.isArray(recipients) && recipients.length === 0)) {
            failed.push({ id: row.id, error: 'no valid recipient' })
            continue
          }
          try {
            // CC the club's scheduling mailbox so the spielplaner has a copy of
            // every invite that went out.
            await sendSchedulingMail(row.contact_email, subject, text, SCHEDULING_REPLY_TO, html)
            // Stamp the send so the list shows "Invited" (vs "Not sent") — never
            // touches the lifecycle status (a reminder to a viewed/booked row
            // keeps that status).
            await database('game_scheduling_opponents')
              .where('id', row.id)
              .update({ email_sent_at: new Date().toISOString() })
            sent++
          } catch (e) {
            failed.push({ id: row.id, error: e.message })
          }
        }
      }
      res.json({ previews, sent, failed, dry_run: !!dry_run })
    } catch (err) {
      log.error({ msg: `invites send: ${err.message}`, endpoint: 'admin/terminplanung/invites/send', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // GET /admin/terminplanung/invites/import-from-svrz?kscw_team=&season= — preview
  // Lists opponent clubs from synced svrz_games plus per-game Spielplanverantwortlicher
  // contacts, with fallback to the bulk svrz_spielplaner_contacts feed.
  router.get('/admin/terminplanung/invites/import-from-svrz', async (req, res) => {
    try {
      const { kscw_team, season } = req.query
      if (!kscw_team || !season) return res.status(400).json({ error: 'kscw_team, season required' })
      if (!(await spielplanerCanManageTeam(req, kscw_team))) return res.status(403).json({ error: 'Not authorized for this team' })

      const seasonRow = await database('game_scheduling_seasons').where('id', season).first()
      if (!seasonRow) return res.status(404).json({ error: 'season not found' })
      const kscwTeamRow = await database('teams').where('id', kscw_team).first()
      if (!kscwTeamRow) return res.status(404).json({ error: 'kscw_team not found' })
      const seasonUuid = seasonRow.svrz_season_uuid || process.env.SVRZ_SEASON_UUID || ''

      // 1. Pull schedulable KSCW games, then scope to THIS team. Filtering by
      // league_short alone is ambiguous — several KSCW teams share a code (H1,
      // H3 and D1 are all "2L" this season), so a club-level group previously
      // lumped every KSCW-vs-club game together and inflated the game count
      // (e.g. "VBC Wetzikon — 8 games" when H1 plays them only twice). Scope to
      // games whose KSCW side IS this exact team — SVRZ names them
      // "KSC Wiedikon <team>", matching teams.name.
      // SVRZ stores season_name as the start year ("2026" for 2026/27). Scope to
      // it so stale `waitingForApproval` fixtures from old seasons (which never
      // got approved) don't leak in and double the game count.
      // Scope to THIS team by NAME, not league. `teams.league` doesn't reliably
      // match SVRZ's `league_short`: juniors are the clear case — wiedisync stores
      // "HU20"/"DU20" but SVRZ files those games under "U20 Ligamodus", so the old
      // hard league gate silently dropped every junior fixture (0 opponents). The
      // reliable signal is the SVRZ side name, always "KSC Wiedikon <team>"
      // (suffix and all, e.g. "KSC Wiedikon HU23-1"). Pull all KSCW season games
      // and match on a normalised identity (lowercase, strip the "KSC Wiedikon"
      // prefix, drop punctuation/spacing). This scopes H1 vs H3, and the
      // same-league-code HU23 vs DU23 (both "U23", different gender), precisely —
      // and naturally yields 0 for a team with no synced fixtures (e.g. DU20,
      // which has none) instead of a garbage superset.
      const svrzSeasonName = String(seasonRow.season || '').split('/')[0].trim()
      const allGames = await database('svrz_games')
        .whereIn('status', ['open', 'waitingForApproval'])
        .where(function () {
          this.where('home_club_id', KSCW_SVRZ_CLUB_ID).orWhere('away_club_id', KSCW_SVRZ_CLUB_ID)
        })
        .modify((q) => { if (svrzSeasonName) q.where('season_name', svrzSeasonName) })
        .orderBy('starting_date_time')
      const normTeamId = (s) =>
        String(s || '').toLowerCase().trim().replace(/^ksc\s+wiedikon\s+/, '').replace(/[^a-z0-9]/g, '')
      const teamId = normTeamId(kscwTeamRow.name)
      const ourStaticId = staticIdFromTeamId(kscwTeamRow.team_id)
      const kscwSideName = (g) =>
        (String(g.home_club_id) === String(KSCW_SVRZ_CLUB_ID) ? g.home_team_name : g.away_team_name) || ''
      // Identify OUR fixtures by the stable staticTeamIdentifier (VM may rename
      // the team ahead of the SVRZ label); fall back to the name when raw lacks it.
      const isOurTeam = (g) => {
        const sid = kscwSideStaticId(g)
        if (sid != null && ourStaticId != null) return sid === ourStaticId
        return normTeamId(kscwSideName(g)) === teamId
      }
      // The SVRZ feed sometimes lists a fixture TWICE (two persistence ids, same
      // matchup + datetime) — dedupe by matchup+datetime so the game count is the
      // real one (e.g. 2 home+away, not a doubled 4).
      const seenGame = new Set()
      const games = allGames
        .filter(isOurTeam)
        .filter((g) => {
          const k = `${g.home_team_name}|${g.away_team_name}|${g.starting_date_time || ''}`
          if (seenGame.has(k)) return false
          seenGame.add(k)
          return true
        })

      // 2. Group by opponent TEAM (club id + team name). Grouping by club alone
      // merged a club's several teams into one row; keying on the opposing team
      // gives each opponent team its own invite + correct game count.
      const byClub = new Map()
      for (const g of games) {
        const isHomeKscw = String(g.home_club_id) === String(KSCW_SVRZ_CLUB_ID)
        const oppClubId = isHomeKscw ? g.away_club_id : g.home_club_id
        const oppClubName = isHomeKscw ? g.away_club_name : g.home_club_name
        const oppTeamName = isHomeKscw ? g.away_team_name : g.home_team_name
        if (!oppClubId) continue
        // Skip intra-club fixtures (e.g. H1 vs H3 — both share league "2L"): the
        // opponent is KSCW itself, never an external invite.
        if (String(oppClubId) === String(KSCW_SVRZ_CLUB_ID)) continue
        const key = `${oppClubId}::${oppTeamName || ''}`
        if (!byClub.has(key)) {
          byClub.set(key, { club_id: oppClubId, club_name: oppClubName, team_name: oppTeamName, games: [], contacts: new Map() })
        }
        byClub.get(key).games.push({ id: g.svrz_persistence_id, display_name: g.display_name, starting_date_time: g.starting_date_time, is_home_kscw: isHomeKscw })
      }

      // 3. Per-game contact lookup (primary). Fall back to bulk feed if empty.
      let jar = null
      let ctx = null
      const tryLogin = async () => {
        if (jar) return true
        try {
          const vm = await import('/directus/scripts/vm-client.mjs')
          if (!process.env.VM_USERNAME || !process.env.VM_PASSWORD) return false
          jar = await vm.vmLogin({ username: process.env.VM_USERNAME, password: process.env.VM_PASSWORD })
          ctx = await vm.csrfFromPage(jar, '/sportmanager.indoorvolleyball/game/index')
          ctx.VM_BASE = vm.VM_BASE
          ctx.UA = vm.UA
          return true
        } catch (e) {
          log.warn(`[invites import] SVRZ login failed: ${e.message}`)
          return false
        }
      }

      async function getGameContacts(gameUuid) {
        if (!(await tryLogin())) return null
        const url = `${ctx.VM_BASE}/api/sportmanager.indoorvolleyball/api%5cgame/getTeamContactInfosByGame?game=${gameUuid}`
        const headers = {
          'User-Agent': ctx.UA, Accept: '*/*', Cookie: jar.header(),
          Referer: `${ctx.VM_BASE}/sportmanager.indoorvolleyball/game/index`,
        }
        if (ctx.wuid) headers['Window-Unique-Id'] = ctx.wuid
        try {
          const r = await fetch(url, { headers })
          if (!r.ok) return null
          return await r.json()
        } catch (e) {
          log.warn(`[invites import] game contacts fetch ${gameUuid}: ${e.message}`)
          return null
        }
      }

      for (const group of byClub.values()) {
        // Primary: the synced club feed — the scheduling responsible
        // (Spielplanverantwortlicher). Match by club_id + current season START
        // YEAR ("2026"); season_uuid is NOT a reliable season key (one uuid spans
        // several seasons) and season_name varies ("2026/27" vs "2026/2027").
        // Then prefer the contact(s) responsible for THIS team's league —
        // club_league_categories is a JSON array of league codes like
        // ["2L","5L","U23"]; if none match, use ALL the club's contacts. Every
        // match is returned — the invite is one link emailed to all of them.
        const synced = await database('svrz_spielplaner_contacts')
          .where('club_id', String(group.club_id))
          .modify((q) => { if (svrzSeasonName) q.where('season_name', 'like', `${svrzSeasonName}%`) })
          .whereNotNull('contact_email')
        // Spielplaner contacts WIN; team-responsible rows (`tr:` persistence id)
        // are a FALLBACK only — used only when the club has no Spielplaner.
        const spielSynced = synced.filter((c) => !String(c.svrz_persistence_id || '').startsWith('tr:'))
        const base = spielSynced.length ? spielSynced : synced
        const league = String(kscwTeamRow.league || '').toLowerCase().replace(/\s+/g, '')
        const inLeague = (c) => {
          let cats = c.club_league_categories
          if (typeof cats === 'string') { try { cats = JSON.parse(cats) } catch { cats = [] } }
          if (!Array.isArray(cats)) return false
          return cats.some((x) => String(x).toLowerCase().replace(/\s+/g, '') === league)
        }
        const leagueMatched = league ? base.filter(inLeague) : []
        for (const c of (leagueMatched.length ? leagueMatched : base)) {
          const email = (c.contact_email || '').toLowerCase().trim()
          if (!email || group.contacts.has(email)) continue
          group.contacts.set(email, {
            name: c.contact_name || '',
            email,
            phone: c.contact_phone || '',
            source: leagueMatched.length ? 'club_league' : 'club_fallback',
          })
        }

        // Fallback: no synced scheduling contact for this club (e.g. clubs that
        // never registered a Spielplanverantwortlicher) → take the TEAM
        // responsible(s) from the game contact info (live VolleyManager). The
        // per-game feed exposes "Teamverantwortlicher" (and sometimes
        // "Spielplanverantwortlicher") — accept either. One game's contacts are
        // enough (same team across its fixtures).
        if (group.contacts.size === 0) {
          for (const g of group.games) {
            const resp = await getGameContacts(g.id)
            if (!resp) continue
            const pool = g.is_home_kscw ? (resp.teamAway || []) : (resp.teamHome || [])
            for (const c of pool) {
              const title = c.addressOrganisationMemberFunctionTitle || ''
              if (!/spielplan|teamverantwort/i.test(title)) continue
              const email = (c.primaryEmailAddress || '').toLowerCase().trim()
              if (!email || group.contacts.has(email)) continue
              group.contacts.set(email, {
                name: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
                email,
                phone: c.primaryPhoneNumber || '',
                source: 'team_responsible',
              })
            }
            if (group.contacts.size) break
          }
        }
      }

      const opponents = [...byClub.values()].map((g) => {
        const contacts = [...g.contacts.values()]
        return {
          club_id: g.club_id,
          club_name: g.club_name,
          team_name: g.team_name,
          game_count: g.games.length,
          games: g.games.map((x) => ({ date: x.starting_date_time, display_name: x.display_name, is_home_kscw: x.is_home_kscw })),
          contacts,
          warning: contacts.length === 0 ? 'no_contact' : undefined,
          source: contacts.length === 0 ? 'none' : contacts[0].source,
        }
      })

      res.json({
        season: seasonRow.season,
        season_uuid: seasonUuid || null,
        kscw_team: { id: kscwTeamRow.id, name: kscwTeamRow.name, league: kscwTeamRow.league },
        opponents,
        total_games_matched: games.length,
      })
    } catch (err) {
      log.error({ msg: `import-from-svrz: ${err.message}`, endpoint: 'admin/terminplanung/invites/import-from-svrz', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // Resolve a KSCW team's external opponents for a season from ALREADY-SYNCED
  // SVRZ data (svrz_games + bulk svrz_spielplaner_contacts) — no live login.
  // Shared by svrz-clubs (auto-fill drafts) and ensure-from-svrz (auto-create
  // invites). Returns [{ club_id, club_name, team_name, game_count, games[],
  // suggested_contacts[] }] sorted by club name.
  async function resolveSyncedOpponents(seasonRow, kscwTeamRow) {
    // All KSCW schedulable games this season, then keep the ones for THIS team
    // by matching the KSCW-side team name. SVRZ labels our teams "KSC Wiedikon
    // H3" etc., so the name reliably identifies the team. League-string matching
    // is unreliable (verbose teams.league vs SVRZ "3L" codes) and would conflate
    // same-league teams (e.g. D2 & D3 are both 3L). Naming caveat: teams whose
    // SVRZ label differs from teams.name (e.g. U23 → "KSC Wiedikon 1") won't match.
    // CRITICAL: scope to the CURRENT season (start year, e.g. "2026"). svrz_games
    // keeps fixtures going back years, and old seasons can still sit at
    // 'waitingForApproval' — without this filter a team's opponents balloon
    // (e.g. H1 = 8 this season + a stale 2020 batch = 17). Mirrors import-from-svrz.
    const svrzSeasonName = String(seasonRow.season || '').split('/')[0].trim()
    const games = await database('svrz_games')
      .whereIn('status', ['open', 'waitingForApproval'])
      .where(function () {
        this.where('home_club_id', KSCW_SVRZ_CLUB_ID).orWhere('away_club_id', KSCW_SVRZ_CLUB_ID)
      })
      .modify((q) => { if (svrzSeasonName) q.where('season_name', svrzSeasonName) })
      // Same deterministic order as opponentSvrzFixtures — the placeholder
      // starting_date_time is identical across unscheduled fixtures, so the id
      // tiebreak keeps "first fixture of a side" consistent everywhere.
      .orderBy([
        { column: 'starting_date_time', order: 'asc' },
        { column: 'svrz_persistence_id', order: 'asc' },
      ])

    const wantName = `ksc wiedikon ${String(kscwTeamRow.name || '').trim().toLowerCase()}`
    const ourStaticId = staticIdFromTeamId(kscwTeamRow.team_id)
    const byClub = new Map()
    for (const g of games) {
      const isHomeKscw = String(g.home_club_id) === String(KSCW_SVRZ_CLUB_ID)
      // Prefer the stable staticTeamIdentifier (VM may rename our team ahead of
      // the SVRZ label); fall back to the name when raw lacks the id.
      const sid = kscwSideStaticId(g)
      const matchesOurTeam = (sid != null && ourStaticId != null)
        ? sid === ourStaticId
        : String((isHomeKscw ? g.home_team_name : g.away_team_name) || '').trim().toLowerCase() === wantName
      if (!matchesOurTeam) continue
      const clubId = isHomeKscw ? g.away_club_id : g.home_club_id
      const clubName = isHomeKscw ? g.away_club_name : g.home_club_name
      const teamName = isHomeKscw ? g.away_team_name : g.home_team_name
      if (!clubId) continue
      // Skip intra-club fixtures (e.g. H1 vs H3, both "2L") — the opponent is
      // KSCW itself, never an external invite.
      if (String(clubId) === String(KSCW_SVRZ_CLUB_ID)) continue
      // Key by club id + opponent TEAM name so a club's two teams in our group get
      // their own invite each (keying by club alone merged them). Contacts are
      // still looked up per club_id (kept on the entry). Mirrors import-from-svrz.
      const key = `${clubId}::${teamName || ''}`
      if (!byClub.has(key)) byClub.set(key, { club_id: clubId, club_name: clubName, team_name: teamName, game_count: 0, games: [] })
      const entry = byClub.get(key)
      entry.game_count++
      entry.games.push({
        svrz_game_id: g.svrz_persistence_id || null,
        date: g.starting_date_time || null,
        display_name: g.display_name || null,
        is_home_kscw: isHomeKscw,
      })
    }

    // Contact suggestions from the bulk feed only — no live per-game fetch.
    // Match by season START YEAR ("2026%"), NOT season_uuid: SVRZ issues several
    // uuids for the same season and the bulk feed often syncs under a different
    // uuid than game_scheduling_seasons.svrz_season_uuid, so a uuid match silently
    // returns ~nothing (prod: 1/27 opponents vs 26/27 by name). Mirrors the
    // start-year LIKE that import-from-svrz already uses. (svrzSeasonName is
    // already computed above for the games filter.)
    const clubIds = [...new Set([...byClub.values()].map((c) => c.club_id))]
    const contactsByClub = new Map()
    if (svrzSeasonName && clubIds.length) {
      const bulk = await database('svrz_spielplaner_contacts')
        .whereIn('club_id', clubIds)
        .where('season_name', 'like', `${svrzSeasonName}%`)
      // Spielplaner contacts WIN; the team-responsible rows (synthetic
      // svrz_persistence_id `tr:…`) are a FALLBACK only — used only for a club
      // that has no Spielplanverantwortlicher at all. So bucket per club and
      // pick the Spielplaner set when present, else the team-responsible set.
      const spiel = new Map() // club_id -> Map(email -> contact)
      const team = new Map()
      for (const c of bulk) {
        const email = (c.contact_email || '').toLowerCase().trim()
        if (!email) continue
        const isTeamResp = String(c.svrz_persistence_id || '').startsWith('tr:')
        const bucket = isTeamResp ? team : spiel
        if (!bucket.has(c.club_id)) bucket.set(c.club_id, new Map())
        const m = bucket.get(c.club_id)
        if (!m.has(email)) m.set(email, { name: c.contact_name || '', email, phone: c.contact_phone || '' })
      }
      for (const cid of clubIds) {
        const chosen = (spiel.get(cid)?.size ? spiel.get(cid) : team.get(cid))
        if (chosen?.size) contactsByClub.set(cid, chosen)
      }
    }

    return [...byClub.values()]
      .map((c) => ({ ...c, suggested_contacts: [...(contactsByClub.get(c.club_id)?.values() || [])] }))
      .sort((a, b) => (a.club_name || '').localeCompare(b.club_name || ''))
  }

  // GET /admin/terminplanung/invites/svrz-clubs?kscw_team=&season= — fast list of
  // the clubs in this team's league for the semi-manual invite flow. Unlike
  // import-from-svrz this does NO live SVRZ login: the club list comes straight
  // from synced svrz_games (KSCW-scoped, league-filtered → in a round-robin league
  // that's every other club) and contacts are only *suggestions* from the bulk
  // svrz_spielplaner_contacts feed. The admin fills in / confirms each contact.
  router.get('/admin/terminplanung/invites/svrz-clubs', async (req, res) => {
    try {
      const { kscw_team, season } = req.query
      if (!kscw_team || !season) return res.status(400).json({ error: 'kscw_team, season required' })
      if (!(await spielplanerCanManageTeam(req, kscw_team))) return res.status(403).json({ error: 'Not authorized for this team' })

      const seasonRow = await database('game_scheduling_seasons').where('id', season).first()
      if (!seasonRow) return res.status(404).json({ error: 'season not found' })
      const kscwTeamRow = await database('teams').where('id', kscw_team).first()
      if (!kscwTeamRow) return res.status(404).json({ error: 'kscw_team not found' })
      const seasonUuid = seasonRow.svrz_season_uuid || process.env.SVRZ_SEASON_UUID || ''

      const clubs = await resolveSyncedOpponents(seasonRow, kscwTeamRow)

      res.json({
        season: seasonRow.season,
        season_uuid: seasonUuid || null,
        kscw_team: { id: kscwTeamRow.id, name: kscwTeamRow.name, league: kscwTeamRow.league },
        clubs,
      })
    } catch (err) {
      log.error({ msg: `svrz-clubs: ${err.message}`, endpoint: 'admin/terminplanung/invites/svrz-clubs', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /admin/terminplanung/invites/ensure-from-svrz — auto-create invite links
  // for every synced opponent that has a contact email and isn't already invited,
  // so the panel's invite list populates itself once the SVRZ contacts are there.
  // Idempotent: deduped by normalised opponent team name, so re-running only adds
  // newly-appeared opponents. Opponents with NO contact are skipped (nothing to
  // email). Does NOT send anything — emailing stays a separate explicit action.
  router.post('/admin/terminplanung/invites/ensure-from-svrz', async (req, res) => {
    try {
      const { kscw_team, season } = req.body || {}
      if (!kscw_team || !season) return res.status(400).json({ error: 'kscw_team, season required' })
      if (!(await spielplanerCanManageTeam(req, kscw_team))) return res.status(403).json({ error: 'Not authorized for this team' })
      const seasonRow = await database('game_scheduling_seasons').where('id', season).first()
      if (!seasonRow) return res.status(404).json({ error: 'season not found' })
      const kscwTeamRow = await database('teams').where('id', kscw_team).first()
      if (!kscwTeamRow) return res.status(404).json({ error: 'kscw_team not found' })

      const opponents = await resolveSyncedOpponents(seasonRow, kscwTeamRow)

      // Dedupe against ALL existing rows for this team+season (any status) by
      // normalised opponent team name, so re-running never mints a second link
      // for an opponent that already has one — and a deliberately *revoked* or
      // expired invite is never silently resurrected with a fresh token. To
      // bring a revoked opponent back, the admin uses Reissue (same row, new
      // token), not auto-populate.
      const existing = await database('game_scheduling_opponents')
        .where({ kscw_team, season })
      const norm = (s) => String(s || '').trim().toLowerCase()
      const haveNames = new Set(existing.map((e) => norm(e.team_name)))

      let created = 0
      for (const opp of opponents) {
        const emails = opp.suggested_contacts.map((c) => c.email).filter(Boolean)
        if (!emails.length) continue
        const teamName = opp.team_name || opp.club_name
        if (haveNames.has(norm(teamName))) continue
        const names = opp.suggested_contacts.map((c) => c.name).filter(Boolean)
        await database('game_scheduling_opponents').insert({
          kscw_team, season, team_name: teamName,
          contact_email: emails.join(', '), contact_name: names.join(', '),
          token: crypto.randomBytes(16).toString('hex'), status: 'invited',
          source: 'svrz', created_by_admin: true, expires_at: newInviteExpiry(seasonRow.season),
        })
        haveNames.add(norm(teamName))
        created++
      }

      const invites = await database('game_scheduling_opponents')
        .where('kscw_team', kscw_team).where('season', season)
        .orderBy('date_created', 'desc')
      res.json({ created, invites })
    } catch (err) {
      log.error({ msg: `invites ensure-from-svrz: ${err.message}`, endpoint: 'admin/terminplanung/invites/ensure-from-svrz', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── Intra-club derby anchoring (Art. 27 SVRZ) ────────────────────────
  // GET /admin/terminplanung/derbies?season= — detect KSCW team pairs that share
  // a league group (an all-KSCW fixture exists in the SVRZ feed → they play each
  // other) and merge with any dates the spielplaner has fixed. Each pair carries
  // its two head-to-head legs (with the round the feed currently files them
  // under, e.g. "Runde 7" — the case Art. 27 overrides).
  router.get('/admin/terminplanung/derbies', async (req, res) => {
    if (!(await isAdminOrSpielplaner(req))) return res.status(403).json({ error: 'Admin only' })
    try {
      const { season } = req.query
      if (!season) return res.status(400).json({ error: 'season required' })
      const seasonRow = await database('game_scheduling_seasons').where('id', season).first()
      if (!seasonRow) return res.status(404).json({ error: 'season not found' })
      const boundary = rueckrundeStart(seasonRow)
      const svrzSeasonName = String(seasonRow.season || '').split('/')[0].trim()

      // All-KSCW fixtures this season (both sides our club).
      const games = await database('svrz_games')
        .whereIn('status', ['open', 'waitingForApproval'])
        .where('home_club_id', KSCW_SVRZ_CLUB_ID)
        .where('away_club_id', KSCW_SVRZ_CLUB_ID)
        .modify((q) => { if (svrzSeasonName) q.where('season_name', svrzSeasonName) })
        .orderBy('starting_date_time')

      // Map SVRZ side name → KSCW team (active volleyball teams = current season).
      const normTeamId = (s) =>
        String(s || '').toLowerCase().trim().replace(/^ksc\s+wiedikon\s+/, '').replace(/[^a-z0-9]/g, '')
      const teamRows = await database('teams')
        .where('sport', 'volleyball').where('active', true).select('id', 'name', 'team_id')
      const teamByNorm = new Map()
      const teamByStaticId = new Map()
      for (const t of teamRows) {
        teamByNorm.set(normTeamId(t.name), t)
        const sid = staticIdFromTeamId(t.team_id)
        if (sid != null) teamByStaticId.set(sid, t)
      }
      // Resolve a fixture side to a KSCW team: prefer the stable
      // staticTeamIdentifier (raw), fall back to the SVRZ name label.
      const resolveSide = (g, side, label) => {
        const sid = sideStaticId(g, side)
        if (sid != null && teamByStaticId.has(sid)) return teamByStaticId.get(sid)
        return teamByNorm.get(normTeamId(label))
      }

      const pairKey = (a, b) => `${Math.min(a, b)}:${Math.max(a, b)}`
      const stored = await database('game_scheduling_derbies').where('season', season)
        .select('id', 'team_a', 'team_b', 'leg1_svrz_id', database.raw('leg1_date::text as leg1_date'),
                'leg2_svrz_id', database.raw('leg2_date::text as leg2_date'), 'confirmed')
      const storedByKey = new Map(stored.map((s) => [pairKey(s.team_a, s.team_b), s]))

      const pairs = new Map()
      for (const g of games) {
        const homeT = resolveSide(g, 'home', g.home_team_name)
        const awayT = resolveSide(g, 'away', g.away_team_name)
        if (!homeT || !awayT || homeT.id === awayT.id) continue
        const [a, b] = homeT.id < awayT.id ? [homeT, awayT] : [awayT, homeT]
        const key = pairKey(a.id, b.id)
        if (!pairs.has(key)) pairs.set(key, { team_a: a, team_b: b, legs: [] })
        const raw = g.raw && typeof g.raw === 'object' ? g.raw : null
        // Only surface a value that actually denotes a round/matchday ("Runde N"),
        // not the league/phase label ("Männer 2. Liga" / "Vor- & Rückrunde"). The
        // numeric matchday VM shows in its own UI isn't in our stored feed, so this
        // is null for most league games and the panel simply hides the line then.
        const groupName = raw?.group?.name || ''
        const phaseName = raw?.group?.phase?.name || ''
        const round = /runde/i.test(groupName) ? groupName
          : /runde/i.test(phaseName) ? phaseName : null
        pairs.get(key).legs.push({
          svrz_id: g.svrz_persistence_id,
          display_name: g.display_name,
          home_team: { id: homeT.id, name: homeT.name },
          away_team: { id: awayT.id, name: awayT.name },
          feed_datetime: g.starting_date_time,
          round,
        })
      }

      const derbies = [...pairs.values()].map((p) => {
        const s = storedByKey.get(pairKey(p.team_a.id, p.team_b.id))
        const dateBySvrz = {}
        if (s) {
          if (s.leg1_svrz_id) dateBySvrz[s.leg1_svrz_id] = s.leg1_date
          if (s.leg2_svrz_id) dateBySvrz[s.leg2_svrz_id] = s.leg2_date
        }
        const legs = p.legs.map((lg) => {
          const date = dateBySvrz[lg.svrz_id] || null
          return { ...lg, date, half: date && boundary ? (date < boundary ? 'vorrunde' : 'rueckrunde') : null }
        })
        return {
          team_a: { id: p.team_a.id, name: p.team_a.name },
          team_b: { id: p.team_b.id, name: p.team_b.name },
          legs,
          confirmed: s?.confirmed === true,
          stored_id: s?.id ?? null,
        }
      }).sort((x, y) => (x.team_a.name || '').localeCompare(y.team_a.name || ''))

      res.json({ season: seasonRow.season, boundary, derbies })
    } catch (err) {
      log.error({ msg: `derbies GET: ${err.message}`, endpoint: 'admin/terminplanung/derbies', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /admin/terminplanung/derbies — the spielplaner fixes the two derby
  // dates. Body: { season, team_a, team_b, legs:[{svrz_id, home_team_id, date}, …×2], confirmed }.
  // Confirm requires both dates set and exactly one per half (Vor-/Rückrunde).
  router.post('/admin/terminplanung/derbies', async (req, res) => {
    if (!(await isAdminOrSpielplaner(req))) return res.status(403).json({ error: 'Admin only' })
    try {
      const { season, legs, confirmed } = req.body || {}
      let team_a = parseInt(req.body?.team_a, 10)
      let team_b = parseInt(req.body?.team_b, 10)
      if (!season || !Number.isInteger(team_a) || !Number.isInteger(team_b) || team_a === team_b) {
        return res.status(400).json({ error: 'season, team_a, team_b required' })
      }
      if (!Array.isArray(legs) || legs.length !== 2) {
        return res.status(400).json({ error: 'exactly 2 legs required' })
      }
      const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
      for (const lg of legs) {
        if (lg?.date != null && lg.date !== '' && !DATE_RE.test(String(lg.date))) {
          return res.status(400).json({ error: 'leg date must be YYYY-MM-DD' })
        }
      }
      if (team_a > team_b) { const t = team_a; team_a = team_b; team_b = t }

      const seasonRow = await database('game_scheduling_seasons').where('id', season).first()
      if (!seasonRow) return res.status(404).json({ error: 'season not found' })
      const boundary = rueckrundeStart(seasonRow)

      const wantConfirm = confirmed === true || confirmed === 'true'
      const dates = legs.map((l) => (l?.date ? String(l.date).slice(0, 10) : null))
      if (wantConfirm) {
        if (dates.some((d) => !d)) return res.status(400).json({ error: 'both_dates_required' })
        if (boundary) {
          const halves = dates.map((d) => (d < boundary ? 'v' : 'r')).sort().join('')
          if (halves !== 'rv') return res.status(400).json({ error: 'one_per_half' })
        }
      }
      const homeId = (v) => (Number.isInteger(parseInt(v, 10)) ? parseInt(v, 10) : null)

      const row = {
        season,
        team_a,
        team_b,
        leg1_svrz_id: legs[0].svrz_id || null,
        leg1_home_team: homeId(legs[0].home_team_id),
        leg1_date: dates[0],
        leg2_svrz_id: legs[1].svrz_id || null,
        leg2_home_team: homeId(legs[1].home_team_id),
        leg2_date: dates[1],
        confirmed: wantConfirm,
        date_updated: new Date().toISOString(),
        user_updated: req.accountability?.user || null,
      }
      const existing = await database('game_scheduling_derbies').where({ season, team_a, team_b }).first('id')
      if (existing) {
        await database('game_scheduling_derbies').where('id', existing.id).update(row)
      } else {
        await database('game_scheduling_derbies').insert({ ...row, user_created: req.accountability?.user || null })
      }
      res.json({ success: true, confirmed: wantConfirm })
    } catch (err) {
      log.error({ msg: `derbies POST: ${err.message}`, endpoint: 'admin/terminplanung/derbies', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // GET /kscw/admin/terminplanung/proposal-health?season_id= — live validity of
  // every pending home proposal, so the dashboard can flag rotten slots and
  // surface opponents whose all-three picks are gone (Item 3).
  router.get('/admin/terminplanung/proposal-health', async (req, res) => {
    if (!(await isAdminOrSpielplaner(req))) return res.status(403).json({ error: 'Admin only' })
    try {
      const seasonId = req.query.season_id
      if (!seasonId) return res.status(400).json({ error: 'season_id required' })
      const health = await homeProposalHealth(seasonId)
      res.json({ health })
    } catch (err) {
      log.error({ msg: `proposal-health: ${err.message}`, endpoint: 'admin/terminplanung/proposal-health', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /kscw/admin/terminplanung/request-new-slots — semi-automatic: the admin
  // confirms in the dashboard that an opponent's home proposals are all gone, and
  // this emails them (their language) to pick 3 new slots via their existing link,
  // clearing the dead pending proposal so they re-propose into a clean slate.
  // Body: { opponent_id }. Refuses if any proposal is still valid (race guard).
  router.post('/admin/terminplanung/request-new-slots', async (req, res) => {
    try {
      const opponentId = Number(req.body?.opponent_id)
      // Multi-game: booking_id scopes the re-request to ONE fixture's dead
      // proposal — the opponent's other games keep their proposals/bookings.
      const bookingId = Number(req.body?.booking_id) || null
      if (!opponentId) return res.status(400).json({ error: 'opponent_id required' })
      const opponent = await database('game_scheduling_opponents').where('id', opponentId).first()
      if (!opponent) return res.status(404).json({ error: 'Opponent not found' })
      if (!(await spielplanerCanManageTeam(req, opponent.kscw_team))) return res.status(403).json({ error: 'Not authorized for this team' })
      if (!opponent.contact_email) return res.status(400).json({ error: 'no_contact_email' })

      // Race guard: only re-request if this pending home proposal is genuinely
      // all-dead right now (a slot may have freed up since page load). Also
      // refuse when there's no pending health row at all (`mine` undefined,
      // e.g. the opponent just got confirmed) — re-requesting would wrongly
      // downgrade a booked opponent back to 'viewed'.
      const health = await homeProposalHealth(opponent.season)
      const mine = bookingId
        ? health.find((h) => Number(h.booking_id) === bookingId && h.opponent_id === opponentId)
        : health.find((h) => h.opponent_id === opponentId)
      if (!mine || !mine.all_dead) {
        return res.status(409).json({ error: 'proposals_still_valid' })
      }

      // Clear the dead pending home proposal (so chips/contention clear) and stamp
      // the re-request; reset a booked/viewed/invited opponent to 'viewed' so their
      // link still serves the propose-home flow.
      await database('game_scheduling_bookings')
        .where({ opponent: opponentId, type: 'home_slot_pick', status: 'pending' })
        .modify((q) => { if (bookingId) q.where('id', bookingId) })
        .del()
      await database('game_scheduling_opponents').where('id', opponentId).update({
        status: ['invited', 'viewed', 'booked'].includes(opponent.status) ? 'viewed' : opponent.status,
        new_slots_requested_at: new Date().toISOString(),
      })

      try {
        const team = await database('teams').where('id', opponent.kscw_team).first()
        const kscw = `KSCW ${team?.name || ''}`.trim()
        const opp = opponent.club_name || opponent.team_name || ''
        const url = `${FRONTEND_URL}/terminplanung/${opponent.token}`
        const { subject, text, html } = schedEmail(opponent.language, 'home_reproposal_request', {
          contact: opponent.contact_name || '', kscw, opp, url,
        })
        await sendSchedulingMail(opponent.contact_email, subject, text, null, html)
        const adminText = `Neue Heimspiel-Slots angefragt bei ${opp} (${kscw}) – alle bisherigen Vorschläge sind nicht mehr verfügbar.`
        await sendSchedulingMail(SCHEDULING_REPLY_TO, `Neue Slots angefragt – ${opp} (${kscw})`, adminText)
      } catch (mailErr) {
        log.warn(`request-new-slots email failed: ${mailErr.message}`)
      }

      res.json({ success: true })
    } catch (err) {
      log.error({ msg: `request-new-slots: ${err.message}`, endpoint: 'admin/terminplanung/request-new-slots', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
