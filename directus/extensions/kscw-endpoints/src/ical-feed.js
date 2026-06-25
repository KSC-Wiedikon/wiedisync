/**
 * iCal Feed — ported from ical_feed_lib.js
 * GET /kscw/ical — all sports
 * GET /kscw/ical/volleyball — volleyball only
 * GET /kscw/ical/basketball — basketball only
 * Query: ?source=games-home,trainings,events,closures,hall&team=1,2,3
 */

import { randomBytes } from 'node:crypto'
import { writeUserLog } from './activity-log.js'

// Frontend app base for the "view roster" deep-link on duty events. Overridable
// per environment; defaults to prod.
const APP_BASE = (process.env.PUBLIC_APP_URL || 'https://wiedisync.kscw.ch').replace(/\/$/, '')

// Duty roles → assigned-member FK on `games`, with the German label shown in the
// calendar and whether the role grants roster access (only the SCORER roles do).
const DUTY_ROLES = [
  { member: 'scorer_member', label: 'Schreiben', roster: true },
  { member: 'scoreboard_member', label: 'Tafel', roster: false },
  { member: 'scorer_scoreboard_member', label: 'Schreiben/Tafel', roster: true },
  { member: 'bb_scorer_member', label: 'Anschreiben', roster: true },
  { member: 'bb_timekeeper_member', label: 'Zeitnehmen', roster: false },
  { member: 'bb_24s_official', label: '24-Sekunden', roster: false },
]

