import type { CalendarEntry } from '../types/calendar'

/**
 * Generate a valid iCalendar (.ics) string from calendar entries.
 * Conforms to RFC 5545.
 */
export function generateICal(entries: CalendarEntry[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KSCW Volley//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:KSCW Volleyball',
    'X-WR-TIMEZONE:Europe/Zurich',
    // VTIMEZONE for Europe/Zurich (standard CET/CEST EU rules). Emitted before
    // the VEVENTs so strict RFC-5545 parsers can resolve the TZID=Europe/Zurich
    // referenced by every timed DTSTART/DTEND instead of dropping the zone.
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Zurich',
    'X-LIC-LOCATION:Europe/Zurich',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ]

  for (const entry of entries) {
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${entry.id}@kscw.ch`)
    lines.push(`DTSTAMP:${formatICalUTC(new Date())}`)

    if (entry.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatICalDateOnly(entry.date)}`)
      const nextDay = new Date(entry.date)
      nextDay.setDate(nextDay.getDate() + 1)
      lines.push(`DTEND;VALUE=DATE:${formatICalDateOnly(nextDay)}`)
    } else if (entry.startTime) {
      lines.push(
        `DTSTART;TZID=Europe/Zurich:${formatICalLocal(entry.date, entry.startTime)}`,
      )
      if (entry.endTime) {
        lines.push(
          `DTEND;TZID=Europe/Zurich:${formatICalLocal(entry.date, entry.endTime)}`,
        )
      } else {
        lines.push(
          `DTEND;TZID=Europe/Zurich:${formatICalLocalOffset(entry.date, entry.startTime, 2)}`,
        )
      }
    } else {
      lines.push(`DTSTART;VALUE=DATE:${formatICalDateOnly(entry.date)}`)
      const nextDay = new Date(entry.date)
      nextDay.setDate(nextDay.getDate() + 1)
      lines.push(`DTEND;VALUE=DATE:${formatICalDateOnly(nextDay)}`)
    }

    lines.push(`SUMMARY:${escapeICalText(entry.title)}`)
    if (entry.location) {
      lines.push(`LOCATION:${escapeICalText(entry.location)}`)
    }
    if (entry.description) {
      lines.push(`DESCRIPTION:${escapeICalText(entry.description)}`)
    }
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

/**
 * Trigger a browser download of the .ics file.
 */
export function downloadICal(
  entries: CalendarEntry[],
  filename: string = 'wiedisync.ics',
): void {
  const content = generateICal(entries)
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// --- Internal helpers ---

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** UTC datetime for DTSTAMP: 20251015T143000Z */
function formatICalUTC(date: Date): string {
  const y = date.getUTCFullYear()
  const m = pad(date.getUTCMonth() + 1)
  const d = pad(date.getUTCDate())
  const h = pad(date.getUTCHours())
  const min = pad(date.getUTCMinutes())
  const s = pad(date.getUTCSeconds())
  return `${y}${m}${d}T${h}${min}${s}Z`
}

/** Date-only: 20251015 */
function formatICalDateOnly(date: Date): string {
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  return `${y}${m}${d}`
}

/** Local datetime from date + time string: 20251015T143000 */
function formatICalLocal(date: Date, time: string): string {
  const y = date.getFullYear()
  const mo = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const [h, m] = time.split(':')
  return `${y}${mo}${d}T${h}${m}00`
}

/** Local datetime offset by hours */
function formatICalLocalOffset(date: Date, time: string, hoursOffset: number): string {
  const [h, m] = time.split(':').map(Number)
  // Roll the hour over 24h and carry into the day so a late event (e.g. 22:00 + 2h)
  // yields 00:xx on the next day rather than an invalid 24:xx that corrupts the .ics.
  const totalH = h + hoursOffset
  const dayCarry = Math.floor(totalH / 24)
  const newH = ((totalH % 24) + 24) % 24
  const shifted = new Date(date)
  shifted.setDate(shifted.getDate() + dayCarry)
  const y = shifted.getFullYear()
  const mo = pad(shifted.getMonth() + 1)
  const d = pad(shifted.getDate())
  return `${y}${mo}${d}T${pad(newH)}${pad(m)}00`
}

/** Escape special characters per RFC 5545 */
function escapeICalText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}
