/**
 * Duty-late alarm — GET/POST /kscw/games/:id/duty-late
 *
 * A coach or team-responsible of the PLAYING team (games.kscw_team) can flag an
 * assigned duty official (scorer / Täfeler / combined / referee / BB officials)
 * as "late" once they're inside the role's arrival window. Flagging:
 *   - emails the official (to) + the sport's TK (vb_admin / bb_admin, cc) + the
 *     club admin (cc),
 *   - records the report on games.duty_late_json (idempotent — one email even if
 *     the button is pressed again / reopened),
 *   - returns the official's phone/email so the coach can reach them.
 *
 * GET returns the already-flagged roles + contact for a game (in-window only),
 * so reopening the game keeps the reveal WITHOUT re-emailing anyone.
 *
 * Contact is time-gated server-side to [kickoff − arrival, kickoff + grace] and
 * scoped to the caller's OWN team — mirrors scorer-contacts.js. Member
 * hide_phone / hide_email flags are honoured. writeUserLog on every first flag
 * (raw-knex writes bypass the items audit hook — CLAUDE.md audit rule).
 *
 * Why an endpoint and not Directus permissions: the grant is "the official
 * assigned to a game MY playing team is in" — a per-game relationship that a
 * field-level policy filter can't express without the documented deep-filter
 * silent-empty trap. Authorising per-game in code keeps coaches from bulk
 * reading contacts via the items API.
 */

import { buildEmailLayout, buildAlertBox, buildInfoCard, formatDateCH } from './email-template.js'
import { writeUserLog } from './activity-log.js'

// Club admin who is cc'd on every late alarm (you). Env override, else the
// same personal inbox the hooks use for owner routing.
const DUTY_LATE_ADMIN_EMAIL = process.env.DUTY_LATE_ADMIN_EMAIL || process.env.OWNER_EMAIL || 'kontakt@kscw.ch'

// role → { assigned-member column, duty-team column, arrival minutes, sport, label }.
// arrival minutes MUST match src/utils/dateHelpers.ts DUTY_ARRIVAL_MIN.
const ROLE_DEFS = {
  scorer:            { member: 'scorer_member',            duty: 'scorer_duty_team',            arrival: 30, sport: 'volleyball', label: 'Schreiber' },
  scoreboard:        { member: 'scoreboard_member',        duty: 'scoreboard_duty_team',        arrival: 15, sport: 'volleyball', label: 'Täfeler' },
  scorer_scoreboard: { member: 'scorer_scoreboard_member', duty: 'scorer_scoreboard_duty_team', arrival: 30, sport: 'volleyball', label: 'Schreiber/Täfeler' },
  referee:           { member: 'referee_member',           duty: 'referee_duty_team',           arrival: 30, sport: 'volleyball', label: 'Schiedsrichter' },
  bb_scorer:         { member: 'bb_scorer_member',         duty: 'bb_scorer_duty_team',         arrival: 15, sport: 'basketball', label: 'Scorer' },
  bb_timekeeper:     { member: 'bb_timekeeper_member',     duty: 'bb_timekeeper_duty_team',     arrival: 15, sport: 'basketball', label: 'Zeitnehmer' },
  bb_24s_official:   { member: 'bb_24s_official',          duty: 'bb_24s_duty_team',            arrival: 15, sport: 'basketball', label: '24s-Bediener' },
}

// Alarm + contact stay available for this long AFTER kickoff (a missing official
// is still a live problem once the game should have started).
const GRACE_MS = 30 * 60 * 1000

// games.date is TZ-naive (knex may hand back a Date at UTC-midnight or a string);
// games.time is "HH:MM[:SS]". Normalise + convert to an absolute epoch, DST-safe
// (mirrors scorer-contacts.js / dateHelpers.toUtcIsoFromDatetimeLocal).
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

function inWindow(startMs, arrivalMin) {
  if (startMs == null) return false
  const now = Date.now()
  return now >= startMs - arrivalMin * 60 * 1000 && now <= startMs + GRACE_MS
}

function parseLate(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try { const o = JSON.parse(raw); return o && typeof o === 'object' ? o : {} } catch { return {} }
}

