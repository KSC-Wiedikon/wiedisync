/**
 * Shared KSCW branded email template builder
 * Matches the PB email_template_lib.js dark-mode design
 */

const ACCENT = { vb: '#FFC832', bb: '#F97316', neutral: '#4A55A2' }

/** Escape HTML special characters to prevent injection in email templates */
export function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Frontend URL — env var or auto-detect from Directus PUBLIC_URL */
export const FRONTEND_URL = process.env.FRONTEND_URL
  || (process.env.PUBLIC_URL?.includes('directus-dev') ? 'https://wiedisync.pages.dev' : 'https://wiedisync.kscw.ch')

const LOGO_URL = `${FRONTEND_URL}/wiedisync_logo.svg`

const VB_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="44" height="44" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="10" fill="#FFC832" stroke="#4A55A2" stroke-width="1.5"/>' +
  '<path d="M11.1 7.1a16.55 16.55 0 0 1 10.9 4" stroke="#4A55A2" stroke-width="1.5"/>' +
  '<path d="M12 12a12.6 12.6 0 0 1-8.7 5" stroke="#4A55A2" stroke-width="1.5"/>' +
  '<path d="M16.8 13.6a16.55 16.55 0 0 1-9 7.5" stroke="#4A55A2" stroke-width="1.5"/>' +
  '<path d="M20.7 17a12.8 12.8 0 0 0-8.7-5 13.3 13.3 0 0 1 0-10" stroke="#4A55A2" stroke-width="1.5"/>' +
  '<path d="M6.3 3.8a16.55 16.55 0 0 0 1.9 11.5" stroke="#4A55A2" stroke-width="1.5"/>' +
  '</svg>'

const BB_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="#1a1a1a" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="10" fill="#F97316"/>' +
  '<path d="M4.93 4.93c4.08 2.64 8.74 3.2 14.14 0"/>' +
  '<path d="M4.93 19.07c4.08-2.64 8.74-3.2 14.14 0"/>' +
  '<line x1="12" y1="2" x2="12" y2="22"/>' +
  '<line x1="2" y1="12" x2="22" y2="12"/>' +
  '</svg>'

function sportIcon(sport) {
  if (sport === 'bb' || sport === 'basketball') return BB_ICON
  if (sport === 'vb' || sport === 'volleyball') return VB_ICON
  return ''
}

function accentColor(sport) {
  if (sport === 'bb' || sport === 'basketball') return ACCENT.bb
  if (sport === 'vb' || sport === 'volleyball') return ACCENT.vb
  return ACCENT.neutral
}

/**
 * Build an info card with label/value rows
 * @param {Array<{label: string, value: string, halfWidth?: boolean}>} rows
 */
export function buildInfoCard(rows) {
  if (!rows?.length) return ''
  let html = '<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border:1px solid #334155;border-radius:8px;overflow:hidden"><tr><td style="padding:16px 20px"><table width="100%" cellpadding="0" cellspacing="0">'

  let i = 0
  while (i < rows.length) {
    const row = rows[i]
    const next = i + 1 < rows.length ? rows[i + 1] : null

    if (row.halfWidth && next?.halfWidth) {
      html += `<tr><td style="width:50%;vertical-align:top;padding:0 8px 10px 0"><div style="font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.5px;margin-bottom:2px">${escHtml(row.label)}</div><div style="font-size:14px;font-weight:600;color:#e2e8f0">${escHtml(row.value)}</div></td><td style="width:50%;vertical-align:top;padding:0 0 10px 8px"><div style="font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.5px;margin-bottom:2px">${escHtml(next.label)}</div><div style="font-size:14px;font-weight:600;color:#e2e8f0">${escHtml(next.value)}</div></td></tr>`
      i += 2
    } else {
      html += `<tr><td colspan="2" style="padding:0 0 10px"><div style="font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.5px;margin-bottom:2px">${escHtml(row.label)}</div><div style="font-size:14px;font-weight:600;color:#e2e8f0">${escHtml(row.value)}</div></td></tr>`
      i++
    }
  }

  html += '</table></td></tr></table>'
  return html
}

