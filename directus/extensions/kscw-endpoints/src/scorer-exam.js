/**
 * scorer-exam.js — course participants upload their exam scoresheet themselves.
 *
 *   POST /kscw/scorer-exam/lookup   — public, Turnstile: email → MAILS an upload link
 *   POST /kscw/scorer-exam/ticket   — public, ticket-bound: what the upload page shows
 *   POST /kscw/scorer-exam/upload   — public, ticket-bound: the scoresheet bytes
 *
 * WHY A LOOKUP STEP
 * -----------------
 * The upload is anonymous — there is no login for course participants and there never
 * will be, since most of them are not KSCW members. So the REGISTRATION LIST is the
 * allowlist: you may upload iff the email you type is on a scorer course's OpnForm
 * signup list. That check needs an OpnForm round-trip (a club-wide PAT, ~300ms), which
 * we do NOT want to do while holding a 10 MB upload in flight. So lookup happens first
 * and mints a short-lived HMAC ticket naming the exact submission — mailed to the
 * registered address, see below; the upload then carries the ticket and needs no further
 * OpnForm call.
 *
 * The ticket is what binds bytes to a person. It is signed server-side and the client
 * cannot mint or edit one. It expires (TICKET_TTL_MS) so a leaked ticket is not a
 * standing credential.
 *
 * THE TICKET GOES TO THE MAILBOX, NEVER TO THE CALLER (2026-09-28 audit)
 * ----------------------------------------------------------------------
 * Until 2026-09-28 /lookup handed the ticket straight back to the browser, so knowing a
 * participant's email address — not a secret — was enough to upload in their name, and
 * the 404 for an unknown address made /lookup an enumeration oracle. Now /lookup MAILS
 * the ticket (as a link to the website's upload page) to the address on the signup and
 * answers `{ ok: true }` whatever happened — matched, unmatched, mail failed — and the
 * answer is sent BEFORE the mail, so the response time does not leak a match either.
 * The gate is therefore control of the registered mailbox.
 *
 * ⚠ Do not "improve the UX" by returning anything match-dependent from /lookup again —
 * not the ticket, not the first name, not a 404. Each of those re-opens one of the two
 * holes. The upload page gets its display data from /ticket, which requires the ticket.
 *
 * Still true: an admin looks at every scoresheet in /admin before ticking "Prüfung
 * bestanden". Treat an upload as a claim, never as proof.
 *
 * PRIVACY OF THE BYTES
 * --------------------
 * A scoresheet carries a name and is personal data. The Public file policy grants
 * /assets reads on FOLDER-LESS files only (setup-permissions.mjs — "a folder assignment
 * === private"), so every upload MUST land in SCORER_EXAM_FOLDER. A file written with
 * folder=null would be fetchable by anyone holding its id. Admins read these back
 * through /kscw/wadmin/scorer_courses/assets/:id, never /assets.
 *
 * The notification below mails that same personal data (name, email, licence) plus the
 * sheet itself to EXAM_NOTIFY_EMAILS. That is a deliberate, narrow disclosure to the club
 * mailbox that already administers these exams — do not widen the recipient list to
 * anything broader than the people who tick "Prüfung bestanden".
 *
 * NOTIFICATION
 * ------------
 * A successful upload mails EXAM_NOTIFY_EMAILS with the sheet attached. It is strictly
 * best-effort and runs after every write has committed: nothing about it may fail the
 * upload, because the participant has already been told the sheet arrived.
 */

import crypto from 'node:crypto'
import { Transform } from 'node:stream'
import { listSubmissions } from './opnform.js'
import { readManagedFile } from './storage-read.js'
import { buildEmailLayout, buildInfoCard, escHtml, formatDateCH } from './email-template.js'

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || ''

/**
 * The one mailbox that owns the Schreiber-Ausbildung: course signups, match-sheet
 * uploads, and replies to the result mail all land here.
 *
 * Exported so wadmin.js's exam-result route sets the SAME From and Reply-To — two
 * copies would drift, and the drift would only show up as a participant's reply going
 * somewhere nobody reads.
 *
 * Moved off scorerausbildung@wiedisync.kscw.ch on 2026-08-15. That address was a
 * RECIPIENT ONLY: wiedisync.kscw.ch is DMARC p=quarantine and has no SES identity, so
 * an unverified From there fails SPF and is silently quarantined at the receiver (the
 * finance@mail.kscw.ch failure mode) — which is why the result mail could only ever set
 * Reply-To. volleyball.kscw.ch has been an SES domain identity with Easy DKIM since the
 * 2026-08-12 spielplanung migration, so this box CAN be sent as: DKIM aligns with the
 * From domain and DMARC passes on DKIM alone.
 */
