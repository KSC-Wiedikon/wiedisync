/**
 * GCal sync → club-admin digest email.
 *
 * The KWI hall calendar is kept by the school's hall administration (Hausdienst),
 * not by us — a new "Halle geschlossen", a tournament, a moved date appears there
 * with no notice to the club, and the nightly `gcal-sync` cron silently absorbs
 * it. Worse, a closure creates `hall_closures` rows through ItemsService, so the
 * auto-cancel hook cancels every training in that hall+range: trainings vanish
 * from members' calendars and nobody in the club knows why until a coach asks.
 *
 * This mails a digest to the club-admin box whenever the feed ACTUALLY changed.
 * ⚠ Silence is the normal state: `gcal-sync` rewrites every `hall_events` row on
 * every run (unconditional UPDATE), so a run's `eventsUpdated` count is NOT a
 * change signal — the caller diffs the stored row field-by-field and only reports
 * real differences. A no-change run sends nothing.
 */

import { buildEmailLayout, buildAlertBox, buildInfoCard, escHtml, FRONTEND_URL } from './email-template.js'

// Recipients. `??` (never `||`) so an intentionally EMPTY env value disables the
// digest instead of falling through to the default — the scorer-exam lesson.
export const GCAL_NOTIFY_EMAILS = (process.env.GCAL_SYNC_NOTIFY_EMAILS ?? 'admin@wiedisync.kscw.ch')
  .split(',').map((s) => s.trim()).filter(Boolean)

// Dev is a nightly prod clone running the same 04:00 cron — any digest it
// produces is a duplicate of prod's, addressed to real club admins. Suppress it;
// GCAL_SYNC_NOTIFY_FORCE=1 for a deliberate test.
const IS_DEV = (process.env.PUBLIC_URL || '').includes('directus-dev')
export const GCAL_NOTIFY_ENABLED = GCAL_NOTIFY_EMAILS.length > 0
  && (!IS_DEV || process.env.GCAL_SYNC_NOTIFY_FORCE === '1')

/** Empty change accumulator — one per sync run. */
export function emptyChanges() {
  return {
    eventsNew: [],        // { title, date, time, location }
    eventsChanged: [],    // { title, date, diffs: [{ field, from, to }] }
    eventsRemoved: [],    // { title, date }
    closuresNew: [],      // { halls: [name], start, end, reason }
    closuresRemoved: [],  // { halls: [name], start, end, reason }
    trainingsCancelled: [], // { team, date, start_time, hall }
    trainingsRestored: [],  // { team, date, start_time, hall }
  }
}

export function hasChanges(c) {
  return c.eventsNew.length > 0 || c.eventsChanged.length > 0 || c.eventsRemoved.length > 0
    || c.closuresNew.length > 0 || c.closuresRemoved.length > 0
}

const dmy = (iso) => {
  const m = String(iso || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || '—')
}
const hm = (t) => (t ? String(t).slice(0, 5) : '')
// The sync reads `start_time` straight off `trainings`; keep `time` accepted so a
// caller building the row by hand cannot silently lose the time.
const trainingLine = (t) => {
  const at = hm(t.start_time ?? t.time)
  return `${dmy(t.date)}${at ? `, ${at}` : ''} · ${t.team || '—'} · ${t.hall || '—'}`
}
const range = (s, e) => (s === e ? dmy(s) : `${dmy(s)} – ${dmy(e)}`)

function eventLine(e) {
  const when = e.allDay || !e.time ? dmy(e.date) : `${dmy(e.date)}, ${hm(e.time)}${e.endTime ? `–${hm(e.endTime)}` : ''}`
  return `${when} · ${e.title || '(ohne Titel)'}${e.location ? ` · ${e.location}` : ''}`
}

// A whole-season re-import (or a Hausdienst bulk edit) can move hundreds of
// entries at once; past this many the digest stops being readable and the point
// is "go look at the Hallenplan" anyway.
const MAX_LINES = 25