/**
 * Build full branded email layout
 * @param {string} bodyHtml - inner content
 * @param {object} opts - { title, subtitle, sport, greeting, ctaUrl, ctaLabel, ctaColor, ctaTextColor, footerExtra }
 */
export function buildEmailLayout(bodyHtml, opts = {}) {
  const accent = accentColor(opts.sport)
  const icon = opts.sport ? sportIcon(opts.sport) : ''
  const logoBlock = icon
    ? `<table cellpadding="0" cellspacing="0" style="margin:0 auto"><tr><td style="vertical-align:middle;padding-right:12px"><img src="${LOGO_URL}" alt="KSC Wiedikon" width="48" height="52" style="width:48px;height:52px"></td><td style="vertical-align:middle">${icon}</td></tr></table>`
    : `<div style="text-align:center"><img src="${LOGO_URL}" alt="KSC Wiedikon" width="48" height="52" style="width:48px;height:52px"></div>`

  let html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:24px 0"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#1e293b;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.3)">`

  // Accent stripe
  html += `<tr><td style="background:${accent};height:4px;font-size:0;line-height:0">&nbsp;</td></tr>`

  // Header
  html += `<tr><td style="background:#1e293b;padding:28px 28px 20px;text-align:center">${logoBlock}`
  if (opts.title) html += `<div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:8px">${escHtml(opts.title)}</div>`
  if (opts.subtitle) html += `<div style="font-size:14px;color:#94a3b8;margin-top:4px">${escHtml(opts.subtitle)}</div>`
  html += '</td></tr>'

  // Greeting
  if (opts.greeting) {
    html += `<tr><td style="padding:4px 28px 12px"><div style="font-size:15px;color:#e2e8f0">${escHtml(opts.greeting)}</div></td></tr>`
  }

  // Body
  html += `<tr><td style="padding:4px 28px 20px">${bodyHtml}</td></tr>`

  // CTA
  if (opts.ctaUrl && opts.ctaLabel) {
    const btnColor = opts.ctaColor || accent
    const txtColor = opts.ctaTextColor || '#000000'
    html += `<tr><td style="padding:0 28px 20px"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:4px 0 8px"><a href="${escHtml(opts.ctaUrl)}" style="display:inline-block;background:${btnColor};color:${txtColor};font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;letter-spacing:0.2px">${escHtml(opts.ctaLabel)}</a></td></tr></table></td></tr>`
  }

  // Footer extra
  if (opts.footerExtra) {
    html += `<tr><td style="padding:0 28px 20px;text-align:center"><div style="font-size:13px;color:#94a3b8">${escHtml(opts.footerExtra)}</div></td></tr>`
  }

  // Optional signature block (raw HTML rows, e.g. the Spielplanung contact
  // signature on opponent-facing emails). Opt-in per caller — most features
  // pass nothing here and keep the plain footer.
  if (opts.signatureHtml) {
    html += opts.signatureHtml
  }

  // Bottom bar
  const footerHost = FRONTEND_URL.replace('https://', '')
  html += `<tr><td style="background:#0f172a;border-top:1px solid #334155;padding:14px 28px;text-align:center"><div style="font-size:11px;color:#64748b">KSC Wiedikon &middot; <a href="${FRONTEND_URL}" style="color:#64748b;text-decoration:none">${footerHost}</a></div></td></tr>`

  html += '</table></td></tr></table></body></html>'
  return html
}

/**
 * Build an alert box
 * @param {'info'|'warning'|'success'} type
 */