export const SCORER_AUSBILDUNG_EMAIL = 'scorer@volleyball.kscw.ch'

/**
 * The same box as a From header. Directus's MailService takes either a bare string
 * (which it wraps with the project name) or an object — but an object MUST carry BOTH
 * `name` and `address` or send() throws InvalidPayloadError before anything is sent.
 * Kept next to the address so the display name cannot drift away from it.
 */
export const SCORER_AUSBILDUNG_FROM = { name: 'KSCW Schreiber-Ausbildung', address: SCORER_AUSBILDUNG_EMAIL }

// Who hears that a scoresheet arrived. Until 2026-07-29 nobody did: the upload wrote a
// row and a log line and stopped there, so the only way to learn of one was to open
// /admin and notice — while the success screen has always promised the participant
// "Wir prüfen es und melden uns per E-Mail". Comma list; override per environment (set
// it empty on dev to stop test uploads mailing the club).
//
// SCORER_AUSBILDUNG_EMAIL, not the general club box: everything about the Schreiber-
// Ausbildung lands in one place, so whoever runs a course sees signups (the OpnForm
// confirmations already copy it) and match sheets in the same inbox instead of hunting
// through admin@ for the two weeks a year this matters.
const EXAM_NOTIFY_EMAILS = (process.env.SCORER_EXAM_NOTIFY_EMAILS ?? SCORER_AUSBILDUNG_EMAIL)
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

// The scoresheet review UI lives on the WEBSITE (/admin), not on wiedisync — so this is
// deliberately not FRONTEND_URL. kscw.ch is the live domain (CLAUDE.md); its own override
// exists because this link is admin-facing and has no reason to move when the
// member-facing newsletter host does.
const WEBSITE_URL = process.env.SCORER_EXAM_ADMIN_URL || 'https://kscw.ch'

// Fixed in create-scorer-course-attendance.mjs. Never write an upload without it —
// folder=null is publicly readable via /assets (see header).
export const SCORER_EXAM_FOLDER = 'd0c00002-0000-4000-8000-000000000001'

// Exported so the admin correction-upload route (wadmin.js) enforces the SAME cap and
// the SAME type allowlist. A second copy would drift, and the drift would be silent
// until an admin stored something the participant route would have refused.
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024
// 24h, not the 30 minutes of the in-browser ticket it replaced: the ticket now travels by
// email, and a participant who requests the link in the evening should still be able to
// use it after scanning the sheet the next morning. The ticket is only ever held by the
// registered mailbox, and it authorizes nothing but uploading for that one signup.
export const TICKET_TTL_MS = 24 * 60 * 60 * 1000
const TICKET_TTL_HOURS = TICKET_TTL_MS / 3600000

// Where the emailed link points. The upload page lives on the WEBSITE; dev can point it at
// a local/preview build (whose Directus must then be dev, or the ticket will not verify).
const UPLOAD_PAGE_URL = (process.env.SCORER_EXAM_PAGE_URL || 'https://kscw.ch/weiteres/schreiberkurse/pruefung')
  .replace(/[#?].*$/, '')

// Directus refuses to boot without SECRET, so this is always present in practice;
// the fallback is only for a bare unit-test import.
const TICKET_SECRET = process.env.SECRET || process.env.KEY || ''

/** Zurich calendar date as YYYY-MM-DD. Storage is ISO; only rendering is dd.mm.yyyy. */
export function zurichToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

export const normalizeEmail = (v) => String(v ?? '').trim().toLowerCase()

/**
 * Sniff the real type from the leading bytes. The client-supplied Content-Type and the
 * filename extension are both attacker-chosen, so neither may decide what we store: a
 * .pdf that is actually HTML becomes stored XSS the moment an admin opens it from the
 * admin table. Returns null when the bytes are not an allowed type.
 */
export function sniffType(buf) {
  if (!buf || buf.length < 12) return null
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  // ISO-BMFF: "ftyp" at offset 4, brand at 8.
  //
  // HEIC is deliberately NOT accepted, though iPhones shoot it: nothing downstream can
  // read it. Chrome and Firefox cannot decode HEIC, so the admin table cannot preview it
  // and the SVRZ export cannot turn it into the PDF the list ships as — it would reach
  // SVRZ as a file they likely cannot open either. Rejecting at upload tells the
  // participant while they can still do something about it. In practice iOS Safari
  // transcodes to JPEG when a photo goes through a file input, so this rarely fires.
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1')
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
  }
  return null
}

export const EXT_FOR = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/avif': 'avif',
}