// Sport TK = the members holding the sport-admin role, with a login email.
async function sportTkEmails(database, sport) {
  const role = sport === 'basketball' ? 'bb_admin' : 'vb_admin'
  const rows = await database('members')
    .join('directus_users', 'members.user', 'directus_users.id')
    .whereNotNull('directus_users.email')
    .whereRaw('members.role::jsonb @> ?', [JSON.stringify(role)])
    .select('directus_users.email')
  return [...new Set(rows.map((r) => String(r.email).toLowerCase()))]
}

async function sendLateEmails(database, MailService, getSchema, { game, def, official, reporterName }) {
  const schema = await getSchema()
  const mail = new MailService({ schema, knex: database })

  const tk = await sportTkEmails(database, def.sport)
  const cc = [...new Set([...tk, DUTY_LATE_ADMIN_EMAIL].filter(Boolean))]
    // Don't cc the official on their own alarm if they happen to be a TK.
    .filter((e) => e !== String(official.email || '').toLowerCase())

  const officialName = `${official.first_name} ${official.last_name}`.trim()
  const kickoff = `${formatDateCH(game.date)} ${String(game.time || '').slice(0, 5)}`.trim()
  const matchup = `${game.home_team || ''} vs ${game.away_team || ''}`.trim()
  const sportKey = def.sport === 'basketball' ? 'bb' : 'vb'

  const alert = buildAlertBox(
    'warning',
    'Verspätung gemeldet · Late arrival reported',
    `${officialName} (${def.label}) wurde noch nicht in der Halle angetroffen · has not yet arrived.`,
  )
  const card = buildInfoCard([
    { label: 'Aufgabe · Duty', value: def.label, halfWidth: true },
    { label: 'Person', value: officialName, halfWidth: true },
    { label: 'Spiel · Game', value: matchup || '—' },
    { label: 'Anpfiff · Start', value: kickoff || '—', halfWidth: true },
    { label: 'Gemeldet von · Reported by', value: reporterName, halfWidth: true },
  ])
  const html = buildEmailLayout(alert + card, {
    sport: sportKey,
    title: 'Einsatz-Verspätung · Duty running late',
    subtitle: matchup || undefined,
    greeting: official.first_name ? `Hallo ${official.first_name},` : undefined,
  })
  const text = `${officialName} (${def.label}) wurde für ${matchup} (${kickoff}) als verspätet gemeldet — bitte umgehend melden.`
    + `\n\n${officialName} (${def.label}) reported late for ${matchup} (${kickoff}).`

  const to = official.email || cc[0]
  if (!to) return // nobody to notify — skip silently
  await mail.send({
    to,
    ...(cc.length ? { cc } : {}),
    subject: `⚠ Verspätung · Late: ${def.label} — ${matchup || 'Spiel'}`,
    html,
    text,
  })
}