// One list section. Rendered only when it has rows, so an email never carries an
// empty heading.
function section(title, lines, color) {
  if (!lines.length) return ''
  const shown = lines.slice(0, MAX_LINES)
  if (lines.length > shown.length) shown.push(`… und ${lines.length - shown.length} weitere · and ${lines.length - shown.length} more`)
  const items = shown
    .map((l) => `<li style="margin:0 0 6px;font-size:13px;color:#e2e8f0;line-height:1.45">${escHtml(l)}</li>`)
    .join('')
  return `<div style="margin:0 0 16px">`
    + `<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:${color};font-weight:700;margin-bottom:6px">${escHtml(title)}</div>`
    + `<ul style="margin:0;padding-left:18px">${items}</ul></div>`
}

const FIELD_LABELS = {
  title: 'Titel · Title',
  date: 'Datum · Date',
  start_time: 'Beginn · Start',
  end_time: 'Ende · End',
  location: 'Ort · Location',
  all_day: 'Ganztägig · All-day',
}

/**
 * Send the digest. Never throws — it runs after the sync has already committed,
 * so a dead SES or an unreachable mailbox costs a log line, not a failed sync
 * that would invite a retry re-writing everything.
 *
 * @param {object} p
 *   changes  — accumulator from emptyChanges(), filled by the sync
 *   trigger  — 'cron' | 'manual'
 *   mail     — a Directus MailService instance
 *   log      — logger
 */