export function signTicket(payload, secret = TICKET_SECRET) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${mac}`
}

/** → payload, or null when forged, malformed, or expired. */
export function verifyTicket(token, secret = TICKET_SECRET, now = Date.now()) {
  if (!secret) return null
  const parts = String(token ?? '').split('.')
  if (parts.length !== 2) return null
  const [body, mac] = parts
  const expect = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  const a = Buffer.from(mac, 'utf8')
  const b = Buffer.from(expect, 'utf8')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  let payload
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) } catch { return null }
  if (!payload || typeof payload.exp !== 'number' || now > payload.exp) return null
  return payload
}

async function verifyTurnstile(token) {
  if (!TURNSTILE_SECRET) {
    console.error('[scorer-exam] TURNSTILE_SECRET not configured — rejecting request')
    return false
  }
  const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: String(token || '') }).toString(),
  })
  return (await resp.json()).success === true
}

// Same sliding per-IP window as contact-form.js. Safe ONLY behind CF Tunnel (SECURITY.md):
// cf-connecting-ip is trustworthy there and spoofable anywhere else.
const ipAttempts = new Map()
function hit(map, key, maxAttempts, windowMs) {
  const now = Date.now()
  const a = map.get(key)
  if (a && now < a.resetAt) {
    if (a.count >= maxAttempts) return false
    a.count++
  } else {
    map.set(key, { count: 1, resetAt: now + windowMs })
  }
  if (map.size > 1000) {
    for (const [k, v] of map) { if (now > v.resetAt) map.delete(k) }
  }
  return true
}
function rateLimit(req, maxAttempts, windowMs) {
  const xff = req.headers['x-forwarded-for']
  const ip = req.headers['cf-connecting-ip']
    || (typeof xff === 'string' ? xff.split(',')[0].trim() : '')
    || req.ip || 'unknown'
  return hit(ipAttempts, ip, maxAttempts, windowMs)
}

// Per-RECIPIENT cap on link mails. /lookup now sends mail to whatever registered address
// is typed, so without this anyone could use it (slowly, per IP) to flood a participant's
// inbox. Silent: the caller still gets { ok: true } — a visible 429 here would be a match
// oracle again.
const mailsPerAddress = new Map()
const MAILS_PER_ADDRESS = 3
const MAILS_WINDOW_MS = 60 * 60 * 1000

/** Field ids for one OpnForm schema, by role. Mirrors the detection in admin.astro. */
function fieldIds(fields) {
  const where = (re, typeMatch) => fields
    .filter((f) => (typeMatch && f.type === typeMatch) || re.test(String(f.name || '')))
    .map((f) => f.id)
  return {
    email: where(/^e-?mail/i, 'email'),
    first: where(/vorname|first\s*name/i),
    last: where(/nachname|last\s*name|surname|familienname/i),
    svrz: where(/svrz/i),
  }
}

/**
 * SVRZ licence numbers are issued by someone else, so we normalize rather than validate a
 * format we do not own: keep the digits, drop the separators people type. Every licence in
 * our data is 6 digits, but the range is deliberately loose — rejecting a valid number
 * would block the upload entirely, and the number is checked by a human against the SVRZ
 * list before it means anything.
 */
export function normalizeLicence(v) {
  const digits = String(v ?? '').replace(/\D/g, '')
  return digits.length >= 4 && digits.length <= 10 ? digits : ''
}

/**
 * ⚠ An OpnForm submission carries its ANSWERS in `row.data`, keyed by field id — the row
 * itself only has { data, id, form_id, submission_id, completion_time }. Reading
 * `row[fieldId]` therefore returns undefined for every field, silently: detection still
 * finds the ids, every lookup just matches nobody, and the upload gate is shut for
 * everyone. Caught on dev against the real payload. `answersOf` is the only way in;
 * the `|| row` fallback mirrors admin.astro, which tolerates both shapes.
 */
export const answersOf = (row) => (row && row.data) || row || {}

export const pick = (row, ids) => {
  const d = answersOf(row)
  for (const id of ids) {
    const v = d[id]
    if (v != null && v !== '') return String(v)
  }
  return ''
}

/**
 * Every (slug → course) pair configured on scorer_courses. The slug set is admin-owned,
 * so an uploader can never steer us at an arbitrary OpnForm form.
 */
async function courseSlugs(database) {
  const rows = await database('scorer_courses').select('id', 'date_iso', 'form_slug_de', 'form_slug_en')
  const out = []
  for (const r of rows) {
    for (const [k, lang] of [['form_slug_de', 'de'], ['form_slug_en', 'en']]) {
      const slug = String(r[k] || '').trim()
      if (slug) out.push({ slug, lang, course: r })
    }
  }
  return out
}

/**
 * Name + email for one submission, read back from OpnForm.
 *
 * Only ever used to make the notification email readable. It is deliberately NOT folded
 * into the ticket: the ticket rides in the query string and therefore in the access log
 * (see the /upload header) and in the emailed link, and a signed blob that decodes to
 * somebody's name and address turns an accepted "it's a short-lived capability" into
 * logged PII. Also feeds /ticket's greeting.
 *
 * Same page-1/100 window as /lookup — a submission past #100 is invisible to both, so
 * this stays consistent with the gate rather than inventing a second reachability rule.
 */
export async function participantOf(slug, submissionId) {
  const listing = await listSubmissions(slug, { page: 1, perPage: 100 })
  const ids = fieldIds(listing.fields || [])
  const row = (listing.data || []).find((r) => String(r.id ?? '') === String(submissionId))
  if (!row) return null
  return {
    first: pick(row, ids.first),
    last: pick(row, ids.last),
    email: normalizeEmail(pick(row, ids.email)),
  }
}

/** The upload page, with the ticket in the FRAGMENT: a fragment is never sent to any
 *  server, so the ticket stays out of the website's access logs and Referer headers. */
export function uploadLinkFor(ticket, base = UPLOAD_PAGE_URL) {
  return `${base}#ticket=${encodeURIComponent(ticket)}`
}