export function buildAlertBox(type, title, text) {
  const styles = {
    warning: { bg: '#450a0a', border: '#7f1d1d', title: '#f87171', text: '#fca5a5' },
    success: { bg: '#052e16', border: '#166534', title: '#4ade80', text: '#86efac' },
    info: { bg: '#172554', border: '#1e3a5f', title: '#60a5fa', text: '#93c5fd' },
  }
  const s = styles[type] || styles.info
  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:${s.bg};border:1px solid ${s.border};border-radius:8px;margin-bottom:12px"><tr><td style="padding:12px 16px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:${s.title};font-weight:700;margin-bottom:4px">${escHtml(title)}</div><div style="font-size:13px;color:${s.text}">${escHtml(text)}</div></td></tr></table>`
}

/** Format date as DD.MM.YYYY (Swiss), rendered in Europe/Zurich local time */
export function formatDateCH(d) {
  const x = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(x.getTime())) return ''
  return new Intl.DateTimeFormat('de-CH', {
    timeZone: 'Europe/Zurich',
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(x)
}

/** Weekday abbreviation rendered in Europe/Zurich local time */
export function weekday(d, lang = 'de') {
  const x = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(x.getTime())) return ''
  const loc = lang === 'en' ? 'en' : lang === 'fr' ? 'fr' : lang === 'it' ? 'it' : 'de'
  return new Intl.DateTimeFormat(loc, { timeZone: 'Europe/Zurich', weekday: 'short' }).format(x)
}

/**
 * Build a broadcast ("Contact-All") email — used by the per-activity
 * Plan 01 Phase B endpoint to email participants of an event/game/training
 * with a free-form message authored by an organiser.
 *
 * Rendering shape:
 *   - Sport-coloured accent stripe (vb=#FFC832, bb=#F97316, neutral=#4A55A2)
 *   - Header: localised title ("Nachricht zum Anlass" / "Message about the event") + subject
 *   - Greeting: localised ("Hallo {name}," / "Hi {name},")
 *   - Sender info card: Von/From → "First Last"
 *   - Activity info card: Anlass/Event + Datum/Date + Ort/Location? + Team?
 *   - Body: HTML-escaped message with newlines → <br>
 *   - CTA: "Im Wiedisync öffnen" / "Open in Wiedisync" → /events|games|trainings/:id
 *
 * @param {object} args
 * @param {{type:'event'|'game'|'training', id:string|number, title:string, start_date:string, location?:string, teamName?:string, sport?:string}} args.activity
 * @param {{first_name:string, last_name:string}} args.sender
 * @param {string} args.subject
 * @param {string} args.message — plain text, newlines preserved
 * @param {string} args.recipientFirstName
 * @param {'de'|'en'|'fr'|'gsw'|'it'|'german'|'english'|'french'|'italian'|'swiss_german'} [args.lang='de']
 *        Accepts both the short-code (`de`/`en`/...) and the long-form value
 *        stored in `members.language` (`german`/`english`/...). Unknown values
 *        fall back to `de`.
 * @returns {string} full HTML email document
 */
