/**
 * iCal Feed — ported from ical_feed_lib.js
 * GET /kscw/ical — all sports
 * GET /kscw/ical/volleyball — volleyball only
 * GET /kscw/ical/basketball — basketball only
 * Query: ?source=games-home,trainings,events,closures,hall&team=1,2,3
 */

const pad = (n) => String(n).padStart(2, '0')
const fmtUTC = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
// Normalize date: Date objects → YYYY-MM-DD string, then strip dashes
const toISO = (v) => v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)
const fmtDate = (s) => toISO(s).replace(/-/g, '')
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const fmtLocal = (d, t) => { const [h, m] = String(t).split(':'); return fmtDate(d) + 'T' + pad(+h) + pad(+m) + '00' }
const fmtOff = (d, t, off) => { const [h, m] = String(t).split(':'); return fmtDate(d) + 'T' + pad(+h + off) + pad(+m) + '00' }
const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')

// Convert a UTC-stored timestamptz value to a Zurich-local iCal datetime string (YYYYMMDDTHHMMSS).
// Used for events path only — games/trainings/hall-events use TZ-naive date+time columns via fmtLocal.
function toZurichICSLocal(input) {
  const d = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d)
  const g = (t) => parts.find((x) => x.type === t).value
  return `${g('year')}${g('month')}${g('day')}T${g('hour')}${g('minute')}${g('second')}`
}

function nextDay(dateStr) {
  const d = new Date(dateStr); d.setDate(d.getDate() + 1); return isoDate(d)
}

// Zurich calendar date (YYYY-MM-DD) for a timestamptz instant. All-day events are
// stored at the Zurich-midnight boundary (e.g. 22:00Z = 00:00 the next day in summer),
// so the raw UTC date (toISO) is a day early. Mirrors the frontend toZurichDateString.
// Safe for plain date strings too — a midnight-UTC date never crosses the Zurich boundary.
function toZurichDate(input) {
  const d = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(d.getTime())) return toISO(input)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

