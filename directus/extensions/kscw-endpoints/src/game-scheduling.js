/**
 * Game Scheduling (Terminplanung)
 * Public: register, view slots, book home, propose away
 * Admin: generate slots, confirm away, block slot
 */

import crypto from 'crypto'
import { FRONTEND_URL } from './email-template.js'

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || ''

// Spielplanung mail identity. spielplanung.kscw.ch is SES-verified (Easy DKIM),
// so SES can send From it with DKIM-aligned DMARC. From + replies both land on
// the dedicated Migadu mailbox volleyball@spielplanung.kscw.ch. (The kscw.ch
// apex stays ClubDesk's — we never send from it.)
const SCHEDULING_FROM = 'KSC Wiedikon Spielplanung <volleyball@spielplanung.kscw.ch>'
const SCHEDULING_REPLY_TO = 'volleyball@spielplanung.kscw.ch'

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

export function registerGameScheduling(router, { database, logger, services, getSchema }) {
  const log = logger.child({ endpoint: 'game-scheduling' })

  // POST /kscw/terminplanung/register — opponent registers (public + Turnstile)
  router.post('/terminplanung/register', async (req, res) => {
    try {
      const { team_name, contact_name, contact_email, turnstile_token, kscw_team } = req.body
      if (!team_name || !contact_name || !contact_email || !kscw_team) {
        return res.status(400).json({ error: 'team_name, contact_name, contact_email, kscw_team required' })
      }
      if (!turnstile_token || !(await verifyTurnstile(turnstile_token))) {
        return res.status(400).json({ error: 'Captcha verification failed' })
      }

      const token = crypto.randomBytes(16).toString('hex')
      const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString()

      await database('game_scheduling_opponents').insert({
        team_name, contact_name, contact_email: contact_email.toLowerCase().trim(),
        token, kscw_team, status: 'active', expires_at: expiresAt,
      })

      // Send confirmation email
      try {
        const schema = await getSchema()
        const { MailService } = services
        const mail = new MailService({ schema, knex: database })
        await mail.send({
          to: contact_email,
          from: SCHEDULING_FROM,
          replyTo: SCHEDULING_REPLY_TO,
          subject: `KSC Wiedikon – Spielplanung`,
          text: `Hallo ${contact_name},\n\nDein Zugangslink zur Spielplanung:\n${FRONTEND_URL}/terminplanung/${token}\n\nDieser Link ist 30 Tage gültig.\n\nKSC Wiedikon`,
        })
      } catch (mailErr) {
        log.warn(`Scheduling email failed: ${mailErr.message}`)
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

  // GET /kscw/terminplanung/slots/:token — view available slots
  router.get('/terminplanung/slots/:token', async (req, res) => {
    try {
      // Rate limit: max 10 token lookups per 15 min per IP
      if (!rateLimit(tokenAttempts, req, 10, 15 * 60 * 1000)) {
        return res.status(429).json({ error: 'Too many requests. Try again later.' })
      }

      const opponent = await database('game_scheduling_opponents')
        .where('token', req.params.token)
        .whereIn('status', ['active', 'invited', 'viewed', 'booked'])
        .first()
      if (!opponent) return res.status(404).json({ error: 'Invalid or expired link' })
      if (opponent.expires_at && new Date() > new Date(opponent.expires_at)) {
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
        // Exclude home slots within ±1 day of an existing game.
        .whereNotExists(function () {
          this.select(database.raw('1')).from('games as g')
            .whereRaw('g.kscw_team = ?', [opponent.kscw_team])
            .whereRaw('game_scheduling_slots.date BETWEEN g.date::date - 1 AND g.date::date + 1')
        })
        // Exclude home slots where ANY player is absent — slots we OFFER are
        // strict (full squad), unlike the opponent's away proposals.
        .whereRaw(
          '(SELECT count(DISTINCT a.member) FROM absences a ' +
          'JOIN member_teams mt ON mt.member = a.member ' +
          'WHERE mt.team = ? AND (mt.guest_level = 0 OR mt.guest_level IS NULL) ' +
          "AND a.type IS DISTINCT FROM 'weekly' " +
          'AND a.start_date::date <= game_scheduling_slots.date AND a.end_date::date >= game_scheduling_slots.date ' +
          "AND (a.affects::jsonb @> '\"all\"' OR a.affects::jsonb @> '\"games\"')) < 1",
          [opponent.kscw_team],
        )
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
      const slots = slotRows.map((s) => ({
        id: s.id,
        date: ymd(s.date),
        start_time: String(s.start_time).slice(0, 5),
        end_time: String(s.end_time).slice(0, 5),
        source: s.source,
        hall_id: s.hall,
        hall_name: hallNameById[s.hall] || '',
      }))

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
      }

      const team = await database('teams').where('id', opponent.kscw_team).first()

      // Blocked away-proposal dates for this team — team events, games (±1 day)
      // and one-off PLAYER absences (guests + weekly unavailabilities don't
      // count). The opponent's calendar greys these out (mirrors the
      // propose-away rejection below).
      // Conflict dates for away proposals. Events + games(±1) are HARD blocks on
      // every proposal. Absences are graded: proposals 1 & 2 reject ANY player
      // absence; proposal 3 rejects only 3+ absent. So expose two sets — strict
      // (hard ∪ any-absence) and loose (hard ∪ 3+-absence).
      const hardSet = new Set()
      const addRange = (s, e) => {
        if (!s) return
        const d = new Date(`${s}T00:00:00Z`)
        const end = new Date(`${e || s}T00:00:00Z`)
        for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) hardSet.add(d.toISOString().slice(0, 10))
      }
      const evRows = await database('events as e')
        .join('events_teams as et', 'et.events_id', 'e.id')
        .where('et.teams_id', opponent.kscw_team)
        .select(
          database.raw("(e.start_date AT TIME ZONE 'Europe/Zurich')::date::text as s"),
          database.raw("(COALESCE(e.end_date, e.start_date) AT TIME ZONE 'Europe/Zurich')::date::text as e"),
        )
      evRows.forEach((r) => addRange(r.s, r.e))
      const gameRows = await database('games')
        .where('kscw_team', opponent.kscw_team).whereNotNull('date')
        .select(database.raw('games.date::text as d'))
      gameRows.forEach((r) => {
        const base = new Date(`${r.d}T00:00:00Z`)
        for (let off = -1; off <= 1; off++) {
          const x = new Date(base); x.setUTCDate(x.getUTCDate() + off)
          hardSet.add(x.toISOString().slice(0, 10))
        }
      })
      const absRows = await database('absences as a')
        .join('member_teams as mt', 'mt.member', 'a.member')
        .where('mt.team', opponent.kscw_team)
        .where(function () { this.where('mt.guest_level', 0).orWhereNull('mt.guest_level') })
        .whereRaw("a.type IS DISTINCT FROM 'weekly'")
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
      const strictSet = new Set(hardSet)
      const looseSet = new Set(hardSet)
      for (const [k, members] of Object.entries(absByDate)) {
        strictSet.add(k)                        // proposals 1 & 2: any absence
        if (members.size >= 3) looseSet.add(k)  // proposal 3: only 3+ absent
      }
      const blocked_away_strict = [...strictSet].sort()
      const blocked_away_loose = [...looseSet].sort()

      // SVRZ fixtures between this KSCW team and this opponent
      // Matched by opponent.team_name on home_team_name or away_team_name, filtered to games involving KSCW.
      let svrzGames = []
      if (opponent.team_name) {
        const rows = await database('svrz_games')
          .select('svrz_persistence_id', 'display_name', 'starting_date_time',
                  'home_club_id', 'home_team_name', 'away_club_id', 'away_team_name',
                  'league_short', 'status')
          .where(function () {
            this.where(function () {
              this.where('home_club_id', KSCW_SVRZ_CLUB_ID).where('away_team_name', opponent.team_name)
            }).orWhere(function () {
              this.where('away_club_id', KSCW_SVRZ_CLUB_ID).where('home_team_name', opponent.team_name)
            })
          })
          .orderBy('starting_date_time')
        svrzGames = rows.map((g) => ({
          id: g.svrz_persistence_id,
          display_name: g.display_name,
          starting_date_time: g.starting_date_time,
          is_home_kscw: g.home_club_id === KSCW_SVRZ_CLUB_ID,
          league: g.league_short,
          status: g.status,
        }))
      }

      // Season window (Sep 1 → Mar 31) so the away calendar can bound itself.
      const seasonRow = await database('game_scheduling_seasons').where('id', opponent.season).first()
      let season_window = null
      const sm = String(seasonRow?.season || '').match(/(\d{4})\D+(\d{2,4})/)
      if (sm) {
        const y1 = parseInt(sm[1], 10)
        let y2 = parseInt(sm[2], 10)
        if (y2 < 100) y2 = 2000 + y2
        season_window = { start: `${y1}-09-01`, end: `${y2}-03-31` }
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
        },
        games: svrzGames,
        slots,
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

  // POST /kscw/terminplanung/book-home/:token — book a home slot
  router.post('/terminplanung/book-home/:token', async (req, res) => {
    try {
      // Rate limit: max 10 booking attempts per 15 min per IP
      if (!rateLimit(writeAttempts, req, 10, 15 * 60 * 1000)) {
        return res.status(429).json({ error: 'Too many requests. Try again later.' })
      }

      const opponent = await database('game_scheduling_opponents')
        .where('token', req.params.token)
        .whereIn('status', ['active', 'invited', 'viewed', 'booked'])
        .first()
      if (!opponent) return res.status(404).json({ error: 'Invalid link' })

      const { slot_id } = req.body
      if (!slot_id) return res.status(400).json({ error: 'slot_id required' })

      // Run the slot reservation in a transaction with SELECT … FOR UPDATE so
      // two concurrent calls for the same slot can't both pass the
      // availability check (the original code had a TOCTOU window between the
      // existence check and the booking insert).
      // Cross-team check: the slot must belong to the same kscw_team as the
      // opponent's invite — without this, any opponent with a valid token
      // could mark slots from OTHER teams as booked, effectively sabotaging
      // their schedule.
      await database.transaction(async (trx) => {
        const slot = await trx('game_scheduling_slots').where('id', slot_id).forUpdate().first()
        if (!slot || slot.status === 'blocked' || slot.status === 'booked') {
          throw Object.assign(new Error('Slot not available'), { httpStatus: 400 })
        }
        if (slot.kscw_team !== opponent.kscw_team) {
          throw Object.assign(new Error('Slot does not belong to this team'), { httpStatus: 400 })
        }

        // Re-check event coverage at booking time: an event may have been
        // added between when the opponent loaded the slot list and clicked
        // book. Mirrors the read-time filter in /terminplanung/slots.
        const eventCover = await trx('events as e')
          .join('events_teams as et', 'et.events_id', 'e.id')
          .where('et.teams_id', opponent.kscw_team)
          .whereRaw(
            "?::date BETWEEN (e.start_date AT TIME ZONE 'Europe/Zurich')::date " +
            "AND (COALESCE(e.end_date, e.start_date) AT TIME ZONE 'Europe/Zurich')::date",
            [slot.date]
          )
          .first()
        if (eventCover) {
          throw Object.assign(new Error('Slot not available — team has an event on this date'), { httpStatus: 400 })
        }

        const existing = await trx('game_scheduling_bookings')
          .where('slot', slot_id).where('status', 'confirmed').first()
        if (existing) {
          throw Object.assign(new Error('Slot already booked'), { httpStatus: 400 })
        }

        await trx('game_scheduling_bookings').insert({
          opponent: opponent.id,
          slot: slot_id,
          type: 'home_slot_pick',
          season: slot.season,
          status: 'confirmed',
        })
        await trx('game_scheduling_slots').where('id', slot_id).update({ status: 'booked' })

        await trx('game_scheduling_opponents')
          .where('id', opponent.id)
          .whereIn('status', ['invited', 'viewed'])
          .update({ status: 'booked' })
      })

      res.json({ success: true })
    } catch (err) {
      if (err && err.httpStatus) {
        return res.status(err.httpStatus).json({ error: err.message })
      }
      log.error({ msg: `terminplanung/book-home: ${err.message}`, endpoint: 'terminplanung/book-home', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
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

      const { proposals } = req.body
      if (!Array.isArray(proposals) || proposals.length === 0 || proposals.length > 3) {
        return res.status(400).json({ error: '1-3 proposals required' })
      }

      // Schema stores up to 3 proposals as parallel columns on a single booking row
      const row = {
        opponent: opponent.id,
        type: 'away_proposal',
        status: 'pending',
      }
      // 2026-05-12 audit #22: validate date/time/location before storing or
      // later emailing. Token-flow rate-limit + auth are intact, but garbage
      // data lands in admin UI + outbound emails (HTML-rendered). Return a
      // proper 400 with the message (was throwing into the generic 500 catch).
      const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
      const TIME_RE = /^\d{2}:\d{2}(?::\d{2})?$/
      for (let i = 0; i < proposals.length; i++) {
        const p = proposals[i]
        if (!p.date || !DATE_RE.test(String(p.date))) {
          return res.status(400).json({ error: 'Each proposal needs a valid date (YYYY-MM-DD)' })
        }
        if (p.start_time && !TIME_RE.test(String(p.start_time))) {
          return res.status(400).json({ error: 'start_time must be HH:MM' })
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
        // Reject if the team already has a game that day OR the day before/after
        // (no back-to-back games).
        const gameClash = await database('games')
          .where('kscw_team', opponent.kscw_team)
          .whereRaw("games.date::date BETWEEN ?::date - 1 AND ?::date + 1", [String(p.date), String(p.date)])
          .first('games.date')
        if (gameClash) {
          return res.status(400).json({ error: `${p.date} is within a day of an existing game (${String(gameClash.date).slice(0, 10)}) — please leave at least a day's gap.` })
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
      await database('game_scheduling_bookings').insert(row)

      // Status lifecycle: away proposal transitions invited/viewed → booked
      await database('game_scheduling_opponents')
        .where('id', opponent.id)
        .whereIn('status', ['invited', 'viewed'])
        .update({ status: 'booked' })

      res.json({ success: true, proposals_count: proposals.length })
    } catch (err) {
      log.error({ msg: `terminplanung/propose-away: ${err.message}`, endpoint: 'terminplanung/propose-away', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
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
    if (!req.accountability?.admin) return res.status(403).json({ error: 'Admin only' })
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
      // season before regenerating. Booked + blocked rows are preserved.
      await database('game_scheduling_slots')
        .where('season', seasonKey).where('status', 'available').del()

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

      const teams = await database('teams')
        .where('sport', 'volleyball').where('active', true).select('id')

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
          let stdSlots = ownKwi.slice()
          if (usesDoltschi) stdSlots = stdSlots.concat(doltschiVbPool)
          let stdTag = 'hall_slot'
          if (stdSlots.length === 0) { stdSlots = spielhalleSlots; stdTag = 'spielhalle' }
          for (const hs of stdSlots) {
            const targetJsDay = (hs.day_of_week + 1) % 7
            const d = new Date(eveningWindow.start)
            while (d <= eveningWindow.end) {
              if (d.getUTCDay() === targetJsDay) {
                candidates.push({
                  date: d.toISOString().slice(0, 10), start_time: hs.start_time,
                  end_time: hs.end_time, hall: hs.hall, source: stdTag,
                })
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

      res.json({ success: true, total_created })
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
    if (!req.accountability?.admin) return res.status(403).json({ error: 'Admin only' })
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
      const chosenPlace = booking[`proposed_place_${n}`]
      if (!chosenDateTime) return res.status(400).json({ error: `Proposal ${n} is empty` })

      await database('game_scheduling_bookings').where('id', booking_id).update({
        status: 'confirmed',
        confirmed_proposal: n,
        admin_notes: admin_notes || booking.admin_notes || null,
      })

      // Email opponent (best-effort — never blocks the confirmation)
      try {
        const opponent = await database('game_scheduling_opponents').where('id', booking.opponent).first()
        if (opponent?.contact_email) {
          const schema = await getSchema()
          const { MailService } = services
          const mail = new MailService({ schema, knex: database })
          await mail.send({
            to: opponent.contact_email,
            from: SCHEDULING_FROM,
            replyTo: SCHEDULING_REPLY_TO,
            subject: 'KSC Wiedikon – Auswärtsspiel bestätigt',
            text: `Hallo ${opponent.contact_name || ''},\n\nDas Auswärtsspiel vom ${chosenDateTime}${chosenPlace ? ` (${chosenPlace})` : ''} wurde bestätigt.\n\nKSC Wiedikon`,
          })
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

      const teamsRestored = await database('teams')
        .where('sport', 'volleyball')
        .where('season', season.season)
        .where('active', false)
        .update({ active: true })

      await database('game_scheduling_seasons').where('id', seasonId).update({ status: 'closed' })

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
            // Stale per-team dashboard window — let the new season recompute its default
            row.dashboard_range_from = null
            row.dashboard_range_to = null
            // json column: pg won't accept a parsed object in a parameterised insert
            if (row.features_enabled != null && typeof row.features_enabled === 'object') {
              row.features_enabled = JSON.stringify(row.features_enabled)
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
              .map((r) => ({ member: r.member, team: map[r.team], season: toSeason, guest_level: r.guest_level }))
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
            teams_archived: teamsArchived,
            events_relinked: eventsRelinked,
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
    if (!req.accountability?.admin) return res.status(403).json({ error: 'Admin only' })
    try {
      const { slot_id, action } = req.body || {}
      if (!slot_id) return res.status(400).json({ error: 'slot_id required' })
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
    if (!req.accountability?.admin) return res.status(403).json({ error: 'Admin only' })
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

  const INVITE_TTL_DAYS = 90
  const ACTIVE_INVITE_STATUSES = ['invited', 'viewed', 'booked', 'active']
  const KSCW_SVRZ_CLUB_ID = process.env.KSCW_SVRZ_CLUB_ID || '912530'

  function newInviteExpiry() {
    return new Date(Date.now() + INVITE_TTL_DAYS * 86400000).toISOString()
  }

  // GET /admin/terminplanung/svrz-available-seasons — list seasons seen in synced data
  router.get('/admin/terminplanung/svrz-available-seasons', async (req, res) => {
    if (!req.accountability?.admin) return res.status(403).json({ error: 'Admin only' })
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

  // POST /admin/terminplanung/invites — create tokenized invites
  router.post('/admin/terminplanung/invites', async (req, res) => {
    if (!req.accountability?.admin) return res.status(403).json({ error: 'Admin only' })
    try {
      const { kscw_team, season, rows } = req.body || {}
      if (!kscw_team || !season || !Array.isArray(rows)) {
        return res.status(400).json({ error: 'kscw_team, season, rows[] required' })
      }
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
        const expiresAt = newInviteExpiry()
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
    if (!req.accountability?.admin) return res.status(403).json({ error: 'Admin only' })
    try {
      const { kscw_team, season } = req.query
      if (!kscw_team) return res.status(400).json({ error: 'kscw_team required' })
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
    if (!req.accountability?.admin) return res.status(403).json({ error: 'Admin only' })
    try {
      const id = parseInt(req.params.id, 10)
      if (!id) return res.status(400).json({ error: 'invalid id' })
      const token = crypto.randomBytes(16).toString('hex')
      const expiresAt = newInviteExpiry()
      const updated = await database('game_scheduling_opponents')
        .where('id', id)
        .update({ token, status: 'invited', first_viewed_at: null, expires_at: expiresAt })
      if (!updated) return res.status(404).json({ error: 'not found' })
      res.json({ success: true, token, expires_at: expiresAt })
    } catch (err) {
      log.error({ msg: `invites reissue: ${err.message}`, endpoint: 'admin/terminplanung/invites/:id/reissue', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /admin/terminplanung/invites/:id/revoke — disable token
  router.post('/admin/terminplanung/invites/:id/revoke', async (req, res) => {
    if (!req.accountability?.admin) return res.status(403).json({ error: 'Admin only' })
    try {
      const id = parseInt(req.params.id, 10)
      if (!id) return res.status(400).json({ error: 'invalid id' })
      const updated = await database('game_scheduling_opponents')
        .where('id', id).update({ status: 'revoked' })
      if (!updated) return res.status(404).json({ error: 'not found' })
      res.json({ success: true })
    } catch (err) {
      log.error({ msg: `invites revoke: ${err.message}`, endpoint: 'admin/terminplanung/invites/:id/revoke', userId: req.accountability?.user || null, method: req.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // GET /admin/terminplanung/invites/import-from-svrz?kscw_team=&season= — preview
  // Lists opponent clubs from synced svrz_games plus per-game Spielplanverantwortlicher
  // contacts, with fallback to the bulk svrz_spielplaner_contacts feed.
  router.get('/admin/terminplanung/invites/import-from-svrz', async (req, res) => {
    if (!req.accountability?.admin) return res.status(403).json({ error: 'Admin only' })
    try {
      const { kscw_team, season } = req.query
      if (!kscw_team || !season) return res.status(400).json({ error: 'kscw_team, season required' })

      const seasonRow = await database('game_scheduling_seasons').where('id', season).first()
      if (!seasonRow) return res.status(404).json({ error: 'season not found' })
      const kscwTeamRow = await database('teams').where('id', kscw_team).first()
      if (!kscwTeamRow) return res.status(404).json({ error: 'kscw_team not found' })
      const seasonUuid = seasonRow.svrz_season_uuid || process.env.SVRZ_SEASON_UUID || ''

      // 1. Pull schedulable KSCW games in this team's league
      const games = await database('svrz_games')
        .whereIn('status', ['open', 'waitingForApproval'])
        .where(function () {
          this.where('home_club_id', KSCW_SVRZ_CLUB_ID).orWhere('away_club_id', KSCW_SVRZ_CLUB_ID)
        })
        .andWhere(function () {
          if (kscwTeamRow.league) {
            this.where('league_short', kscwTeamRow.league).orWhere('league_name', 'like', `%${kscwTeamRow.league}%`)
          }
        })
        .orderBy('starting_date_time')

      // 2. Group by opponent club
      const byClub = new Map()
      for (const g of games) {
        const isHomeKscw = g.home_club_id === KSCW_SVRZ_CLUB_ID
        const oppClubId = isHomeKscw ? g.away_club_id : g.home_club_id
        const oppClubName = isHomeKscw ? g.away_club_name : g.home_club_name
        const oppTeamName = isHomeKscw ? g.away_team_name : g.home_team_name
        if (!oppClubId) continue
        if (!byClub.has(oppClubId)) {
          byClub.set(oppClubId, { club_id: oppClubId, club_name: oppClubName, team_name: oppTeamName, games: [], contacts: new Map() })
        }
        byClub.get(oppClubId).games.push({ id: g.svrz_persistence_id, display_name: g.display_name, starting_date_time: g.starting_date_time, is_home_kscw: isHomeKscw })
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
        // Primary: per-game contacts, union across games for this opponent
        for (const g of group.games) {
          const resp = await getGameContacts(g.id)
          if (!resp) continue
          const pool = g.is_home_kscw ? (resp.teamAway || []) : (resp.teamHome || [])
          for (const c of pool) {
            if (c.addressOrganisationMemberFunctionTitle !== 'Spielplanverantwortlicher') continue
            const email = (c.primaryEmailAddress || '').toLowerCase().trim()
            if (!email || group.contacts.has(email)) continue
            group.contacts.set(email, {
              name: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
              email,
              phone: c.primaryPhoneNumber || '',
              source: 'per_game',
            })
          }
        }
        // Fallback: club-level bulk feed
        if (group.contacts.size === 0 && seasonUuid) {
          const bulk = await database('svrz_spielplaner_contacts')
            .where({ club_id: group.club_id, season_uuid: seasonUuid })
          for (const c of bulk) {
            const email = (c.contact_email || '').toLowerCase().trim()
            if (!email || group.contacts.has(email)) continue
            group.contacts.set(email, {
              name: c.contact_name || '',
              email,
              phone: c.contact_phone || '',
              source: 'club_fallback',
            })
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
}