/**
 * Build the "here is your upload link" mail (subject + html + text). Pure, like
 * buildExamResultMail in wadmin.js, so the copy is unit-tested exactly as it is sent.
 *
 * `links` is one entry per signup the address matched — normally one; two when someone
 * registered for both a DE and an EN course. Everything interpolated here is escaped by
 * buildEmailLayout / escHtml (firstName comes from an anonymous OpnForm answer).
 */
export function buildUploadLinkMail({ en = false, firstName = '', links = [], ttlHours = TICKET_TTL_HOURS } = {}) {
  const P = 'font-size:14px;color:#e2e8f0;line-height:1.6;margin:0 0 12px'
  const subject = en
    ? 'Your scoresheet upload link — KSC Wiedikon'
    : 'Dein Link zum Matchblatt-Upload — KSC Wiedikon'
  const intro = en
    ? 'You asked to upload your scoresheet for the scorer exam. Use the button below to open the upload page.'
    : 'Du möchtest dein Matchblatt für die Schreiber-Prüfung hochladen. Über den Button unten gelangst du zur Upload-Seite.'
  const validity = en
    ? `The link is valid for ${ttlHours} hours and only works for your registration. Don't forward it.`
    : `Der Link ist ${ttlHours} Stunden gültig und gilt nur für deine Anmeldung. Bitte leite ihn nicht weiter.`
  const notYou = en
    ? "Didn't request this? Then you can simply ignore this email."
    : 'Du hast das nicht angefordert? Dann kannst du diese E-Mail einfach ignorieren.'
  const courseLabel = (iso) => (iso
    ? (en ? `Scorer course of ${formatDateCH(iso)}` : `Schreiberkurs vom ${formatDateCH(iso)}`)
    : (en ? 'Scorer course' : 'Schreiberkurs'))

  const single = links.length === 1
  // One signup → the layout's CTA button. Several → one labelled link per course, so the
  // participant picks the course; each link carries its own ticket.
  const listHtml = single ? '' : links.map((l) => (
    `<p style="${P}"><a href="${escHtml(l.url)}" style="color:#FFC832;font-weight:600">${escHtml(courseLabel(l.courseDateIso))}</a></p>`
  )).join('')
  const html = buildEmailLayout(
    `<p style="${P}">${escHtml(intro)}</p>${listHtml}<p style="${P}">${escHtml(validity)}</p>`,
    {
      sport: 'vb',
      title: en ? 'Upload your scoresheet' : 'Matchblatt hochladen',
      subtitle: single ? courseLabel(links[0].courseDateIso) : undefined,
      greeting: firstName ? (en ? `Hi ${firstName},` : `Hallo ${firstName},`) : undefined,
      ...(single ? { ctaUrl: links[0].url, ctaLabel: en ? 'Upload scoresheet' : 'Matchblatt hochladen' } : {}),
      footerExtra: notYou,
    },
  )
  const text = [
    firstName ? (en ? `Hi ${firstName},` : `Hallo ${firstName},`) : null,
    intro,
    links.map((l) => `${courseLabel(l.courseDateIso)}:\n${l.url}`).join('\n\n'),
    validity,
    notYou,
    'KSC Wiedikon',
  ].filter(Boolean).join('\n\n')
  return { subject, html, text }
}

const fmtBytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/**
 * Mail the club that a scoresheet landed, with the sheet attached.
 *
 * ⚠ EVERY failure path in here is swallowed. By the time this runs the file is stored,
 * the attendance row is written and the participant has been told "received" — so a dead
 * OpnForm, an unreadable blob or a bounced SES call must cost a log line and nothing else.
 * Throwing would 500 a request whose work already succeeded and invite a retry that
 * re-uploads the same sheet.
 */
