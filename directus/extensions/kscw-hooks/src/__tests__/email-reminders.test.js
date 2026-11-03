import { describe, it, expect, vi } from 'vitest'
import {
  rsvpCandidatesQuery, activityCandidatesQuery, rsvpDigestContent, activityReminderContent,
  weeklyCandidatesQuery, weeklyDigestContent, isWeeklyDigestTime, answerStatus, groupByMember, localeFor, activityLabel, createEmailReminders,
} from '../email-reminders.js'

const h = {
  gameSquadJoin: 'JOIN game_squad mt ON mt.game = g.id',
  eventEligibilitySql: (e, m) => `eligible(${e}, ${m})`,
  effectiveDeadlineSql: (col, start) => `deadline(${col}, ${start})`,
}

// Tue 04.11.2026 20:00 Zurich (CET = UTC+1)
const training = {
  activity_type: 'training', activity_id: '42', starts_at: '2026-11-04T19:00:00Z',
  deadline: '2026-11-04T08:00:00Z', all_day: false, team_name: 'H3', place: 'KWI A',
  sport: 'volleyball', member: 8, email: 'anna@example.ch', first_name: 'Anna', language: 'german',
}
const game = {
  ...training, activity_type: 'game', activity_id: '7', home_team: 'KSC Wiedikon H3',
  away_team: 'VBC <Züri>', team_name: 'H3', deadline: null,
}

describe('candidate queries', () => {
  it('answer reminder: games and events, 6 h before the deadline, only without any answer', () => {
    const { sql, bindings } = rsvpCandidatesQuery(h, '2026-11-03T17:05:00Z')
    expect(bindings).toEqual(['2026-11-03T17:05:00Z'])
    expect(sql.match(/\?/g)).toHaveLength(1)
    expect(sql).toContain("a.activity_type IN ('game', 'event')")
    expect(sql).toContain("a.deadline <= p.ts + interval '6 hours'")
    expect(sql).toContain('a.deadline > p.ts')
    // Yes, No and Maybe all count as an answer: no participation row at all.
    expect(sql).toContain('AND an.member IS NULL')
    expect(sql).toContain('m.email_notify_rsvp_reminders = true')
    expect(sql).toContain("s.kind = 'rsvp'")
    // guests stay out: roster guest players and guests on games
    expect(sql).toContain('WHERE mt.guest_level = 0')
    expect(sql).toContain('COALESCE(mt.guest_level, 0) = 0')
    expect(sql).toContain('JOIN game_squad mt ON mt.game = g.id')
    expect(sql).toContain('eligible(e.id, m.id)')
    expect(sql).toContain('e.form_signup_only = false')
  })

  it('activity: games and events, Yes or Maybe only, per-member lead time with a grace window', () => {
    const { sql, bindings } = activityCandidatesQuery(h, '2026-11-03T17:05:00Z')
    expect(bindings).toEqual(['2026-11-03T17:05:00Z'])
    expect(sql.match(/\?/g)).toHaveLength(1)
    expect(sql).toContain("a.activity_type IN ('game', 'event')")
    expect(sql).toContain('an.yes OR (an.maybe AND NOT an.no AND NOT an.waiting)')
    expect(sql).toContain('make_interval(mins => m.activity_reminder_lead_minutes) <= p.ts')
    expect(sql).toContain("> p.ts - interval '120 minutes'")
    expect(sql).toContain('m.email_notify_activity_reminders = true')
    expect(sql).toContain("s.kind = 'activity'")
    expect(sql).not.toContain('expected AS')
  })

  it('skips cancelled and finished activities', () => {
    const { sql } = rsvpCandidatesQuery(h, '2026-11-03T17:05:00Z')
    expect(sql).toContain('t.cancelled = false')
    expect(sql).toContain("NOT IN ('completed', 'postponed', 'cancelled')")
    expect(sql).toContain('e.cancelled = false')
  })
})