const newIcalToken = () => randomBytes(24).toString('hex') // 48 hex chars (≤ varchar(64))

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
      // `source` and `team` accept three shapes, in any mix:
      //   • repeated params   ?source=games-home&source=trainings   (Express → array)
      //   • comma list        ?source=games-home,trainings          (legacy — existing subscriptions)
      //   • the `all` keyword  ?source=all  → every event-type source (games + trainings
      //                        + events). The admin-ish closures/hall stay opt-in by name.
      const toList = (v) => (Array.isArray(v) ? v : v != null ? [v] : [])
        .flatMap((s) => String(s).split(','))
        .map((s) => s.trim())
        .filter(Boolean)

      const ALL_SOURCES = ['games-home', 'games-away', 'trainings', 'events']
      // `duties` is personal (token-scoped) and never part of `all` — it stays
      // opt-in by name so the public team feed can't leak who has which duty.
      const VALID_SOURCES = new Set([...ALL_SOURCES, 'closures', 'hall', 'duties'])
      const requested = toList(req.query.source)
      const resolved = requested.includes('all')
        ? ALL_SOURCES
        : requested.filter((s) => VALID_SOURCES.has(s))
      const sources = resolved.length
        ? Object.fromEntries(resolved.map((s) => [s, true]))
        : { 'games-home': true, 'games-away': true }
      let teamIds = toList(req.query.team).filter((s) => /^\d+$/.test(s))
      // Capture the user's explicit team selection BEFORE the sport filter below
      // expands an empty selection to every team — the calendar name should only
      // name teams the subscriber actually asked for.
      const explicitTeamIds = [...teamIds]

      // Sport filter
      if (sportFilter) {
        const sportTeams = await database('teams').where('sport', sportFilter).where('active', true).select('id')
        const sportIds = new Set(sportTeams.map(t => String(t.id)))
        teamIds = teamIds.length ? teamIds.filter(id => sportIds.has(id)) : [...sportIds]
      }

      // Friendlier calendar name — full club name, plus the team(s) when the
      // subscriber filtered to one, so their calendar app shows e.g.
      // "KSC Wiedikon – H1" instead of a generic "KSCW - Kalender".
      let teamLabel = ''
      if (explicitTeamIds.length) {
        const rows = await database('teams').whereIn('id', explicitTeamIds).select('name')
        teamLabel = rows.map((r) => r.name).filter(Boolean).join(', ')
      }
      const sportLabel = sportFilter === 'volleyball' ? 'Volleyball' : sportFilter === 'basketball' ? 'Basketball' : ''
      let calName = 'KSC Wiedikon'
      if (sportLabel) calName += ` – ${sportLabel}`
      if (teamLabel) calName += ` – ${teamLabel}`
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

        // Hall lookup → LOCATION (venue name + address), mirroring the duties feed.
        const hallById = games.some((g) => g.hall)
          ? Object.fromEntries(
              (await database('halls').select('id', 'name', 'address', 'city')).map((h) => [h.id, h]),
            )
          : {}

        for (const g of games) {
          if (!g.date) continue
          const d = toISO(g.date)
          let title = `${g.home_team || ''} - ${g.away_team || ''}`
          if (g.status === 'completed') title += ` (${g.home_score}:${g.away_score})`

          // Referees from the SVRZ importer as [{ name, id }] — the json column may
          // surface as a string or a parsed array depending on the driver. Rendered
          // as "F. Lastname" (first initial + remainder of the name).
          let refs = g.referees_json
          if (typeof refs === 'string') { try { refs = JSON.parse(refs) } catch { refs = [] } }
          const shortRef = (full) => {
            // First initial + everything after the first name, so compound /
            // multi-part surnames ("von der Heide") are kept in full.
            const s = String(full).trim()
            const i = s.indexOf(' ')
            return i > 0 ? `${s[0]}. ${s.slice(i + 1)}` : s
          }
          const refNames = (Array.isArray(refs) ? refs : []).map((r) => r?.name).filter(Boolean).map(shortRef)

          const descParts = [g.league || '']
          if (g.status === 'postponed') descParts[0] += ' [VERSCHOBEN]'
          if (refNames.length) descParts.push(`Schiedsrichter: ${refNames.join(', ')}`)
          const desc = descParts.filter(Boolean).join('\n')

          // Venue: KSCW home games carry a hall FK; away games store the opponent
          // venue inline as away_hall_json. Fall back to it so away fixtures also
          // get a LOCATION (the case where directions actually matter).
          let venue = g.hall ? hallById[g.hall] : null
          if (!venue && g.away_hall_json) {
            venue = g.away_hall_json
            if (typeof venue === 'string') { try { venue = JSON.parse(venue) } catch { venue = null } }
          }
          const location = venue
            ? [venue.name, venue.address, venue.city].map((s) => String(s || '').trim()).filter(Boolean).join(', ')
            : ''

          lines.push('BEGIN:VEVENT', `UID:${g.id}@kscw.ch`, `DTSTAMP:${now}`)
          if (g.time) {
            lines.push(`DTSTART;TZID=Europe/Zurich:${fmtLocal(d, g.time)}`)
            lines.push(`DTEND;TZID=Europe/Zurich:${fmtOff(d, g.time, 2)}`)
          } else {
            lines.push(`DTSTART;VALUE=DATE:${fmtDate(d)}`, `DTEND;VALUE=DATE:${fmtDate(nextDay(d))}`)
          }
          lines.push(`SUMMARY:${esc(title)}`)
          if (location) lines.push(`LOCATION:${esc(location)}`)
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

      // Personal scorer/scoreboard duties — token-scoped to one member. The
      // token IS the auth (the feed is public); it only exposes a duty schedule,
      // never PII. Events are marked busy + confirmed so they auto-populate as
      // accepted entries in a subscribed calendar (a feed has no RSVP step).
      if (sources['duties']) {
        const token = String(req.query.token || '').trim()
        const dutyMember = token
          ? await database('members').where('ical_token', token).first('id')
          : null
        if (dutyMember) {
          const dutyGames = await database('games')
            .where((qb) => { for (const r of DUTY_ROLES) qb.orWhere(r.member, dutyMember.id) })
            .orderBy('date')
          const hallNames = dutyGames.length
            ? Object.fromEntries((await database('halls').select('id', 'name')).map((h) => [h.id, h.name]))
            : {}
          for (const g of dutyGames) {
            if (!g.date) continue
            const d = toISO(g.date)
            for (const r of DUTY_ROLES) {
              if (g[r.member] == null || Number(g[r.member]) !== Number(dutyMember.id)) continue
              const matchup = `${g.home_team || ''} - ${g.away_team || ''}`
              const summary = `Einsatz ${r.label}: ${matchup}`
              const rosterUrl = `${APP_BASE}/scorer?roster=${g.id}`
              lines.push('BEGIN:VEVENT', `UID:duty-${g.id}-${r.member}@kscw.ch`, `DTSTAMP:${now}`)
              if (g.time) {
                lines.push(`DTSTART;TZID=Europe/Zurich:${fmtLocal(d, g.time)}`)
                lines.push(`DTEND;TZID=Europe/Zurich:${fmtOff(d, g.time, 2)}`)
              } else {
                lines.push(`DTSTART;VALUE=DATE:${fmtDate(d)}`, `DTEND;VALUE=DATE:${fmtDate(nextDay(d))}`)
              }
              lines.push(`SUMMARY:${esc(summary)}`)
              if (g.hall && hallNames[g.hall]) lines.push(`LOCATION:${esc(hallNames[g.hall])}`)
              const descParts = [g.league || '', matchup]
              if (r.roster) descParts.push(`Aufstellung: ${rosterUrl}`)
              lines.push(`DESCRIPTION:${esc(descParts.filter(Boolean).join('\n'))}`)
              if (r.roster) lines.push(`URL:${rosterUrl}`)
              // Auto-accepted / busy in subscribed calendar apps.
              lines.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'X-MICROSOFT-CDO-BUSYSTATUS:BUSY')
              // Remind 1h before (covers the 30-min arrival rule + travel).
              lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`, 'TRIGGER:-PT60M', 'END:VALARM')
              lines.push('END:VEVENT')
            }
          }
        }
      }

      lines.push('END:VCALENDAR')

      const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      const fnameParts = ['kscw']
      if (sportFilter) fnameParts.push(sportFilter)
      if (explicitTeamIds.length === 1 && teamLabel) fnameParts.push(slug(teamLabel))
      const fname = fnameParts.join('-')
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

  // Personal iCal token — the caller's own subscription secret. The app reads it
  // to build the `?source=duties&token=…` link; lazily generated for members
  // created after migration 125.
  router.get('/me/ical-token', async (req, res) => {
    try {
      const userId = req.accountability?.user
      if (!userId) return res.status(401).json({ error: 'Authentication required' })
      const m = await database('members').where('user', userId).first('id', 'ical_token')
      if (!m) return res.status(404).json({ error: 'No member for this account' })
      let token = m.ical_token
      if (!token) {
        token = newIcalToken()
        await database('members').where('id', m.id).update({ ical_token: token })
      }
      res.json({ data: { token } })
    } catch (err) {
      log.error({ msg: `me/ical-token: ${err.message}`, endpoint: 'me/ical-token', userId: req.accountability?.user || null, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // Rotate the token — invalidates the old subscription URL. Audit-logged.
  router.post('/me/ical-token/rotate', async (req, res) => {
    try {
      const userId = req.accountability?.user
      if (!userId) return res.status(401).json({ error: 'Authentication required' })
      const m = await database('members').where('user', userId).first('id')
      if (!m) return res.status(404).json({ error: 'No member for this account' })
      const token = newIcalToken()
      await database('members').where('id', m.id).update({ ical_token: token })
      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'rotate',
        collection: 'members',
        recordId: m.id,
        data: { what: 'ical_token_rotate' },
      })
      res.json({ data: { token } })
    } catch (err) {
      log.error({ msg: `me/ical-token/rotate: ${err.message}`, endpoint: 'me/ical-token/rotate', userId: req.accountability?.user || null, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