export async function notifyGCalChanges({ changes, trigger, mail, log }) {
  try {
    if (!hasChanges(changes)) return { sent: false, reason: 'no-changes' }
    if (!GCAL_NOTIFY_ENABLED) return { sent: false, reason: IS_DEV ? 'dev-suppressed' : 'no-recipients' }

    const c = changes
    const parts = []
    if (c.eventsNew.length) parts.push(`${c.eventsNew.length} neu`)
    if (c.eventsChanged.length) parts.push(`${c.eventsChanged.length} geändert`)
    if (c.eventsRemoved.length) parts.push(`${c.eventsRemoved.length} entfernt`)
    const closureCount = c.closuresNew.length + c.closuresRemoved.length
    if (closureCount) parts.push(`${closureCount} Hallensperrung${closureCount === 1 ? '' : 'en'}`)
    const counts = parts.join(', ')
    const subject = `Hallenkalender KWI: ${counts}`

    const summary = [
      c.eventsNew.length ? `${c.eventsNew.length} neue Einträge · new entries` : null,
      c.eventsChanged.length ? `${c.eventsChanged.length} geändert · changed` : null,
      c.eventsRemoved.length ? `${c.eventsRemoved.length} entfernt · removed` : null,
      c.closuresNew.length ? `${c.closuresNew.length} neue Sperrung · new closure` : null,
      c.closuresRemoved.length ? `${c.closuresRemoved.length} Sperrung aufgehoben · closure lifted` : null,
    ].filter(Boolean).join(', ')

    // A training cancellation is the part somebody has to act on, so it decides
    // the alert colour — everything else is informational.
    const impactful = c.trainingsCancelled.length > 0
    let body = buildAlertBox(
      impactful ? 'warning' : 'info',
      impactful
        ? `${c.trainingsCancelled.length} Training${c.trainingsCancelled.length === 1 ? '' : 's'} abgesagt · trainings cancelled`
        : 'Hallenkalender aktualisiert · hall calendar updated',
      impactful
        ? `Die Hallenverwaltung hat den Kalender geändert; betroffene Trainings wurden automatisch abgesagt. · The hall administration changed the calendar; affected trainings were cancelled automatically.`
        : `Die Hallenverwaltung hat den Kalender geändert. · The hall administration changed the calendar.`,
    )

    body += buildInfoCard([
      { label: 'Auslöser · Trigger', value: trigger === 'manual' ? 'Manuell · Manual' : 'Nächtlicher Sync · Nightly sync', halfWidth: true },
      { label: 'Kalender · Calendar', value: 'KSCW Heimspiele / Halle KWI', halfWidth: true },
    ])
    body += '<div style="height:16px"></div>'

    body += section('Neu im Kalender · New entries', c.eventsNew.map(eventLine), '#4ade80')
    body += section(
      'Geändert · Changed',
      c.eventsChanged.map((e) => `${dmy(e.date)} · ${e.title || '(ohne Titel)'} — `
        + e.diffs.map((d) => `${FIELD_LABELS[d.field] || d.field}: ${d.from || '—'} → ${d.to || '—'}`).join('; ')),
      '#60a5fa',
    )
    body += section('Entfernt · Removed', c.eventsRemoved.map((e) => `${dmy(e.date)} · ${e.title || '(ohne Titel)'}`), '#f87171')
    body += section(
      'Neue Hallensperrungen · New hall closures',
      c.closuresNew.map((x) => `${range(x.start, x.end)} · ${x.halls.join(', ')} · ${x.reason}`),
      '#fbbf24',
    )
    body += section(
      'Aufgehobene Sperrungen · Closures lifted',
      c.closuresRemoved.map((x) => `${range(x.start, x.end)} · ${x.halls.join(', ')}${x.reason ? ` · ${x.reason}` : ''}`),
      '#4ade80',
    )
    body += section(
      'Abgesagte Trainings · Cancelled trainings',
      c.trainingsCancelled.map(trainingLine),
      '#f87171',
    )
    body += section(
      'Wieder aktiv · Trainings reinstated',
      c.trainingsRestored.map(trainingLine),
      '#4ade80',
    )

    const html = buildEmailLayout(body, {
      title: 'Hallenkalender KWI',
      subtitle: counts,
      ctaUrl: `${FRONTEND_URL}/admin/hallenplan`,
      ctaLabel: 'Hallenplan öffnen',
      // The default CTA text colour is black, which sits at ~2.8:1 on the
      // neutral accent; white is 7.4:1.
      ctaTextColor: '#ffffff',
      footerExtra: 'Automatischer Abgleich mit dem Kalender der Hallenverwaltung · Automatic sync with the hall administration calendar',
    })

    // Plain-text twin — the club box is read in webmail and on phones.
    const textLines = [
      `Hallenkalender KWI — ${summary}`,
      '',
      ...(c.eventsNew.length ? ['Neu · New:', ...c.eventsNew.map((e) => `  - ${eventLine(e)}`), ''] : []),
      ...(c.eventsChanged.length ? ['Geändert · Changed:', ...c.eventsChanged.map((e) => `  - ${dmy(e.date)} ${e.title}: ${e.diffs.map((d) => `${FIELD_LABELS[d.field] || d.field}: ${d.from || '—'} → ${d.to || '—'}`).join('; ')}`), ''] : []),
      ...(c.eventsRemoved.length ? ['Entfernt · Removed:', ...c.eventsRemoved.map((e) => `  - ${dmy(e.date)} ${e.title}`), ''] : []),
      ...(c.closuresNew.length ? ['Neue Sperrungen · New closures:', ...c.closuresNew.map((x) => `  - ${range(x.start, x.end)} ${x.halls.join(', ')} — ${x.reason}`), ''] : []),
      ...(c.closuresRemoved.length ? ['Aufgehoben · Lifted:', ...c.closuresRemoved.map((x) => `  - ${range(x.start, x.end)} ${x.halls.join(', ')}`), ''] : []),
      ...(c.trainingsCancelled.length ? ['Abgesagte Trainings · Cancelled trainings:', ...c.trainingsCancelled.map((t) => `  - ${trainingLine(t)}`), ''] : []),
      ...(c.trainingsRestored.length ? ['Wieder aktiv · Reinstated:', ...c.trainingsRestored.map((t) => `  - ${trainingLine(t)}`), ''] : []),
      `${FRONTEND_URL}/admin/hallenplan`,
    ]

    await mail.send({
      to: GCAL_NOTIFY_EMAILS.join(','),
      subject,
      html,
      text: textLines.join('\n'),
    })
    log.info(`gcal-sync: change digest mailed to ${GCAL_NOTIFY_EMAILS.join(',')} (${subject})`)
    return { sent: true, recipients: GCAL_NOTIFY_EMAILS.length, subject }
  } catch (err) {
    // Deliberately swallowed — see the header comment.
    log.warn({ msg: `gcal-sync: change digest mail failed: ${err.message}`, endpoint: 'gcal-sync', stack: err.stack })
    return { sent: false, reason: 'error', error: err.message }
  }
}