export function registerDutyLate(router, ctx) {
  const { services, database, logger, getSchema } = ctx
  const { MailService } = services
  const log = logger.child({ endpoint: 'duty-late' })

  // Load the game + authorise: caller must be an admin, or coach / TR of the
  // game's playing team. Returns { game, memberId }.
  async function authorize(req) {
    const userId = req.accountability?.user
    if (!userId && !req.accountability?.admin) {
      const e = new Error('Authentication required'); e.status = 401; throw e
    }
    const game = await database('games').where('id', req.params.id).first()
    if (!game) { const e = new Error('Game not found'); e.status = 404; throw e }

    const m = userId ? await database('members').where('user', userId).first('id') : null
    let ledTeamIds = []
    if (m) {
      const [coachRows, trRows] = await Promise.all([
        database('teams_coaches').where('members_id', m.id).pluck('teams_id'),
        database('teams_responsibles').where('members_id', m.id).pluck('teams_id'),
      ])
      ledTeamIds = [...new Set([...coachRows, ...trRows].filter((t) => t != null).map(Number))]
    }
    const teamId = game.kscw_team != null ? Number(game.kscw_team) : null
    const authorized = !!req.accountability?.admin || (teamId != null && ledTeamIds.includes(teamId))
    if (!authorized) { const e = new Error('Forbidden'); e.status = 403; throw e }
    return { game, memberId: m?.id ?? null }
  }

  async function contactsFor(game, roles) {
    const wantIds = [...new Set(roles.map((r) => game[ROLE_DEFS[r].member]).filter((v) => v != null).map(String))]
    if (!wantIds.length) return {}
    const rows = await database('members').whereIn('id', wantIds)
      .select('id', 'phone', 'email', 'hide_phone', 'hide_email')
    const byId = {}
    for (const r of rows) byId[String(r.id)] = r
    const out = {}
    for (const role of roles) {
      const r = byId[String(game[ROLE_DEFS[role].member])]
      if (r) out[role] = { phone: r.phone || null, email: r.email || null, hide_phone: !!r.hide_phone, hide_email: !!r.hide_email }
    }
    return out
  }

  function fail(res, err, req) {
    if (err && err.status) return res.status(err.status).json({ error: err.message })
    log.error({
      msg: `duty-late: ${err?.message}`,
      endpoint: 'games/:id/duty-late',
      userId: req.accountability?.user || null,
      method: req.method,
      stack: err?.stack,
    })
    return res.status(500).json({ error: 'Internal error' })
  }

  // GET — already-flagged roles + contact (in-window only). Never emails.
  router.get('/games/:id/duty-late', async (req, res) => {
    try {
      const { game } = await authorize(req)
      const startMs = gameStartMs(game)
      const late = parseLate(game.duty_late_json)
      const reports = {}
      const liveRoles = []
      for (const [role, rep] of Object.entries(late)) {
        const def = ROLE_DEFS[role]
        if (!def || !rep) continue
        if (!inWindow(startMs, def.arrival)) continue
        reports[role] = { at: rep.at, by_name: rep.by_name }
        liveRoles.push(role)
      }
      const contacts = await contactsFor(game, liveRoles)
      res.json({ reports, contacts })
    } catch (err) { fail(res, err, req) }
  })

  // POST { role } — flag a role late (idempotent), email on first flag, reveal contact.
  router.post('/games/:id/duty-late', async (req, res) => {
    try {
      const { game, memberId } = await authorize(req)
      const role = String(req.body?.role || '')
      const def = ROLE_DEFS[role]
      if (!def) return res.status(400).json({ error: 'Invalid role' })

      const officialId = game[def.member]
      if (officialId == null) return res.status(400).json({ error: 'No official assigned for this role' })

      const startMs = gameStartMs(game)
      if (!inWindow(startMs, def.arrival)) return res.status(409).json({ error: 'Outside the reporting window' })

      const official = await database('members').where('id', officialId)
        .first('id', 'first_name', 'last_name', 'email', 'phone', 'hide_phone', 'hide_email')
      if (!official) return res.status(404).json({ error: 'Assigned official not found' })

      const late = parseLate(game.duty_late_json)
      const already = late[role]

      if (!already) {
        const reporter = memberId
          ? await database('members').where('id', memberId).first('first_name', 'last_name')
          : null
        const reporterName = reporter
          ? `${reporter.first_name} ${reporter.last_name}`.trim()
          : (req.accountability?.admin ? 'Admin' : '—')

        late[role] = { at: new Date().toISOString(), by_name: reporterName }
        await database('games').where('id', game.id).update({ duty_late_json: JSON.stringify(late) })

        await writeUserLog(database, log, {
          accountability: req.accountability,
          action: 'duty-late',
          collection: 'games',
          recordId: game.id,
          data: { role, official: officialId, official_name: `${official.first_name} ${official.last_name}`.trim() },
        })

        // Email is best-effort — a mail failure must not lose the recorded flag.
        try {
          await sendLateEmails(database, MailService, getSchema, { game, def, official, reporterName })
        } catch (e) {
          log.error({ msg: `duty-late email failed: ${e.message}`, gameId: game.id, role, stack: e.stack })
        }
      }

      const rep = late[role]
      res.json({
        report: { at: rep.at, by_name: rep.by_name },
        contact: {
          phone: official.phone || null,
          email: official.email || null,
          hide_phone: !!official.hide_phone,
          hide_email: !!official.hide_email,
        },
      })
    } catch (err) { fail(res, err, req) }
  })
}
