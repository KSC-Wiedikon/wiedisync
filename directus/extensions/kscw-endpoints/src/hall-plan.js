/**
 * Hall plan for every member — /kscw/hallenplan/*
 *
 * GET  /hallenplan/trainings?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   Every team's trainings in the window, so the hall plan shows who is in a
 *   hall to EVERY member, not only to admins.
 *
 *   Why an endpoint: a member reads `trainings` only for their own teams
 *   (setup-permissions.mjs → MY_TEAMS_FILTER), a coach only for the teams they
 *   lead. The hall plan decides "taken or free" from those rows — a recurring
 *   hall slot with no training that week renders as a green "Free" slot
 *   (virtualSlots.ts → buildFreedRecurringSlots). So below admin, every OTHER
 *   team's weekly training showed as free, and coaches were offered it to claim.
 *   Who trains where and when is already public in `hall_slots` (MEMBER_READ_ALL);
 *   this adds the dated rows. `notes` and `cancel_reason` stay with the teams the
 *   caller already reads (member / coach / team responsible), or an admin.
 *
 * POST /hallenplan/contact  { team, hall, date, start_time, end_time, slot_type, message }
 *   A member writes to the coaches + team responsibles of the team that has a
 *   slot. The server sends it: the leaders' addresses never reach the sender,
 *   the sender's address goes out as Reply-To (the form says so). 5 per hour
 *   per member, actor in user_logs.
 */

import { buildEmailLayout, buildInfoCard, bucketEmailsByLocale, escHtml, FRONTEND_URL } from './email-template.js'
import { loadSuppressed, normaliseEmail } from './email-suppression.js'
import { writeUserLog } from './activity-log.js'

const MAX_RANGE_DAYS = 14
export const MAX_MESSAGE = 2000
export const CONTACT_LIMIT_PER_HOUR = 5
const CONTACT_ACTION = 'hall-slot-contact'
const SLOT_TYPES = ['training', 'game', 'event', 'other']

// Dev runs on a scrubbed prod clone — never mail from it unless asked to
// (same convention as duty-leader-contact.js / duty-late.js).
const IS_DEV = (process.env.PUBLIC_URL || '').includes('directus-dev')
const SEND_EMAILS = !IS_DEV || process.env.HALL_CONTACT_FORCE_EMAIL === '1'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

function httpError(status, message, code) {
  const e = new Error(message)
  e.status = status
  if (code) e.code = code
  return e
}

/** A real calendar date in YYYY-MM-DD, else null. */
export function normalizeDate(value) {
  const s = String(value ?? '').trim()
  if (!DATE_RE.test(s)) return null
  const d = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null
  return s
}

/** HH:MM from HH:MM or HH:MM:SS, else null. */
export function normalizeTime(value) {
  const s = String(value ?? '').trim()
  return TIME_RE.test(s) ? s.slice(0, 5) : null
}

/** The GET window: both dates valid, from ≤ to, at most two weeks. */
export function parseRange(from, to) {
  const f = normalizeDate(from)
  const t = normalizeDate(to)
  if (!f || !t) throw httpError(400, 'from and to must be YYYY-MM-DD dates')
  if (f > t) throw httpError(400, 'from must not be after to')
  const days = (Date.parse(`${t}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`)) / 86_400_000
  if (days > MAX_RANGE_DAYS) throw httpError(400, `At most ${MAX_RANGE_DAYS} days`)
  return { from: f, to: t }
}

/** Columns the hall plan reads (virtualSlots.ts, VirtualSlotDetailModal). */
export const TRAINING_COLUMNS = [
  'id', 'team', 'hall', 'hall_slot', 'extra_halls', 'start_time', 'end_time',
  'cancelled', 'is_trial', 'auto_shortened_by_game', 'auto_adjusted_by_booking',
  'original_start_time', 'original_end_time', 'notes', 'cancel_reason',
]

/** One training as the hall plan gets it — notes only for teams the caller reads anyway. */
export function shapeTraining(row, { ownTeamIds, isAdmin }) {
  const own = isAdmin || (row.team != null && ownTeamIds.has(String(row.team)))
  return {
    ...row,
    id: String(row.id),
    team: row.team == null ? null : String(row.team),
    hall: row.hall == null ? null : String(row.hall),
    hall_slot: row.hall_slot == null ? null : String(row.hall_slot),
    notes: own ? (row.notes ?? '') : '',
    cancel_reason: own ? (row.cancel_reason ?? '') : '',
  }
}