export async function notifyExamUpload(ctx, log, info) {
  const { database, services, getSchema } = ctx
  const { claim, course, fileId, type, replaced, uploadedOn, licence } = info
  if (!EXAM_NOTIFY_EMAILS.length) return

  // Best-effort identity: an upload with no name is still worth telling someone about.
  let who = null
  try {
    who = await participantOf(claim.s, claim.i)
  } catch (err) {
    log.warn({ msg: 'opnform lookup failed while building the upload notification', slug: claim.s, error: err.message })
  }
  const name = [who?.first, who?.last].filter(Boolean).join(' ').trim()

  // The bytes come back through AssetsService, not the disk, so this keeps working when
  // uploads move to R2. Safe to read sudo (see storage-read.js ACCESS CONTROL): fileId is
  // the id uploadOne just returned to us, never anything the caller supplied.
  let attachment = null
  try {
    const { file, bytes } = await readManagedFile(fileId, { services, getSchema, database })
    attachment = {
      filename: file.filename_download || `matchblatt-${claim.i}`,
      content: bytes,
      contentType: file.type || type,
    }
  } catch (err) {
    // A too-large or unreadable sheet must not cost the notification itself — send the
    // mail without it and let the admin open the row.
    log.warn({ msg: 'could not attach scoresheet to notification', file: fileId, error: err.message })
  }

  const rows = [
    { label: 'Name', value: name || '—' },
    { label: 'E-Mail', value: who?.email || '—' },
    { label: 'SVRZ-Lizenz', value: licence || '—', halfWidth: true },
    { label: 'Kursdatum', value: course?.date_iso ? formatDateCH(course.date_iso) : '—', halfWidth: true },
    { label: 'Hochgeladen', value: formatDateCH(uploadedOn) || uploadedOn, halfWidth: true },
    { label: 'Datei', value: attachment ? `${type} · ${fmtBytes(attachment.content.length)}` : type, halfWidth: true },
  ]

  let body = buildInfoCard(rows)
  if (replaced) {
    body += '<div style="font-size:13px;color:#fbbf24;margin-top:12px">Ersetzt ein früher hochgeladenes Matchblatt.</div>'
  }
  if (!attachment) {
    body += '<div style="font-size:13px;color:#fbbf24;margin-top:12px">Das Matchblatt konnte nicht angehängt werden — bitte im Admin öffnen.</div>'
  }

  const courseParam = course?.id != null ? `&course=${encodeURIComponent(course.id)}` : ''
  const html = buildEmailLayout(body, {
    title: 'Matchblatt eingegangen',
    subtitle: name || claim.k,
    sport: 'volleyball',
    greeting: 'Ein Kursteilnehmer hat sein Matchblatt für die Schreiber-Prüfung hochgeladen.',
    ctaUrl: `${WEBSITE_URL}/admin/?tab=scorer_courses${courseParam}`,
    ctaLabel: 'Im Admin prüfen',
    footerExtra: 'Erst nach Sichtung „Prüfung bestanden“ setzen — ein Upload ist ein Anspruch, kein Nachweis.',
  })

  try {
    const { MailService } = services
    const mail = new MailService({ schema: await getSchema(), knex: database })
    await mail.send({
      to: EXAM_NOTIFY_EMAILS.join(', '),
      subject: `Matchblatt — ${name || claim.k}${course?.date_iso ? ` — Kurs ${formatDateCH(course.date_iso)}` : ''}`,
      html,
      ...(attachment ? { attachments: [attachment] } : {}),
    })
    log.info({ msg: 'upload notification sent', sub_key: claim.k, to: EXAM_NOTIFY_EMAILS.length, attached: !!attachment })
  } catch (err) {
    log.error({ msg: `upload notification failed: ${err.message}`, sub_key: claim.k })
  }
}