describe('content', () => {
  it('RSVP digest, one item: label in subject, deadline and link', () => {
    const c = rsvpDigestContent({ locale: 'de', firstName: 'Anna', items: [training] })
    expect(c.subject).toBe('WiediSync — Deine Antwort fehlt: Training H3')
    expect(c.text).toContain('Hallo Anna,')
    // Weekday abbreviations come from ICU ("Mi" or "Mi."), the date format is fixed.
    expect(c.text).toMatch(/Mi\.?, 04\.11\.2026, 20:00 · KWI A/)
    expect(c.text).toContain('Ausschalten: https://')
    expect(c.text).toContain('Antworten bis 04.11.2026, 09:00')
    expect(c.text).toMatch(/\/trainings\/42$/m)
    expect(c.html).toContain('/trainings/42')
    expect(c.text).toContain('/profile')
  })

  it('RSVP digest, several items: count in subject, HTML escaped', () => {
    const c = rsvpDigestContent({ locale: 'en', firstName: 'Anna', items: [training, game] })
    expect(c.subject).toBe('WiediSync — Your answer is missing for 2 activities')
    expect(c.text).toContain("You haven't answered yet:")
    expect(c.text).not.toContain('Maybe')
    expect(c.html).toContain('VBC &lt;Züri&gt;')
    expect(c.html).not.toContain('VBC <Züri>')
  })

  it('activity reminder: Yes vs Maybe wording, per locale', () => {
    const yes = activityReminderContent({ locale: 'fr', firstName: 'Anna', item: { ...training, yes: true } })
    expect(yes.subject).toMatch(/^WiediSync — Rappel : Entraînement H3, Mer\.?, 04\.11\.2026, 20:00$/)
    expect(yes.text).toContain('Pour les désactiver : https://')
    const itYes = activityReminderContent({ locale: 'it', item: { ...game, yes: true } })
    expect(itYes.subject).toMatch(/, Mer\.?, 04\.11\.2026, 20:00$/)
    expect(itYes.text).toContain('Non riesci? Cambia la tua partecipazione.')
    expect(itYes.text).toContain('Per disattivarli: https://')
    expect(yes.text).toContain('Tu as dit Oui pour :')
    const maybe = activityReminderContent({ locale: 'it', item: { ...game, yes: false, maybe: true } })
    expect(maybe.text).toContain('Hai risposto «Forse» a:')
    expect(maybe.text).toContain("Rispondi Sì o No nell'app")
    expect(maybe.text).not.toContain('Ciao')
  })

  it('all-day event: no time', () => {
    const ev = { ...training, activity_type: 'event', title: 'GV', all_day: true, starts_at: '2026-11-07T23:00:00Z' }
    const c = activityReminderContent({ locale: 'en', item: { ...ev, yes: true } })
    expect(c.subject).toMatch(/^WiediSync — Reminder: GV, Sun\.?, 08\.11\.2026$/)
    expect(c.html).toContain('All day')
  })

  it('falls back to German for unknown languages', () => {
    expect(localeFor('klingon')).toBe('de')
    expect(localeFor('swiss_german')).toBe('gsw')
    expect(activityLabel(training, 'xx')).toBe('Training H3')
  })
})

describe('helpers', () => {
  it('groups rows by member in order', () => {
    const g = groupByMember([{ member: 1, a: 1 }, { member: 2, a: 2 }, { member: 1, a: 3 }])
    expect([...g.keys()]).toEqual([1, 2])
    expect(g.get(1).map((r) => r.a)).toEqual([1, 3])
  })
})

// Minimal knex stand-in: raw() for the candidate query, the log table for
// claim / release, email_suppressions for loadSuppressed.
function fakeDb(rows, { suppressed = [] } = {}) {
  const log = new Set()
  const key = (r) => `${r.member}|${r.activity_type}|${r.activity_id}|${r.kind}`
  const db = (table) => {
    if (table === 'email_suppressions') {
      const q = { whereIn: () => q, whereNull: () => q, select: async () => suppressed.map((email) => ({ email })), pluck: async () => suppressed }
      return q
    }
    if (table !== 'email_reminders_sent') throw new Error(`unexpected table ${table}`)
    let inserting = []
    let where = null
    const q = {
      insert: (r) => { inserting = r; return q },
      onConflict: () => q,
      ignore: () => q,
      returning: async () => inserting.filter((r) => !log.has(key(r)) && log.add(key(r))),
      where: (w) => { where = w; return q },
      delete: async () => { log.delete(key(where)); return 1 },
    }
    return q
  }
  db.raw = async () => ({ rows })
  db.log = log
  return db
}

function deps(db, send) {
  return {
    database: db,
    services: { MailService: class { send(m) { return send(m) } } },
    getSchema: async () => ({}),
    log: { warn: vi.fn() },
    sql: h,
  }
}

describe('sending', () => {
  it('one digest per member, logged, and never twice', async () => {
    const rows = [training, { ...game, member: 8 }, { ...training, member: 9, email: 'ben@example.ch', first_name: 'Ben', language: 'english' }]
    const db = fakeDb(rows)
    const send = vi.fn(async () => {})
    const r = createEmailReminders(deps(db, send))
    expect(await r.runRsvpReminders(new Date('2026-11-03T17:05:00Z'))).toMatchObject({ emails: 2, sent: 2, failed: 0 })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0][0].subject).toBe('WiediSync — Deine Antwort fehlt bei 2 Aktivitäten')
    expect(send.mock.calls[1][0]).toMatchObject({ to: 'ben@example.ch', subject: 'WiediSync — Your answer is missing: Training H3' })
    expect(db.log.size).toBe(3)
    // Same candidates again (e.g. a second run before the log is read): nothing new is sent.
    expect(await r.runRsvpReminders()).toMatchObject({ sent: 0, skipped: 2 })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('a failed send gives its claim back so the next run retries', async () => {
    const db = fakeDb([{ ...training, yes: true }])
    const send = vi.fn(async () => { throw new Error('SES down') })
    const d = deps(db, send)
    const r = createEmailReminders(d)
    expect(await r.runActivityReminders()).toMatchObject({ sent: 0, failed: 1 })
    expect(db.log.size).toBe(0)
    expect(d.log.warn).toHaveBeenCalled()
  })

  it('skips placeholder, scrubbed dev and suppressed addresses', async () => {
    const rows = [
      { ...training, member: 1, email: 'x@placeholder.kscw.ch', yes: true },
      { ...training, member: 2, email: 'member_2@devsink.invalid', yes: true },
      { ...training, member: 3, email: 'Bounced@Example.ch', yes: true },
      { ...training, member: 4, email: '', yes: true },
    ]
    const db = fakeDb(rows, { suppressed: ['bounced@example.ch'] })
    const send = vi.fn(async () => {})
    const r = createEmailReminders(deps(db, send))
    expect(await r.runActivityReminders()).toMatchObject({ emails: 4, sent: 0, skipped: 4 })
    expect(send).not.toHaveBeenCalled()
  })
})