export function buildBroadcastEmail({
  activity,
  sender,
  subject,
  message,
  recipientFirstName,
  lang = 'de',
}) {
  // Normalize long-form `members.language` values to short codes.
  if (LANG_TO_CODE[lang]) lang = LANG_TO_CODE[lang]

  // Five locales (de/gsw/en/fr/it) — unknown lang falls back to de.
  const BROADCAST_L = {
    de: {
      title: 'Nachricht zum Anlass', greeting: n => (n ? `Hallo ${n},` : 'Hallo,'),
      from: 'Von', eventLabel: 'Anlass', gameLabel: 'Spiel', trainingLabel: 'Training',
      date: 'Datum', location: 'Ort', team: 'Team', cta: 'Im Wiedisync öffnen',
    },
    gsw: {
      title: 'Nachricht zum Aalass', greeting: n => (n ? `Hoi ${n},` : 'Hoi,'),
      from: 'Vo', eventLabel: 'Aalass', gameLabel: 'Spiel', trainingLabel: 'Training',
      date: 'Datum', location: 'Ort', team: 'Team', cta: 'Im Wiedisync öffne',
    },
    en: {
      title: 'Message about the event', greeting: n => (n ? `Hi ${n},` : 'Hi,'),
      from: 'From', eventLabel: 'Event', gameLabel: 'Game', trainingLabel: 'Training',
      date: 'Date', location: 'Location', team: 'Team', cta: 'Open in Wiedisync',
    },
    fr: {
      title: "Message à propos de l'événement", greeting: n => (n ? `Salut ${n},` : 'Bonjour,'),
      from: 'De', eventLabel: 'Événement', gameLabel: 'Match', trainingLabel: 'Entraînement',
      date: 'Date', location: 'Lieu', team: 'Équipe', cta: 'Ouvrir dans Wiedisync',
    },
    it: {
      title: "Messaggio sull'evento", greeting: n => (n ? `Ciao ${n},` : 'Salve,'),
      from: 'Da', eventLabel: 'Evento', gameLabel: 'Partita', trainingLabel: 'Allenamento',
      date: 'Data', location: 'Luogo', team: 'Squadra', cta: 'Apri in Wiedisync',
    },
  }
  const L = BROADCAST_L[lang] || BROADCAST_L.de

  // Activity-type label — game/training get specific labels, event uses generic
  const activityLabel =
    activity?.type === 'game'
      ? L.gameLabel
      : activity?.type === 'training'
        ? L.trainingLabel
        : L.eventLabel

  // Date formatting — reuse existing Swiss formatter (DD.MM.YYYY) plus a
  // locale-aware time so recipients see e.g. "20.04.2026 · 19:30".
  let dateValue = ''
  if (activity?.start_date) {
    try {
      const dateStr = formatDateCH(activity.start_date)
      const timeStr = new Intl.DateTimeFormat('de-CH', {
        timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(activity.start_date))
      dateValue = `${dateStr} · ${timeStr}`
    } catch {
      dateValue = String(activity.start_date)
    }
  }

  // Sender + activity info cards
  const senderName = `${sender?.first_name || ''} ${sender?.last_name || ''}`.trim() || '—'
  const senderCard = buildInfoCard([{ label: L.from, value: senderName }])

  const activityRows = []
  activityRows.push({ label: activityLabel, value: activity?.title || '—' })
  if (dateValue) activityRows.push({ label: L.date, value: dateValue })
  if (activity?.location) activityRows.push({ label: L.location, value: activity.location })
  if ((activity?.type === 'game' || activity?.type === 'training') && activity?.teamName) {
    activityRows.push({ label: L.team, value: activity.teamName })
  }
  const activityCard = buildInfoCard(activityRows)

  // Message body — escape, then convert newlines to <br>. Wrap each paragraph
  // (split on blank lines) in its own <p> for readable spacing.
  const safeMsg = escHtml(message || '')
  const paragraphs = safeMsg
    .split(/\n{2,}/)
    .map((p) => `<p style="font-size:14px;color:#e2e8f0;line-height:1.6;margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`)
    .join('')

  // Combine sender card → activity card → spacing → message body
  const bodyHtml =
    `${senderCard}<div style="height:10px;font-size:0;line-height:0">&nbsp;</div>` +
    `${activityCard}<div style="height:14px;font-size:0;line-height:0">&nbsp;</div>` +
    paragraphs

  // Build CTA URL — /events|games|trainings/:id on the production frontend.
  // We hardcode the production host because broadcast emails always link to
  // the canonical frontend (matches Plan 01 Phase A spec).
  const typeSegment = activity?.type === 'game' ? 'games' : activity?.type === 'training' ? 'trainings' : 'events'
  const ctaUrl = `https://wiedisync.kscw.ch/${typeSegment}/${activity?.id ?? ''}`

  return buildEmailLayout(bodyHtml, {
    title: L.title,
    subtitle: subject,
    sport: activity?.sport,
    greeting: L.greeting(recipientFirstName),
    ctaUrl,
    ctaLabel: L.cta,
  })
}

/**
 * Map `members.language` (long form) → short ISO-ish code we use in templates.
 * Unknown / null falls back to `de` (canonical club language; matches the
 * Postgres column default).
 */
const LANG_TO_CODE = {
  german: 'de',
  swiss_german: 'gsw',
  english: 'en',
  french: 'fr',
  italian: 'it',
}

export function memberLangToEmailCode(lang) {
  return LANG_TO_CODE[lang] || 'de'
}

/**
 * Bucket email recipients by their preferred locale, returning empty arrays
 * for absent locales so callers can always loop `['de','gsw','en','fr','it']`.
 *
 * Resolution order per address (first match wins):
 *   1. `directus_users.email` → `members.user` FK → `members.language`
 *   2. `members.email` directly (covers staff/owner addresses that aren't a
 *      Directus user, e.g. external admins, the OWNER_EMAIL constant)
 *   3. fallback to `de`
 *
 * @param {object} database - knex instance
 * @param {string[]} emails - recipient addresses (any case)
 * @returns {Promise<{de: string[], gsw: string[], en: string[], fr: string[], it: string[]}>}
 */
export async function bucketEmailsByLocale(database, emails) {
  const buckets = { de: [], gsw: [], en: [], fr: [], it: [] }
  if (!Array.isArray(emails) || emails.length === 0) return buckets
  const lower = [...new Set(emails.map(e => String(e || '').trim().toLowerCase()).filter(Boolean))]
  if (lower.length === 0) return buckets
  const placeholders = lower.map(() => '?').join(',')

  // Pass 1: directus_users.email → members.language
  const duRows = await database('directus_users as du')
    .leftJoin('members as m', 'm.user', 'du.id')
    .whereRaw(`LOWER(du.email) IN (${placeholders})`, lower)
    .select(database.raw('LOWER(du.email) as email'), 'm.language')
  const langMap = new Map()
  for (const r of duRows) {
    if (!langMap.has(r.email) && r.language != null) langMap.set(r.email, r.language)
  }

  // Pass 2: members.email fallback for addresses we couldn't resolve via Directus
  const unresolved = lower.filter(e => !langMap.has(e))
  if (unresolved.length > 0) {
    const ph = unresolved.map(() => '?').join(',')
    const memRows = await database('members')
      .whereRaw(`LOWER(email) IN (${ph})`, unresolved)
      .select(database.raw('LOWER(email) as email'), 'language')
    for (const r of memRows) {
      if (!langMap.has(r.email) && r.language != null) langMap.set(r.email, r.language)
    }
  }

  for (const email of lower) {
    const code = memberLangToEmailCode(langMap.get(email))
    buckets[code].push(email)
  }
  return buckets
}

/**
 * Bucket member ids by their preferred locale. Use this when callers already
 * hold member ids and don't need to round-trip via email addresses.
 *
 * @param {object} database - knex instance
 * @param {Array<number|string>} memberIds
 * @returns {Promise<{de: number[], gsw: number[], en: number[], fr: number[], it: number[]}>}
 */
export async function bucketMemberIdsByLocale(database, memberIds) {
  const buckets = { de: [], gsw: [], en: [], fr: [], it: [] }
  if (!Array.isArray(memberIds) || memberIds.length === 0) return buckets
  const ids = [...new Set(memberIds.filter(Boolean))]
  if (ids.length === 0) return buckets
  const rows = await database('members').whereIn('id', ids).select('id', 'language')
  const langMap = new Map()
  for (const r of rows) langMap.set(r.id, r.language)
  for (const id of ids) {
    const code = memberLangToEmailCode(langMap.get(id))
    buckets[code].push(id)
  }
  return buckets
}

/** Locale order callers should iterate in. Frozen so it's safe to share. */
export const EMAIL_LOCALES = Object.freeze(['de', 'gsw', 'en', 'fr', 'it'])