export function registerICalFeed(router, { database, logger }) {
  const log = logger.child({ endpoint: 'ical-feed' })

  async function handleFeed(req, res, sportFilter) {
    try {
      const sourceParam = req.query.source || ''
      const teamParam = req.query.team || ''

      const VALID_SOURCES = new Set(['games-home', 'games-away', 'trainings', 'events', 'closures', 'hall'])
      const sources = sourceParam
        ? Object.fromEntries(sourceParam.split(',').map(s => s.trim()).filter(s => VALID_SOURCES.has(s)).map(s => [s, true]))
        : { 'games-home': true, 'games-away': true }
      let teamIds = teamParam ? teamParam.split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s)) : []

      // Sport filter
      if (sportFilter) {
        const sportTeams = await database('teams').where('sport', sportFilter).where('active', true).select('id')
        const sportIds = new Set(sportTeams.map(t => String(t.id)))
        teamIds = teamIds.length ? teamIds.filter(id => sportIds.has(id)) : [...sportIds]
      }

      const calName = sportFilter === 'volleyball' ? 'KSCW - Volleyball' : sportFilter === 'basketball' ? 'KSCW - Basketball' : 'KSCW - Kalender'
      const now = fmtUTC(new Date())
      const lines = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KSCW//Calendar//EN',
        'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${calName}`,
        'X-WR-TIMEZONE:Europe/Zurich', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
      ]

      // Games
      if (sources['games-home'] || sources['games-away']) {
        let q = database('games')
        if (teamIds.length) q = q.whereIn('kscw_team', teamIds)
        if (sources['games-home'] && !sources['games-away']) q = q.where('type', 'home')
        else if (sources['games-away'] && !sources['games-home']) q = q.where('type', 'away')
        const games = await q.orderBy('date')

        for (const g of games) {
          if (!g.date) continue
          const d = toISO(g.date)
          let title = `${g.home_team || ''} - ${g.away_team || ''}`
          if (g.status === 'completed') title += ` (${g.home_score}:${g.away_score})`
          let desc = g.league || ''
          if (g.status === 'postponed') desc += ' [VERSCHOBEN]'

          lines.push('BEGIN:VEVENT', `UID:${g.id}@kscw.ch`, `DTSTAMP:${now}`)
          if (g.time) {
            lines.push(`DTSTART;TZID=Europe/Zurich:${fmtLocal(d, g.time)}`)
            lines.push(`DTEND;TZID=Europe/Zurich:${fmtOff(d, g.time, 2)}`)
          } else {
            lines.push(`DTSTART;VALUE=DATE:${fmtDate(d)}`, `DTEND;VALUE=DATE:${fmtDate(nextDay(d))}`)
          }
          lines.push(`SUMMARY:${esc(title)}`)
          if (desc) lines.push(`DESCRIPTION:${esc(desc)}`)
          lines.push('END:VEVENT')
        }
      }

      // Trainings
      if (sources['trainings']) {
        let q = database('trainings')
        if (teamIds.length) q = q.whereIn('team', teamIds)
        const trainings = await q.orderBy('date')
        const teamNames = Object.fromEntries(
          (await database('teams').select('id', 'name')).map(t => [t.id, t.name])
        )

        for (const tr of trainings) {
          if (!tr.date) continue
          const d = toISO(tr.date)
          let title = `Training${teamNames[tr.team] ? ' ' + teamNames[tr.team] : ''}`
          if (tr.cancelled) title = '[ABGESAGT] ' + title

          lines.push('BEGIN:VEVENT', `UID:training-${tr.id}@kscw.ch`, `DTSTAMP:${now}`)
          if (tr.start_time) {
            lines.push(`DTSTART;TZID=Europe/Zurich:${fmtLocal(d, tr.start_time)}`)
            lines.push(`DTEND;TZID=Europe/Zurich:${tr.end_time ? fmtLocal(d, tr.end_time) : fmtOff(d, tr.start_time, 2)}`)
          } else {
            lines.push(`DTSTART;VALUE=DATE:${fmtDate(d)}`, `DTEND;VALUE=DATE:${fmtDate(nextDay(d))}`)
          }
          lines.push(`SUMMARY:${esc(title)}`)
          if (tr.cancelled && tr.cancel_reason) lines.push(`DESCRIPTION:${esc(tr.cancel_reason)}`)
          lines.push('END:VEVENT')
        }
      }

      // Events — club-wide only. Team-/member-scoped events (e.g. a tournament
      // limited to H3) stay internal to the member app and never reach the feed.
      if (sources['events']) {
        const events = await database('events')
          .whereNotIn('id', database('events_teams').select('events_id'))
          .whereNotIn('id', database('events_members').select('events_id'))
          .orderBy('start_date')
        for (const ev of events) {
          if (!ev.start_date) continue
          const d = toISO(ev.start_date)
          lines.push('BEGIN:VEVENT', `UID:event-${ev.id}@kscw.ch`, `DTSTAMP:${now}`)

          if (ev.all_day) {
            // Use the Zurich calendar day so subscribers see the same day as the app —
            // the raw UTC date is one day early for boundary-stored all-day events.
            const startZ = toZurichDate(ev.start_date)
            lines.push(`DTSTART;VALUE=DATE:${fmtDate(startZ)}`)
            const endZ = ev.end_date ? toZurichDate(ev.end_date) : startZ
            lines.push(`DTEND;VALUE=DATE:${fmtDate(nextDay(endZ))}`)
          } else {
            const dtStart = toZurichICSLocal(ev.start_date)
            if (dtStart) {
              lines.push(`DTSTART;TZID=Europe/Zurich:${dtStart}`)
              if (ev.end_date) {
                lines.push(`DTEND;TZID=Europe/Zurich:${toZurichICSLocal(ev.end_date)}`)
              } else {
                // Fallback: 2-hour duration derived from Zurich-local start
                const startMs = (ev.start_date instanceof Date ? ev.start_date : new Date(ev.start_date)).getTime()
                lines.push(`DTEND;TZID=Europe/Zurich:${toZurichICSLocal(new Date(startMs + 2 * 60 * 60 * 1000))}`)
              }
            } else {
              lines.push(`DTSTART;VALUE=DATE:${fmtDate(d)}`, `DTEND;VALUE=DATE:${fmtDate(nextDay(d))}`)
            }
          }
          lines.push(`SUMMARY:${esc(ev.title || 'Event')}`)
          if (ev.location) lines.push(`LOCATION:${esc(ev.location)}`)
          if (ev.description) lines.push(`DESCRIPTION:${esc(ev.description)}`)
          lines.push('END:VEVENT')
        }
      }

      // Hall closures
      if (sources['closures']) {
        const closures = await database('hall_closures').orderBy('start_date')
        const hallNames = Object.fromEntries(
          (await database('halls').select('id', 'name')).map(h => [h.id, h.name])
        )
        for (const cl of closures) {
          if (!cl.start_date) continue
          lines.push('BEGIN:VEVENT', `UID:closure-${cl.id}@kscw.ch`, `DTSTAMP:${now}`)
          lines.push(`DTSTART;VALUE=DATE:${fmtDate(cl.start_date)}`)
          lines.push(`DTEND;VALUE=DATE:${fmtDate(nextDay(toISO(cl.end_date || cl.start_date)))}`)
          lines.push(`SUMMARY:${esc('Hallensperrung' + (hallNames[cl.hall] ? ': ' + hallNames[cl.hall] : ''))}`)
          if (cl.reason) lines.push(`DESCRIPTION:${esc(cl.reason)}`)
          lines.push('END:VEVENT')
        }
      }

      // Hall events
      if (sources['hall']) {
        const hallEvents = await database('hall_events').orderBy('date')
        for (const he of hallEvents) {
          if (!he.date) continue
          const d = toISO(he.date)
          lines.push('BEGIN:VEVENT', `UID:hall-${he.id}@kscw.ch`, `DTSTAMP:${now}`)
          if (he.all_day || !he.start_time) {
            lines.push(`DTSTART;VALUE=DATE:${fmtDate(d)}`, `DTEND;VALUE=DATE:${fmtDate(nextDay(d))}`)
          } else {
            lines.push(`DTSTART;TZID=Europe/Zurich:${fmtLocal(d, he.start_time)}`)
            lines.push(`DTEND;TZID=Europe/Zurich:${he.end_time ? fmtLocal(d, he.end_time) : fmtOff(d, he.start_time, 2)}`)
          }
          lines.push(`SUMMARY:${esc(he.title || '')}`)
          if (he.location) lines.push(`LOCATION:${esc(he.location)}`)
          lines.push('END:VEVENT')
        }
      }

      lines.push('END:VCALENDAR')

      const fname = sportFilter ? `kscw-${sportFilter}` : 'kscw'
      res.set('Content-Type', 'text/calendar; charset=utf-8')
      res.set('Content-Disposition', `inline; filename="${fname}.ics"`)
      res.set('Cache-Control', 'public, max-age=3600')
      res.send(lines.join('\r\n'))
    } catch (err) {
      log.error({
        msg: `ical-feed: ${err.message}`,
        endpoint: 'ical-feed',
        method: req.method,
        query: { source: req.query?.source, team: req.query?.team, sport: sportFilter },
        stack: err.stack,
      })
      res.status(500).json({ error: 'Internal error' })
    }
  }

  router.get('/ical', (req, res) => handleFeed(req, res, null))
  router.get('/ical/volleyball', (req, res) => handleFeed(req, res, 'volleyball'))
  router.get('/ical/basketball', (req, res) => handleFeed(req, res, 'basketball'))
}