describe('weekly overview', () => {
  it('query: the coming Monday–Sunday, expected people plus Yes/Maybe, once per member', () => {
    const { sql, bindings } = weeklyCandidatesQuery(h, '2026-11-08T17:05:00Z')
    expect(bindings).toEqual(['2026-11-08T17:05:00Z'])
    expect(sql.match(/\?/g)).toHaveLength(1)
    expect(sql).toContain("date_trunc('week', p.ts AT TIME ZONE 'Europe/Zurich') + interval '7 days'")
    expect(sql).toContain("date_trunc('week', p.ts AT TIME ZONE 'Europe/Zurich') + interval '14 days'")
    expect(sql).toContain('SELECT activity_type, activity_id, member FROM answers WHERE yes OR maybe')
    expect(sql).toContain('m.email_notify_weekly_digest = true')
    expect(sql).toContain("s.kind = 'weekly'")
  })

  it('Sunday 18:00–20:59 Zurich only, across DST', () => {
    expect(isWeeklyDigestTime(new Date('2026-11-08T17:05:00Z'))).toBe(true) // Sun 18:05 CET
    expect(isWeeklyDigestTime(new Date('2026-11-08T19:05:00Z'))).toBe(true) // Sun 20:05 CET
    expect(isWeeklyDigestTime(new Date('2026-11-08T20:05:00Z'))).toBe(false) // Sun 21:05
    expect(isWeeklyDigestTime(new Date('2026-07-05T16:05:00Z'))).toBe(true) // Sun 18:05 CEST
    expect(isWeeklyDigestTime(new Date('2026-11-07T17:05:00Z'))).toBe(false) // Saturday
  })

  it('answer status: a Yes on any session wins, then Maybe, waiting list, No, open', () => {
    expect(answerStatus({ yes: true, no: true })).toBe('yes')
    expect(answerStatus({ maybe: true, no: true })).toBe('maybe')
    expect(answerStatus({ waiting: true })).toBe('waiting')
    expect(answerStatus({ no: true })).toBe('no')
    expect(answerStatus({})).toBe('open')
  })

  it('content: every activity with its answer, open count in the subject, deadline only while ahead', () => {
    const now = '2026-11-08T17:05:00Z'
    const items = [
      { ...training, starts_at: '2026-11-09T19:00:00Z', deadline: '2026-11-09T12:00:00Z', yes: true },
      { ...game, starts_at: '2026-11-14T13:00:00Z', deadline: '2026-11-12T22:59:00Z' },
      { ...training, activity_id: '43', starts_at: '2026-11-11T19:00:00Z', deadline: '2026-11-08T12:00:00Z' },
    ]
    const c = weeklyDigestContent({ locale: 'de', firstName: 'Anna', items, now })
    expect(c.subject).toMatch(/^WiediSync — Deine Woche ab Mo\.?, 09\.11\.2026 · 2 offen$/)
    expect(c.text).toContain('Deine Antwort: Ja')
    expect(c.text).toContain('Deine Antwort: Noch keine Antwort')
    expect(c.text).toContain('Antworten bis 12.11.2026, 23:59')
    expect(c.text).not.toContain('Antworten bis 08.11.2026')
    expect(c.text).toContain('Offene Antworten gibst du mit einem Tipp in der App.')
    expect(c.html).toContain('VBC &lt;Züri&gt;')
    const done = weeklyDigestContent({ locale: 'en', items: [{ ...training, yes: true }], now })
    expect(done.subject).not.toContain('open')
    expect(done.text).toContain('All answered. Thanks!')
  })

  it('sends one overview per member and logs every listed activity', async () => {
    const rows = [
      { ...training, yes: true },
      { ...game },
      { ...training, member: 9, email: 'ben@example.ch', first_name: 'Ben', language: 'french', no: true },
    ]
    const db = fakeDb(rows)
    const send = vi.fn(async () => {})
    const r = createEmailReminders(deps(db, send))
    expect(await r.runWeeklyDigest(new Date('2026-11-01T17:05:00Z'))).toMatchObject({ emails: 2, sent: 2 })
    expect(send.mock.calls[1][0].text).toContain('Ta réponse : Non')
    expect(db.log.size).toBe(3)
  })
})