export function registerScorerExam(router, ctx) {
  const { database, logger, services, getSchema } = ctx
  const log = logger.child({ endpoint: 'scorer-exam' })

  // ── email → mail the registered address an upload link ─────────────────────
  // ⚠ Every path past input validation answers the SAME `{ ok: true }`, and answers it
  // BEFORE any mail is sent: no match, a match, a dead OpnForm, a failed send and the
  // per-address mail cap must be indistinguishable to the caller (see header).
  router.post('/scorer-exam/lookup', async (req, res) => {
    let email
    try {
      email = normalizeEmail(req.body?.email)
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'invalid_email' })
      }
      if (!rateLimit(req, 8, 10 * 60 * 1000)) {
        return res.status(429).json({ error: 'rate_limited' })
      }
      if (!(await verifyTurnstile(req.body?.turnstile_token))) {
        return res.status(400).json({ error: 'captcha_failed' })
      }
      if (!TICKET_SECRET) {
        log.error({ msg: 'SECRET/KEY missing — cannot sign upload tickets' })
        return res.status(500).json({ error: 'internal' })
      }
    } catch (err) {
      log.error({ msg: `POST scorer-exam/lookup: ${err.message}`, stack: err.stack })
      return res.status(500).json({ error: 'internal' })
    }

    // The answer goes out first; everything below is invisible to the caller.
    res.json({ ok: true })

    try {
      const slugs = await courseSlugs(database)
      const matches = []
      for (const { slug, lang, course } of slugs) {
        let listing
        try {
          listing = await listSubmissions(slug, { page: 1, perPage: 100 })
        } catch (err) {
          // One dead form must not take down uploads for the other course.
          log.warn({ msg: 'opnform list failed during lookup', slug, status: err.status })
          continue
        }
        const ids = fieldIds(listing.fields || [])
        for (const row of listing.data || []) {
          if (normalizeEmail(pick(row, ids.email)) !== email) continue
          const subId = String(row.id ?? '')
          if (!subId) continue
          matches.push({
            lang,
            first_name: pick(row, ids.first).replace(/[\r\n]/g, '').trim(),
            course_date: course.date_iso || null,
            ticket: signTicket({
              k: `${slug}:${subId}`, s: slug, i: subId, exp: Date.now() + TICKET_TTL_MS,
            }),
          })
        }
      }
      if (!matches.length) {
        log.info({ msg: 'lookup: no registration for this address (no mail sent)' })
        return
      }
      if (!hit(mailsPerAddress, email, MAILS_PER_ADDRESS, MAILS_WINDOW_MS)) {
        log.warn({ msg: 'lookup: per-address mail cap reached (no mail sent)', matches: matches.length })
        return
      }

      // Language of the signup form they used (the DE and EN forms are separate slugs,
      // the same rule as the exam-result mail). One address, one mail.
      const en = matches.every((m) => m.lang === 'en')
      const { subject, html, text } = buildUploadLinkMail({
        en,
        firstName: matches.find((m) => m.first_name)?.first_name || '',
        links: matches.map((m) => ({ url: uploadLinkFor(m.ticket), courseDateIso: m.course_date })),
      })
      const { MailService } = services
      const mail = new MailService({ schema: await getSchema(), knex: database })
      // `to` is the address that MATCHED a signup (normalized, validated above), never a
      // free-typed one that didn't — that is the whole security property.
      await mail.send({
        to: email,
        from: SCORER_AUSBILDUNG_FROM,
        replyTo: SCORER_AUSBILDUNG_EMAIL,
        subject,
        html,
        text,
      })
      log.info({ msg: 'upload link mailed', matches: matches.length, en })
    } catch (err) {
      log.error({ msg: `scorer-exam/lookup mail failed: ${err.message}`, stack: err.stack })
    }
  })

  // ── what the upload page shows, for the holder of an emailed ticket ────────
  // POST with the ticket in the BODY (not the query string) so it stays out of access
  // logs. Returns only what the participant's own page needs; never the licence number.
  router.post('/scorer-exam/ticket', async (req, res) => {
    try {
      if (!rateLimit(req, 30, 10 * 60 * 1000)) {
        return res.status(429).json({ error: 'rate_limited' })
      }
      const claim = verifyTicket(req.body?.ticket)
      if (!claim) return res.status(403).json({ error: 'bad_ticket' })
      const slugs = await courseSlugs(database)
      const entry = slugs.find((s) => s.slug === claim.s)
      if (!entry) return res.status(403).json({ error: 'course_closed' })

      const row = await database('scorer_course_attendance')
        .where('sub_key', claim.k)
        .first('exam_date', 'exam_file', 'sv_license')
      // Best-effort: the greeting and the "licence on file" hint are conveniences, and a
      // dead OpnForm must not block an upload the ticket already authorizes.
      let who = null
      try {
        who = await participantOf(claim.s, claim.i)
      } catch (err) {
        log.warn({ msg: 'opnform lookup failed for ticket info', slug: claim.s, error: err.message })
      }
      res.json({
        data: {
          first_name: who?.first || '',
          course_date: entry.course.date_iso || null,
          lang: entry.lang,
          uploaded_on: (row && row.exam_file) ? row.exam_date : null,
          // ONLY the attendance row: that is what /upload treats as "known" when the
          // field is left empty. A licence typed into the signup form is not — counting
          // it here would hide the field and then 422 the upload as licence_required.
          licence_on_file: !!normalizeLicence(row && row.sv_license),
          expires_at: new Date(claim.exp).toISOString(),
        },
      })
    } catch (err) {
      log.error({ msg: `POST scorer-exam/ticket: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'internal' })
    }
  })

  // ── the bytes ──────────────────────────────────────────────────────────────
  // Raw body, not multipart: one file, no other parts, nothing to parse.
  //
  // ⚠ Ticket + filename ride in the QUERY STRING, not in headers, and that is not a
  // style choice. This Directus answers preflight with
  //   access-control-allow-headers: Content-Type, Authorization, X-Turnstile-Token
  // so any custom request header (x-exam-ticket …) is blocked by the browser before the
  // request is ever sent — while curl, which does no preflight, would sail through. The
  // query string needs no allowlist entry. If you move these into headers, add them to
  // CORS_ALLOWED_HEADERS on the VPS in the same change, or uploads break in browsers only.
  //
  // The ticket is therefore in the Directus access log. Accepted: it lives 24 hours, is
  // only ever issued to the registered mailbox, and does nothing but authorize uploads
  // for one submission.
  router.post('/scorer-exam/upload', async (req, res) => {
    try {
      const claim = verifyTicket(req.query?.ticket)
      if (!claim) return res.status(403).json({ error: 'bad_ticket' })
      if (!rateLimit(req, 12, 10 * 60 * 1000)) {
        return res.status(429).json({ error: 'rate_limited' })
      }
      if (Number(req.headers['content-length'] || 0) > UPLOAD_MAX_BYTES) {
        return res.status(413).json({ error: 'too_large' })
      }
      // The ticket proves an email matched a submission on SOME slug; re-check that the
      // slug is still one of ours, so revoking a course also revokes its tickets.
      const slugs = await courseSlugs(database)
      if (!slugs.some((s) => s.slug === claim.s)) {
        return res.status(403).json({ error: 'course_closed' })
      }

      // The SVRZ licence is what lets us actually register the exam with the SVRZ, so an
      // upload without one is only half the submission. By exam time the participant has
      // one — the e-learning account SVRZ activates for them is the same identity — so we
      // ask here, pre-filled when known, and require it only when we have nothing on file.
      // Checked BEFORE the bytes: rejecting a 10 MB upload after the fact is rude.
      const prevRow = await database('scorer_course_attendance')
        .where('sub_key', claim.k)
        .first('id', 'exam_file', 'sv_license')
      const licence = normalizeLicence(req.query?.licence)
      const knownLicence = normalizeLicence(prevRow && prevRow.sv_license)
      const typedSomething = String(req.query?.licence ?? '').trim() !== ''
      // Order matters: "abc" is a WRONG licence, not a missing one. Checking required
      // first told anyone with a typo to "enter your licence number" while they were
      // staring at the one they had just entered.
      if (typedSomething && !licence) {
        return res.status(422).json({ error: 'licence_invalid' })
      }
      if (!licence && !knownLicence) {
        return res.status(422).json({ error: 'licence_required' })
      }

      // Everything that awaits happens BEFORE the pipe starts. This is load-bearing: see
      // the error-listener note below — an async gap between `req.pipe()` and the
      // consumer is exactly when an early stream error has nobody listening.
      const { FilesService } = services
      const schema = await getSchema()
      const filesService = new FilesService({ schema, knex: database })
      const storage = (process.env.STORAGE_LOCATIONS || 'local').split(',')[0].trim()

      // ⚠ The byte counter MUST live INSIDE the pipeline. A `req.on('data')` listener
      // switches the stream to flowing mode and silently drops every chunk emitted
      // before FilesService attaches its pipe — that truncated 36 registration
      // documents in July (see identity-document.js). A Transform counts AND forwards.
      let bytes = 0
      let head = Buffer.alloc(0)
      let sniffed = null
      const capped = new Transform({
        transform(chunk, _enc, cb) {
          bytes += chunk.length
          if (bytes > UPLOAD_MAX_BYTES) {
            cb(Object.assign(new Error('too_large'), { status: 413 }))
            return
          }
          if (!sniffed) {
            head = head.length ? Buffer.concat([head, chunk]) : chunk
            if (head.length >= 12) {
              sniffed = sniffType(head)
              if (!sniffed) {
                cb(Object.assign(new Error('unsupported_type'), { status: 415 }))
                return
              }
            }
          }
          cb(null, chunk)
        },
        flush(cb) {
          // Files shorter than the sniff window never reached the check above.
          if (!sniffed) { cb(Object.assign(new Error('unsupported_type'), { status: 415 })); return }
          cb()
        },
      })

      // ⚠⚠ THIS LISTENER IS NOT OPTIONAL — IT IS WHAT KEEPS DIRECTUS ALIVE.
      // A stream that emits 'error' with no 'error' listener is an UNCAUGHT EXCEPTION in
      // Node: it does not reject the await, it kills the process. PM2 then restarts the
      // whole worker and every in-flight request across all of Directus 502s.
      //
      // This route rejects on the FIRST chunk (bad magic bytes), so the error fires the
      // instant data arrives — long before FilesService has attached its own handler. That
      // made `POST /kscw/scorer-exam/upload` with any non-PDF an unauthenticated remote
      // kill switch for the entire API. Verified on dev: "Error: unsupported_type" →
      // "App [directus:0] exited" → restart, reproducible every time.
      // (identity-document.js has the same shape but only errors past 10 MB, by which
      // point its consumer is attached — latent there, certain here.)
      //
      // Capture instead of swallow: uploadOne may reject with its own generic pipeline
      // error, and we want the real 413/415 to reach the client.
      let streamError = null
      capped.on('error', (err) => { streamError = err })
      req.on('error', (err) => capped.destroy(err))
      req.pipe(capped)

      const safeName = String(req.query?.filename || '')
        .replace(/[^A-Za-z0-9._-]/g, '')
        .slice(0, 60)
      let fileId
      try {
        fileId = await filesService.uploadOne(capped, {
          storage,
          // Provisional — `sniffed` is still null HERE. See the correction below.
          filename_download: safeName || `matchblatt-${claim.i}`,
          type: 'application/octet-stream',
          folder: SCORER_EXAM_FOLDER, // ⚠ never null — see header
          title: `Matchblatt ${claim.k}`,
        })
      } catch (err) {
        throw streamError || err
      }
      // A rejected stream that still resolved would otherwise store a truncated file.
      if (streamError) throw streamError

      // ⚠ The real type is only known AFTER the bytes have flowed — the options object
      // above is built before the Transform has seen a single chunk, so reading `sniffed`
      // there always yields null. Correct the row now, or every scoresheet is stored as
      // application/octet-stream and the admin's "open" downloads a blob the browser
      // won't preview. (Caught on dev: a real JPEG landed as octet-stream.)
      const fix = { type: sniffed }
      if (!safeName) fix.filename_download = `matchblatt-${claim.i}.${EXT_FOR[sniffed] || 'bin'}`
      await database('directus_files').where('id', fileId).update(fix)

      // Upsert the tracking row. exam_date is the upload date, by design: it is the date
      // the participant produced the scoresheet, and it is what the SVRZ Teilnehmerliste
      // prints as Prüfungsdatum. Admins can still correct it in /admin.
      const prev = prevRow
      const patch = { exam_file: fileId, exam_date: zurichToday() }
      // Only write a licence the uploader actually typed, and only when none is on file.
      // Re-writing knownLicence would silently revert an admin's correction, and a
      // ticket is a bearer credential (a forwarded mail, a shared screen) — it must not
      // be able to overwrite a licence already recorded (2026-09-28 audit).
      if (licence && !knownLicence) patch.sv_license = licence
      if (prev) {
        await database('scorer_course_attendance').where('id', prev.id).update(patch)
      } else {
        await database('scorer_course_attendance').insert({
          sub_key: claim.k, form_slug: claim.s, submission_id: claim.i, ...patch,
        })
      }
      // Re-upload replaces the LINK but keeps the superseded bytes. The ticket is a
      // bearer credential for this submission, so a replacement must never destroy
      // the previous scoresheet (2026-09-28 audit) —
      // the old file id is logged so an admin can restore it from the folder.
      if (prev?.exam_file && prev.exam_file !== fileId) {
        log.info({ msg: 'scoresheet superseded (kept)', sub_key: claim.k, previous_file: prev.exam_file, file: fileId })
      }

      log.info({ msg: 'scoresheet uploaded', sub_key: claim.k, bytes, type: sniffed })

      // Awaited, not fire-and-forget: the participant has already waited out the transfer,
      // and losing the notification to a worker restart is worse than the ~1s it adds.
      // notifyExamUpload never throws — see its header — so this cannot turn a stored
      // scoresheet into a 500.
      await notifyExamUpload(ctx, log, {
        claim,
        course: slugs.find((s) => s.slug === claim.s)?.course || null,
        fileId,
        type: sniffed,
        replaced: !!prev?.exam_file,
        uploadedOn: patch.exam_date,
        licence: knownLicence || licence,
      })

      res.json({ data: { ok: true, uploaded_on: patch.exam_date, replaced: !!prev?.exam_file } })
    } catch (err) {
      const status = err.status === 413 ? 413 : err.status === 415 ? 415 : 500
      if (status === 500) log.error({ msg: `POST scorer-exam/upload: ${err.message}`, stack: err.stack })
      if (!res.headersSent) {
        res.status(status).json({
          error: status === 413 ? 'too_large' : status === 415 ? 'unsupported_type' : 'internal',
        })
      }
    }
  })
}