/** Validates the contact form. Throws a 400 with a stable code. */
export function parseContactInput(body) {
  const b = body && typeof body === 'object' ? body : {}
  const team = Number(b.team)
  if (!Number.isInteger(team) || team <= 0) throw httpError(400, 'team is required', 'bad_team')
  const hall = b.hall == null || b.hall === '' ? null : Number(b.hall)
  if (hall !== null && (!Number.isInteger(hall) || hall <= 0)) throw httpError(400, 'Invalid hall', 'bad_hall')
  const date = normalizeDate(b.date)
  if (!date) throw httpError(400, 'Invalid date', 'bad_date')
  const start = normalizeTime(b.start_time)
  const end = normalizeTime(b.end_time)
  if (!start || !end) throw httpError(400, 'Invalid time', 'bad_time')
  const slotType = SLOT_TYPES.includes(b.slot_type) ? b.slot_type : 'other'
  // CRLF normalised, other control characters dropped; tabs and newlines stay.
  const message = String(b.message ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
  if (!message) throw httpError(400, 'Message is required', 'empty_message')
  if (message.length > MAX_MESSAGE) throw httpError(400, 'Message too long', 'too_long')
  return { team, hall, date, start_time: start, end_time: end, slot_type: slotType, message }
}

const WEEKDAYS = {
  de: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
  gsw: ['Su', 'Mä', 'Zi', 'Mi', 'Du', 'Fr', 'Sa'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  fr: ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'],
  it: ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'],
}

const T = {
  de: {
    subject: (team, when) => `Hallenplan: Nachricht zu eurem Slot (${team}, ${when})`,
    title: 'Nachricht zu eurem Hallen-Slot',
    intro: (name, team) => `${name} hat dir über den Hallenplan in Wiedisync geschrieben, wegen eines Slots von ${team}. Antworte einfach auf diese E-Mail.`,
    team: 'Team', hall: 'Halle', when: 'Wann', from: 'Von', message: 'Nachricht', cta: 'Hallenplan öffnen',
    type: { training: 'Training', game: 'Spiel', event: 'Anlass', other: 'Slot' },
  },
  gsw: {
    subject: (team, when) => `Halleplan: Nachricht zu eurem Slot (${team}, ${when})`,
    title: 'Nachricht zu eurem Halle-Slot',
    intro: (name, team) => `${name} hät dir über de Halleplan i Wiedisync gschribe, wäge eme Slot vo ${team}. Antwort eifach uf die E-Mail.`,
    team: 'Team', hall: 'Halle', when: 'Wänn', from: 'Vo', message: 'Nachricht', cta: 'Halleplan uftue',
    type: { training: 'Training', game: 'Match', event: 'Aalass', other: 'Slot' },
  },
  en: {
    subject: (team, when) => `Hall plan: a message about your slot (${team}, ${when})`,
    title: 'A message about your hall slot',
    intro: (name, team) => `${name} wrote to you from the Wiedisync hall plan about a slot of ${team}. Just reply to this email.`,
    team: 'Team', hall: 'Hall', when: 'When', from: 'From', message: 'Message', cta: 'Open the hall plan',
    type: { training: 'Training', game: 'Game', event: 'Event', other: 'Slot' },
  },
  fr: {
    subject: (team, when) => `Plan de salle : un message sur ton créneau (${team}, ${when})`,
    title: 'Un message sur ton créneau de salle',
    intro: (name, team) => `${name} t'a écrit depuis le plan de salle de Wiedisync au sujet d'un créneau de ${team}. Réponds simplement à cet e-mail.`,
    team: 'Équipe', hall: 'Salle', when: 'Quand', from: 'De', message: 'Message', cta: 'Ouvrir le plan de salle',
    type: { training: 'Entraînement', game: 'Match', event: 'Événement', other: 'Créneau' },
  },
  it: {
    subject: (team, when) => `Piano palestra: un messaggio sul tuo slot (${team}, ${when})`,
    title: 'Un messaggio sul tuo slot in palestra',
    intro: (name, team) => `${name} ti ha scritto dal piano palestra di Wiedisync per uno slot di ${team}. Rispondi semplicemente a questa e-mail.`,
    team: 'Squadra', hall: 'Palestra', when: 'Quando', from: 'Da', message: 'Messaggio', cta: 'Apri il piano palestra',
    type: { training: 'Allenamento', game: 'Partita', event: 'Evento', other: 'Slot' },
  },
}
export const CONTACT_LOCALES = Object.keys(T)

/** "Fr 20.11.2026, 20:00–22:00" in the recipient's language. */
export function formatWhen(locale, date, start, end) {
  const [y, m, d] = date.split('-')
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay()
  const days = WEEKDAYS[locale] || WEEKDAYS.de
  return `${days[dow]} ${d}.${m}.${y}, ${start}–${end}`
}

/** Subject, text and HTML of the mail one locale bucket gets. */
export function buildContactEmail(locale, { senderName, senderEmail, teamName, hallName, date, start, end, slotType, message, sport }) {
  const tt = T[locale] || T.de
  const when = formatWhen(locale, date, start, end)
  const kind = tt.type[slotType] || tt.type.other
  const url = `${FRONTEND_URL}/calendar/hall`
  const from = `${senderName} <${senderEmail}>`
  const rows = [
    { label: tt.team, value: teamName, halfWidth: true },
    { label: tt.hall, value: hallName || '—', halfWidth: true },
    { label: tt.when, value: `${kind} · ${when}` },
    { label: tt.from, value: from },
  ]
  const messageHtml = `<div style="margin-top:16px;font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.5px;margin-bottom:6px">${escHtml(tt.message)}</div>`
    + `<div style="font-size:14px;line-height:1.5;color:#e2e8f0;white-space:pre-wrap">${escHtml(message)}</div>`
  const introHtml = `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#cbd5e1">${escHtml(tt.intro(senderName, teamName))}</p>`
  const html = buildEmailLayout(introHtml + buildInfoCard(rows) + messageHtml, {
    sport: sport === 'basketball' ? 'bb' : sport === 'volleyball' ? 'vb' : undefined,
    title: tt.title,
    subtitle: teamName,
    ctaUrl: url,
    ctaLabel: tt.cta,
  })
  const text = `${tt.intro(senderName, teamName)}\n\n`
    + `${tt.team}: ${teamName}\n${tt.hall}: ${hallName || '—'}\n${tt.when}: ${kind} · ${when}\n${tt.from}: ${from}\n\n`
    + `${tt.message}:\n${message}\n\n${url}`
  return { subject: tt.subject(teamName, when), text, html }
}

/** Team ids whose training notes the caller reads anyway: member, coach, team responsible. */
async function ownTeamIdsOf(database, memberId) {
  if (memberId == null) return new Set()
  const [rosters, coaches, responsibles] = await Promise.all([
    database('member_teams').where('member', memberId).pluck('team'),
    database('teams_coaches').where('members_id', memberId).pluck('teams_id'),
    database('teams_responsibles').where('members_id', memberId).pluck('teams_id'),
  ])
  return new Set([...rosters, ...coaches, ...responsibles].filter((id) => id != null).map(String))
}

/** Coaches + team responsibles of a team who have an address, without the sender. */
async function leaderRecipients(database, teamId, senderMemberId) {
  const [coachIds, trIds] = await Promise.all([
    database('teams_coaches').where('teams_id', teamId).pluck('members_id'),
    database('teams_responsibles').where('teams_id', teamId).pluck('members_id'),
  ])
  const ids = [...new Set([...coachIds, ...trIds].filter((id) => id != null).map(Number))]
    .filter((id) => id !== Number(senderMemberId))
  if (!ids.length) return []
  const rows = await database('members').whereIn('id', ids).whereNotNull('email').select('id', 'email')
  const byEmail = new Map()
  for (const r of rows) {
    const email = normaliseEmail(r.email)
    if (email && !byEmail.has(email)) byEmail.set(email, Number(r.id))
  }
  const suppressed = await loadSuppressed(database, [...byEmail.keys()])
  return [...byEmail].filter(([email]) => !suppressed.has(email)).map(([email, id]) => ({ id, email }))
}

export function registerHallPlan(router, ctx) {
  const { services, database, logger, getSchema } = ctx
  const { MailService } = services
  const log = logger.child({ endpoint: 'hall-plan' })

  function fail(res, err, req, endpoint) {
    if (err && err.status) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) })
    log.error({
      msg: `hall-plan: ${err?.message}`,
      endpoint,
      userId: req.accountability?.user || null,
      method: req.method,
      stack: err?.stack,
    })
    return res.status(500).json({ error: 'Internal error' })
  }

  async function callerMember(req) {
    const userId = req.accountability?.user
    if (!userId) throw httpError(401, 'Authentication required')
    return database('members').where('user', userId).first('id', 'first_name', 'last_name', 'email')
  }

  router.get('/hallenplan/trainings', async (req, res) => {
    try {
      const isAdmin = req.accountability?.admin === true
      const member = await callerMember(req)
      const { from, to } = parseRange(req.query.from, req.query.to)
      const ownTeamIds = isAdmin ? new Set() : await ownTeamIdsOf(database, member?.id ?? null)
      const rows = await database('trainings')
        .whereBetween('date', [from, to])
        .orderBy([{ column: 'date' }, { column: 'start_time' }])
        // `date` through to_char: knex/pg hands a DATE back as a JS Date at
        // local midnight, which serialises a day early in UTC.
        .select(...TRAINING_COLUMNS, database.raw(`to_char(date, 'YYYY-MM-DD') as date`))
      res.json({ data: rows.map((r) => shapeTraining(r, { ownTeamIds, isAdmin })) })
    } catch (err) { fail(res, err, req, 'hallenplan/trainings') }
  })

  router.post('/hallenplan/contact', async (req, res) => {
    try {
      const member = await callerMember(req)
      if (!member) throw httpError(403, 'Only members can write to a team', 'no_member')
      const senderEmail = normaliseEmail(member.email)
      if (!senderEmail) throw httpError(409, 'Your profile has no email address', 'no_sender_email')
      const input = parseContactInput(req.body)

      const team = await database('teams').where('id', input.team).first('id', 'name', 'full_name', 'sport', 'active')
      if (!team || team.active === false) throw httpError(404, 'Team not found', 'bad_team')

      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const recent = await database('user_logs')
        .where({ action: CONTACT_ACTION, user: member.id })
        .where('date_created', '>', since)
        .count({ n: '*' })
        .first()
      if (Number(recent?.n || 0) >= CONTACT_LIMIT_PER_HOUR) {
        throw httpError(429, 'Too many messages, try again in an hour', 'rate_limited')
      }

      const recipients = await leaderRecipients(database, team.id, member.id)
      if (!recipients.length) throw httpError(409, 'This team has no coach or team responsible with an email address', 'no_recipients')

      const hall = input.hall != null ? await database('halls').where('id', input.hall).first('name') : null
      const senderName = `${member.first_name || ''} ${member.last_name || ''}`.trim() || senderEmail
      const teamName = team.name || team.full_name || `#${team.id}`

      if (SEND_EMAILS) {
        const schema = await getSchema()
        const mail = new MailService({ schema, knex: database })
        const buckets = await bucketEmailsByLocale(database, recipients.map((r) => r.email))
        for (const locale of CONTACT_LOCALES) {
          const to = buckets[locale] || []
          if (!to.length) continue
          const { subject, text, html } = buildContactEmail(locale, {
            senderName, senderEmail, teamName, hallName: hall?.name || '',
            date: input.date, start: input.start_time, end: input.end_time,
            slotType: input.slot_type, message: input.message, sport: team.sport,
          })
          // From is the no-reply sender; the answer goes straight to the member.
          // senderEmail comes from their own members row, not from the request.
          await mail.send({ to: to.join(','), replyTo: senderEmail, subject, text, html })
        }
      } else {
        log.info({ msg: 'hall-plan contact: email suppressed (dev)', team: team.id, recipients: recipients.length })
      }

      // Logged after the send, so a failed send does not use up the hourly allowance.
      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: CONTACT_ACTION,
        collection: 'teams',
        recordId: team.id,
        data: {
          hall: input.hall, date: input.date, start_time: input.start_time, end_time: input.end_time,
          slot_type: input.slot_type, recipients: recipients.map((r) => r.id), suppressed: !SEND_EMAILS,
        },
      })

      res.json({ sent: recipients.length, suppressed: !SEND_EMAILS })
    } catch (err) { fail(res, err, req, 'hallenplan/contact') }
  })
}
