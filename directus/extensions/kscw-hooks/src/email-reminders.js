/**
 * Email reminders (migration 442; owner 03.11.2026 after a team poll — 8 of 9
 * voted "yes for both").
 *
 * Two emails, each switchable per member in Profile → Email notifications:
 *
 *   - Answer reminder (`email_notify_rsvp_reminders`): 6 hours before the
 *     answer deadline (`respond_by`, read like the frontend's getDeadlineDate)
 *     of a GAME or EVENT, to everybody expected there who has given no answer
 *     at all — Yes, No and Maybe all count as answered (owner, 03.11.2026).
 *     Trainings and activities without a deadline get none. Checked every 5
 *     minutes; each activity once per member (several due in the same run share
 *     one email).
 *   - Activity reminder (`email_notify_activity_reminders`): one email per
 *     activity the member said Yes or Maybe to, `activity_reminder_lead_minutes`
 *     before it starts. Checked every 5 minutes; a reminder whose moment passed
 *     more than 2 h ago is dropped, so turning the setting on (or a deploy) never
 *     mails a backlog.
 *   - Weekly overview (`email_notify_weekly_digest`, migration 443): Sunday
 *     18:00 Zurich, one email listing the member's trainings, games and events
 *     of the coming Monday–Sunday with their answer (and the deadline while it
 *     is open). Only sent when the week has something. The cron looks again at
 *     19:00 and 20:00 in case 18:00 was missed; a member who already got theirs
 *     is skipped.
 *
 * Who is "expected" follows the existing reminder crons: a team's roster with
 * guest players left out (they are invited, not expected — the deadline sweep
 * reads them the same way), its coaches and team responsibles, a game's
 * called-up guests, and an event's invited teams and people (everybody with an
 * account for a club-wide event). Form-only events, guests on games (they cannot
 * say Yes) and members without an activated account are skipped. Scorer duties
 * keep their own reminder (kscw-endpoints scorer-reminders.js).
 *
 * `email_reminders_sent` is the dedupe log: a row is claimed before the mail goes
 * out and deleted again when the send fails, so the next run retries and two
 * runs never mail twice. Addresses on the suppression list, placeholders and
 * `.invalid` ones (the dev refresh scrubs every address to `@devsink.invalid`)
 * are skipped.
 */
import { buildEmailLayout, buildInfoCard, escHtml, FRONTEND_URL } from '../../kscw-endpoints/src/email-template.js'
import { loadSuppressed, normaliseEmail } from '../../kscw-endpoints/src/email-suppression.js'
import { teamPeopleSql } from '../../kscw-endpoints/src/activity-roster-sql.js'

/** Lead times the profile offers, in minutes. The DB accepts 15 … 10080. */
export const ACTIVITY_REMINDER_LEAD_OPTIONS = Object.freeze([60, 120, 180, 360, 720, 1440, 2880])
/** The answer reminder goes out this long before the deadline. */
export const RSVP_LEAD_HOURS = 6
/** Activity types that get an answer reminder (owner: games and events, not trainings). */
export const RSVP_ACTIVITY_TYPES = Object.freeze(['game', 'event'])
export const ACTIVITY_REMINDER_GRACE_MINUTES = 120
/** Weekly overview: Sunday, from this Zurich hour, with two catch-up hours. */
export const WEEKLY_DIGEST_HOUR_ZURICH = 18
const WEEKLY_DIGEST_LAST_HOUR_ZURICH = 20
/** Look-ahead for loading activities: deadlines can sit weeks before a start. */
const HORIZON_DAYS = 60

const LANG_TO_CODE = { german: 'de', swiss_german: 'gsw', english: 'en', french: 'fr', italian: 'it' }
const WEEKDAY_LOCALE = { de: 'de-CH', gsw: 'de-CH', en: 'en-GB', fr: 'fr-CH', it: 'it-CH' }

// ── SQL ──────────────────────────────────────────────────────────────────────

/**
 * Shared CTEs: `p` (the reference instant), `acts` (upcoming activities that
 * pass `actsFilter`) and `answers` (each member's answers, folded over sessions).
 *
 * @param {object} h helpers owned by the hooks file
 * @param {string} h.gameSquadJoin GAME_SQUAD_JOIN (joins `mt` on `g.id`)
 * @param {(eventRef: string, memberRef: string) => string} h.eventEligibilitySql
 * @param {(col: string, startCol: string) => string} h.effectiveDeadlineSql
 * @param {string} actsFilter SQL over `a` (all_acts) and `p`
 */
function baseCtes(h, actsFilter) {
  const zurichToday = `(p.ts AT TIME ZONE 'Europe/Zurich')::date`
  return `
    WITH p AS (SELECT ?::timestamptz AS ts),
    all_acts AS (
      SELECT 'training'::text AS activity_type, t.id AS pk, t.id::text AS activity_id,
             ((t.date + t.start_time) AT TIME ZONE 'Europe/Zurich') AS starts_at,
             ${h.effectiveDeadlineSql('t.respond_by', 't.start_time')} AS deadline,
             false AS all_day, tm.name::text AS team_name, NULL::text AS title,
             NULL::text AS home_team, NULL::text AS away_team,
             NULLIF(h.name, '')::text AS place, tm.sport::text AS sport
      FROM trainings t
      CROSS JOIN p
      JOIN teams tm ON tm.id = t.team
      LEFT JOIN halls h ON h.id = t.hall
      WHERE t.cancelled = false AND t.start_time IS NOT NULL
        AND t.date BETWEEN ${zurichToday} AND ${zurichToday} + ${HORIZON_DAYS}
      UNION ALL
      SELECT 'game', g.id, g.id::text,
             ((g.date + g."time") AT TIME ZONE 'Europe/Zurich'),
             ${h.effectiveDeadlineSql('g.respond_by', 'g."time"')},
             false, tm.name::text, NULL, g.home_team::text, g.away_team::text,
             NULLIF(h.name, '')::text, tm.sport::text
      FROM games g
      CROSS JOIN p
      JOIN teams tm ON tm.id = g.kscw_team
      LEFT JOIN halls h ON h.id = g.hall
      WHERE g."time" IS NOT NULL
        AND COALESCE(g.status, '') NOT IN ('completed', 'postponed', 'cancelled')
        AND g.date BETWEEN ${zurichToday} AND ${zurichToday} + ${HORIZON_DAYS}
      UNION ALL
      SELECT 'event', e.id, e.id::text, e.start_date,
             ${h.effectiveDeadlineSql('e.respond_by', `(e.start_date AT TIME ZONE 'Europe/Zurich')::time`)},
             e.all_day, NULL, e.title::text, NULL, NULL,
             COALESCE(NULLIF(h.name, ''), NULLIF(e.location, ''))::text, NULL
      FROM events e
      CROSS JOIN p
      LEFT JOIN halls h ON h.id = e.hall
      WHERE e.cancelled = false AND e.form_signup_only = false
        AND e.start_date > p.ts AND e.start_date <= p.ts + interval '${HORIZON_DAYS} days'
    ),
    acts AS (
      SELECT a.* FROM all_acts a CROSS JOIN p
      WHERE a.starts_at > p.ts AND (${actsFilter})
    ),
    answers AS (
      SELECT pa.activity_type, pa.activity_id, pa.member,
             bool_or(pa.status = 'confirmed') AS yes,
             bool_or(pa.status = 'declined') AS no,
             bool_or(pa.status = 'tentative') AS maybe,
             bool_or(pa.status = 'waitlisted') AS waiting
      FROM participations pa
      JOIN acts a ON a.activity_type = pa.activity_type AND a.activity_id = pa.activity_id
      GROUP BY 1, 2, 3
    )`
}

/** Who should answer: added to the shared CTEs by the RSVP query only. */
function expectedCte(h) {
  return `,
    expected AS (
      SELECT a.activity_type, a.activity_id, mt.member
      FROM acts a
      JOIN trainings t ON a.activity_type = 'training' AND t.id = a.pk
      JOIN LATERAL ${teamPeopleSql('t.team')} mt ON true
      WHERE mt.guest_level = 0
      UNION
      SELECT a.activity_type, a.activity_id, mt.member
      FROM acts a
      JOIN games g ON a.activity_type = 'game' AND g.id = a.pk
      ${h.gameSquadJoin}
      WHERE COALESCE(mt.guest_level, 0) = 0
      UNION
      SELECT a.activity_type, a.activity_id, m.id
      FROM acts a
      JOIN events e ON a.activity_type = 'event' AND e.id = a.pk
      JOIN members m ON m.wiedisync_active = true AND ${h.eventEligibilitySql('e.id', 'm.id')}
    )`
}

const SELECT_COLUMNS = `
  a.activity_type, a.activity_id, a.starts_at, a.deadline, a.all_day, a.team_name, a.title,
  a.home_team, a.away_team, a.place, a.sport,
  m.id AS member, m.email, m.first_name, m.language`

/**
 * Members owed an answer reminder: a game or event whose deadline is less than
 * RSVP_LEAD_HOURS away, expected there, and no answer of any kind (no row).
 * @returns {{ sql: string, bindings: any[] }}
 */
export function rsvpCandidatesQuery(h, nowIso) {
  const types = RSVP_ACTIVITY_TYPES.map((t) => `'${t}'`).join(', ')
  const sql = `${baseCtes(h, `a.activity_type IN (${types})
      AND a.deadline > p.ts
      AND a.deadline <= p.ts + interval '${RSVP_LEAD_HOURS} hours'`)}${expectedCte(h)}
    SELECT ${SELECT_COLUMNS}
    FROM expected x
    JOIN acts a ON a.activity_type = x.activity_type AND a.activity_id = x.activity_id
    JOIN members m ON m.id = x.member
    LEFT JOIN answers an
      ON an.activity_type = x.activity_type AND an.activity_id = x.activity_id AND an.member = x.member
    WHERE m.wiedisync_active = true
      AND m.email_notify_rsvp_reminders = true
      AND an.member IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM email_reminders_sent s
        WHERE s.member = m.id AND s.activity_type = a.activity_type
          AND s.activity_id = a.activity_id AND s.kind = 'rsvp'
      )
    ORDER BY m.id, a.deadline, a.activity_type, a.activity_id`
  return { sql, bindings: [nowIso] }
}

/**
 * Members owed an activity reminder now: a Yes or Maybe answer (a Yes on any
 * session of a per-session event counts), their lead time reached within the
 * grace window.
 * @returns {{ sql: string, bindings: any[] }}
 */
export function activityCandidatesQuery(h, nowIso) {
  const reminderAt = `a.starts_at - make_interval(mins => m.activity_reminder_lead_minutes)`
  // Load only as far ahead as the longest lead anybody picked.
  const horizon = `p.ts + make_interval(mins => COALESCE((
      SELECT max(activity_reminder_lead_minutes) FROM members
      WHERE email_notify_activity_reminders = true AND wiedisync_active = true), 0))`
  const sql = `${baseCtes(h, `a.starts_at <= ${horizon}`)}
    SELECT ${SELECT_COLUMNS}, an.yes, an.maybe, m.activity_reminder_lead_minutes AS lead_minutes
    FROM answers an
    JOIN acts a ON a.activity_type = an.activity_type AND a.activity_id = an.activity_id
    JOIN members m ON m.id = an.member
    CROSS JOIN p
    WHERE m.wiedisync_active = true
      AND m.email_notify_activity_reminders = true
      AND (an.yes OR (an.maybe AND NOT an.no AND NOT an.waiting))
      AND ${reminderAt} <= p.ts
      AND ${reminderAt} > p.ts - interval '${ACTIVITY_REMINDER_GRACE_MINUTES} minutes'
      AND NOT EXISTS (
        SELECT 1 FROM email_reminders_sent s
        WHERE s.member = m.id AND s.activity_type = a.activity_type
          AND s.activity_id = a.activity_id AND s.kind = 'activity'
      )
    ORDER BY a.starts_at, m.id`
  return { sql, bindings: [nowIso] }
}

/**
 * The coming Monday–Sunday for every member with the weekly overview on: every
 * activity they are expected at or said Yes / Maybe to, with their answer.
 * Members who already got this week's overview (a 'weekly' log row for one of
 * these activities) are left out, so a catch-up run never sends twice.
 * @returns {{ sql: string, bindings: any[] }}
 */
export function weeklyCandidatesQuery(h, nowIso) {
  // date_trunc('week') is Monday 00:00; +7 days = the coming Monday (run on Sunday).
  const weekStart = `((date_trunc('week', p.ts AT TIME ZONE 'Europe/Zurich') + interval '7 days') AT TIME ZONE 'Europe/Zurich')`
  const weekEnd = `((date_trunc('week', p.ts AT TIME ZONE 'Europe/Zurich') + interval '14 days') AT TIME ZONE 'Europe/Zurich')`
  const sql = `${baseCtes(h, `a.starts_at >= ${weekStart} AND a.starts_at < ${weekEnd}`)}${expectedCte(h)},
    people AS (
      SELECT activity_type, activity_id, member FROM expected
      UNION
      SELECT activity_type, activity_id, member FROM answers WHERE yes OR maybe
    )
    SELECT ${SELECT_COLUMNS},
           COALESCE(an.yes, false) AS yes, COALESCE(an.no, false) AS no,
           COALESCE(an.maybe, false) AS maybe, COALESCE(an.waiting, false) AS waiting
    FROM people x
    JOIN acts a ON a.activity_type = x.activity_type AND a.activity_id = x.activity_id
    JOIN members m ON m.id = x.member
    LEFT JOIN answers an
      ON an.activity_type = x.activity_type AND an.activity_id = x.activity_id AND an.member = x.member
    WHERE m.wiedisync_active = true
      AND m.email_notify_weekly_digest = true
      AND NOT EXISTS (
        SELECT 1 FROM email_reminders_sent s
        JOIN acts a2 ON a2.activity_type = s.activity_type AND a2.activity_id = s.activity_id
        WHERE s.member = m.id AND s.kind = 'weekly'
      )
    ORDER BY m.id, a.starts_at, a.activity_type, a.activity_id`
  return { sql, bindings: [nowIso] }
}

// ── Copy ─────────────────────────────────────────────────────────────────────

const COPY = {
  de: {
    greeting: (name) => `Hallo ${name}`,
    training: 'Training',
    activity: 'Aktivität', date: 'Datum', time: 'Zeit', place: 'Ort',
    allDay: 'Ganztägig',
    answerBy: (d) => `Antworten bis ${d}`,
    footer: (url) => `Du bekommst diese E-Mail, weil die Erinnerungen in deinem Profil eingeschaltet sind. Ausschalten: ${url}`,
    rsvp: {
      subjectOne: (label) => `WiediSync — Deine Antwort fehlt: ${label}`,
      subjectMany: (n) => `WiediSync — Deine Antwort fehlt bei ${n} Aktivitäten`,
      title: 'Deine Antwort fehlt',
      intro: 'Hier hast du noch nicht geantwortet:',
      outro: 'Ein Tipp in der App genügt. So weiss dein Team, mit wem es rechnen kann.',
      cta: 'Jetzt antworten',
    },
    status: { yes: 'Ja', no: 'Nein', maybe: 'Vielleicht', waiting: 'Warteliste', open: 'Noch keine Antwort' },
    yourAnswer: 'Deine Antwort:',
    weekly: {
      subject: (day, open) => `WiediSync — Deine Woche ab ${day}${open ? ` · ${open} offen` : ''}`,
      title: 'Deine Woche',
      intro: 'Das steht nächste Woche an:',
      outroOpen: 'Offene Antworten gibst du mit einem Tipp in der App.',
      outroDone: 'Alles beantwortet. Danke!',
      cta: 'WiediSync öffnen',
    },
    activityMail: {
      subject: (label, when) => `WiediSync — Erinnerung: ${label}, ${when}`,
      title: 'Erinnerung',
      introYes: 'Du bist angemeldet für:',
      introMaybe: 'Du hast «Vielleicht» gesagt für:',
      outroYes: 'Kannst du doch nicht? Sag in der App ab.',
      outroOpen: 'Sag in der App Ja oder Nein, damit dein Team planen kann.',
      cta: 'In WiediSync öffnen',
    },
  },
  gsw: {
    greeting: (name) => `Hoi ${name}`,
    training: 'Training',
    activity: 'Aktivität', date: 'Datum', time: 'Ziit', place: 'Ort',
    allDay: 'Ganztägig',
    answerBy: (d) => `Antwort bis ${d}`,
    footer: (url) => `Du überchunsch die E-Mail, will d Erinnerige i dim Profil iigschalte sind. Uusschalte: ${url}`,
    rsvp: {
      subjectOne: (label) => `WiediSync — Dini Antwort fehlt: ${label}`,
      subjectMany: (n) => `WiediSync — Dini Antwort fehlt bi ${n} Aktivitäte`,
      title: 'Dini Antwort fehlt',
      intro: 'Da häsch nonig gantwortet:',
      outro: 'En Tipp i de App längt. So weiss dis Team, mit wem es cha rächne.',
      cta: 'Jetzt antworte',
    },
    status: { yes: 'Ja', no: 'Nei', maybe: 'Villicht', waiting: 'Wartelischtä', open: 'Nonig gantwortet' },
    yourAnswer: 'Dini Antwort:',
    weekly: {
      subject: (day, open) => `WiediSync — Dini Wuche ab ${day}${open ? ` · ${open} offe` : ''}`,
      title: 'Dini Wuche',
      intro: 'Das staht nächschti Wuche aa:',
      outroOpen: 'Offeni Antworte gisch mit eme Tipp i de App.',
      outroDone: 'Alles beantwortet. Merci!',
      cta: 'WiediSync öffne',
    },
    activityMail: {
      subject: (label, when) => `WiediSync — Erinnerig: ${label}, ${when}`,
      title: 'Erinnerig',
      introYes: 'Du bisch aagmäldet für:',
      introMaybe: 'Du häsch «Villicht» gseit für:',
      outroYes: 'Chasch doch nöd? Mäld di i de App ab.',
      outroOpen: 'Säg i de App Ja oder Nei, dass dis Team cha plane.',
      cta: 'I WiediSync öffne',
    },
  },
  en: {
    greeting: (name) => `Hi ${name}`,
    training: 'Training',
    activity: 'Activity', date: 'Date', time: 'Time', place: 'Place',
    allDay: 'All day',
    answerBy: (d) => `Answer by ${d}`,
    footer: (url) => `You get this email because reminders are switched on in your profile. Switch them off: ${url}`,
    rsvp: {
      subjectOne: (label) => `WiediSync — Your answer is missing: ${label}`,
      subjectMany: (n) => `WiediSync — Your answer is missing for ${n} activities`,
      title: 'Your answer is missing',
      intro: "You haven't answered yet:",
      outro: 'One tap in the app is enough. It tells your team who they can count on.',
      cta: 'Answer now',
    },
    status: { yes: 'Yes', no: 'No', maybe: 'Maybe', waiting: 'Waiting list', open: 'No answer yet' },
    yourAnswer: 'Your answer:',
    weekly: {
      subject: (day, open) => `WiediSync — Your week from ${day}${open ? ` · ${open} open` : ''}`,
      title: 'Your week',
      intro: 'Coming up next week:',
      outroOpen: 'Open answers take one tap in the app.',
      outroDone: 'All answered. Thanks!',
      cta: 'Open WiediSync',
    },
    activityMail: {
      subject: (label, when) => `WiediSync — Reminder: ${label}, ${when}`,
      title: 'Reminder',
      introYes: "You're signed up for:",
      introMaybe: 'You said Maybe to:',
      outroYes: "Can't make it after all? Say No in the app.",
      outroOpen: 'Say Yes or No in the app so your team can plan.',
      cta: 'Open in WiediSync',
    },
  },
  fr: {
    greeting: (name) => `Bonjour ${name}`,
    training: 'Entraînement',
    activity: 'Activité', date: 'Date', time: 'Heure', place: 'Lieu',
    allDay: 'Toute la journée',
    answerBy: (d) => `Répondre d'ici le ${d}`,
    footer: (url) => `Tu reçois cet e-mail parce que les rappels sont activés dans ton profil. Les désactiver : ${url}`,
    rsvp: {
      subjectOne: (label) => `WiediSync — Ta réponse manque : ${label}`,
      subjectMany: (n) => `WiediSync — Ta réponse manque pour ${n} activités`,
      title: 'Ta réponse manque',
      intro: "Tu n'as pas encore répondu ici :",
      outro: "Un geste dans l'app suffit. Ton équipe sait ainsi sur qui compter.",
      cta: 'Répondre maintenant',
    },
    status: { yes: 'Oui', no: 'Non', maybe: 'Peut-être', waiting: "Liste d'attente", open: 'Pas encore répondu' },
    yourAnswer: 'Ta réponse :',
    weekly: {
      subject: (day, open) => `WiediSync — Ta semaine dès le ${day}${open ? ` · ${open} sans réponse` : ''}`,
      title: 'Ta semaine',
      intro: 'Au programme la semaine prochaine :',
      outroOpen: "Les réponses manquantes se donnent d'un geste dans l'app.",
      outroDone: 'Tout est répondu. Merci !',
      cta: 'Ouvrir WiediSync',
    },
    activityMail: {
      subject: (label, when) => `WiediSync — Rappel : ${label}, ${when}`,
      title: 'Rappel',
      introYes: 'Tu as dit Oui pour :',
      introMaybe: 'Tu as répondu « Peut-être » pour :',
      outroYes: "Finalement tu ne peux pas ? Dis Non dans l'app.",
      outroOpen: "Dis Oui ou Non dans l'app pour que ton équipe puisse s'organiser.",
      cta: 'Ouvrir dans WiediSync',
    },
  },
  it: {
    greeting: (name) => `Ciao ${name}`,
    training: 'Allenamento',
    activity: 'Attività', date: 'Data', time: 'Ora', place: 'Luogo',
    allDay: 'Tutto il giorno',
    answerBy: (d) => `Rispondi entro il ${d}`,
    footer: (url) => `Ricevi questa e-mail perché i promemoria sono attivi nel tuo profilo. Disattivarli: ${url}`,
    rsvp: {
      subjectOne: (label) => `WiediSync — Manca la tua risposta: ${label}`,
      subjectMany: (n) => `WiediSync — Manca la tua risposta per ${n} attività`,
      title: 'Manca la tua risposta',
      intro: 'Qui non hai ancora risposto:',
      outro: "Basta un tocco nell'app. Così la tua squadra sa su chi può contare.",
      cta: 'Rispondi ora',
    },
    status: { yes: 'Sì', no: 'No', maybe: 'Forse', waiting: "Lista d'attesa", open: 'Nessuna risposta' },
    yourAnswer: 'La tua risposta:',
    weekly: {
      subject: (day, open) => `WiediSync — La tua settimana da ${day}${open ? ` · ${open} senza risposta` : ''}`,
      title: 'La tua settimana',
      intro: 'In programma la prossima settimana:',
      outroOpen: "Le risposte mancanti si danno con un tocco nell'app.",
      outroDone: 'Tutto risposto. Grazie!',
      cta: 'Apri WiediSync',
    },
    activityMail: {
      subject: (label, when) => `WiediSync — Promemoria: ${label}, ${when}`,
      title: 'Promemoria',
      introYes: 'Sei iscritto/a a:',
      introMaybe: 'Hai risposto «Forse» a:',
      outroYes: "Alla fine non puoi? Rispondi No nell'app.",
      outroOpen: "Rispondi Sì o No nell'app, così la tua squadra può organizzarsi.",
      cta: 'Apri in WiediSync',
    },
  },
}

export function localeFor(language) {
  return LANG_TO_CODE[language] || 'de'
}

// ── Formatting ───────────────────────────────────────────────────────────────

const zurichDate = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric' })
const zurichTime = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hour12: false })

function weekdayShort(d, locale) {
  return new Intl.DateTimeFormat(WEEKDAY_LOCALE[locale] || 'de-CH', { timeZone: 'Europe/Zurich', weekday: 'short' }).format(d)
}

/** "Di., 04.11.2026" — Swiss dot date, weekday in the member's language. */
export function formatDay(value, locale) {
  const d = new Date(value)
  return `${weekdayShort(d, locale)}, ${zurichDate.format(d)}`
}

export function formatTime(value) {
  return zurichTime.format(new Date(value))
}

/** "Di., 04.11.2026, 20:00", or without the time for an all-day event. */
export function formatWhen(item, locale) {
  const day = formatDay(item.starts_at, locale)
  return item.all_day ? day : `${day}, ${formatTime(item.starts_at)}`
}

export function activityLabel(item, locale) {
  const tt = COPY[locale] || COPY.de
  if (item.activity_type === 'training') return `${tt.training} ${item.team_name || ''}`.trim()
  if (item.activity_type === 'game') return `${item.home_team || ''} vs ${item.away_team || ''}`
  return item.title || ''
}

export function activityUrl(item) {
  return `${FRONTEND_URL}/${item.activity_type}s/${item.activity_id}`
}

function sportKey(item) {
  if (item.sport === 'basketball') return 'bb'
  if (item.sport === 'volleyball') return 'vb'
  return undefined
}

const strip = (s) => s.replace(/<[^>]+>/g, '')
const joinLines = (lines) => lines.filter((l, i, a) => l !== '' || (a[i - 1] ?? '') !== '').join('\n').trim()

// ── Content ──────────────────────────────────────────────────────────────────

/**
 * The "your answer is missing" email (one or more activities).
 * @param {object} p
 * @param {string} p.locale de | gsw | en | fr | it
 * @param {string} [p.firstName]
 * @param {Array<object>} p.items candidate rows for one member, soonest first
 */
export function rsvpDigestContent({ locale, firstName, items }) {
  const tt = COPY[locale] || COPY.de
  const profileUrl = `${FRONTEND_URL}/profile`
  const entries = items.map((item) => ({
    label: activityLabel(item, locale),
    when: formatWhen(item, locale),
    place: item.place || '',
    deadline: item.deadline ? tt.answerBy(`${zurichDate.format(new Date(item.deadline))}, ${formatTime(item.deadline)}`) : '',
    url: activityUrl(item),
  }))

  const listHtml = entries.map((e) =>
    '<tr><td style="padding:12px 16px;border-bottom:1px solid #334155">' +
    `<a href="${escHtml(e.url)}" style="font-size:15px;font-weight:600;color:#ffffff;text-decoration:underline">${escHtml(e.label)}</a>` +
    `<div style="font-size:13px;color:#cbd5e1;margin-top:2px">${escHtml([e.when, e.place].filter(Boolean).join(' · '))}</div>` +
    (e.deadline ? `<div style="font-size:13px;color:#fbbf24;margin-top:2px">${escHtml(e.deadline)}</div>` : '') +
    '</td></tr>',
  ).join('')

  const bodyHtml =
    `<div style="font-size:14px;color:#e2e8f0;margin-bottom:12px">${escHtml(tt.rsvp.intro)}</div>` +
    `<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border:1px solid #334155;border-radius:8px;overflow:hidden">${listHtml}</table>` +
    `<div style="font-size:13px;color:#94a3b8;margin-top:16px">${escHtml(tt.rsvp.outro)}</div>`

  // Sport colours when every item shares a sport; the neutral blue needs white text.
  const sports = new Set(items.map(sportKey))
  const sport = sports.size === 1 ? [...sports][0] : undefined
  const html = buildEmailLayout(bodyHtml, {
    title: tt.rsvp.title,
    subtitle: entries.length === 1 ? entries[0].label : undefined,
    sport,
    ...(sport ? {} : { ctaTextColor: '#ffffff' }),
    greeting: firstName ? tt.greeting(firstName) : undefined,
    ctaUrl: entries.length === 1 ? entries[0].url : FRONTEND_URL,
    ctaLabel: tt.rsvp.cta,
    footerExtra: tt.footer(profileUrl),
  })

  const text = joinLines([
    firstName ? `${tt.greeting(firstName)},` : '',
    '',
    tt.rsvp.intro,
    '',
    ...entries.flatMap((e) => [
      `- ${e.label}`,
      `  ${[e.when, e.place].filter(Boolean).join(' · ')}`,
      ...(e.deadline ? [`  ${e.deadline}`] : []),
      `  ${e.url}`,
    ]),
    '',
    tt.rsvp.outro,
    '',
    tt.footer(profileUrl),
  ])

  const subject = entries.length === 1
    ? tt.rsvp.subjectOne(entries[0].label)
    : tt.rsvp.subjectMany(entries.length)
  return { subject, html, text }
}

/**
 * The "coming up" email for one activity.
 * @param {object} p
 * @param {string} p.locale
 * @param {string} [p.firstName]
 * @param {object} p.item candidate row (with yes / maybe; a Maybe-only row asks for an answer)
 */
export function activityReminderContent({ locale, firstName, item }) {
  const tt = COPY[locale] || COPY.de
  const t = tt.activityMail
  const profileUrl = `${FRONTEND_URL}/profile`
  const label = activityLabel(item, locale)
  const when = formatWhen(item, locale)
  const url = activityUrl(item)
  const intro = item.yes ? t.introYes : t.introMaybe
  const outro = item.yes ? t.outroYes : t.outroOpen

  const rows = [
    { label: tt.activity, value: label },
    { label: tt.date, value: formatDay(item.starts_at, locale), halfWidth: true },
    { label: tt.time, value: item.all_day ? tt.allDay : formatTime(item.starts_at), halfWidth: true },
    ...(item.place ? [{ label: tt.place, value: item.place }] : []),
  ]
  const bodyHtml =
    `<div style="font-size:14px;color:#e2e8f0;margin-bottom:16px">${escHtml(intro)}</div>` +
    buildInfoCard(rows) +
    `<div style="font-size:13px;color:#94a3b8;margin-top:16px">${escHtml(outro)}</div>`

  const html = buildEmailLayout(bodyHtml, {
    title: t.title,
    subtitle: label,
    sport: sportKey(item),
    greeting: firstName ? tt.greeting(firstName) : undefined,
    ctaUrl: url,
    ctaLabel: t.cta,
    footerExtra: tt.footer(profileUrl),
  })

  const text = joinLines([
    firstName ? `${tt.greeting(firstName)},` : '',
    '',
    strip(intro),
    `${tt.activity}: ${label}`,
    `${tt.date}: ${when}`,
    ...(item.place ? [`${tt.place}: ${item.place}`] : []),
    '',
    outro,
    url,
    '',
    tt.footer(profileUrl),
  ])
  return { subject: t.subject(label, when), html, text }
}

/** Yes beats a No on another session; then Maybe, waiting list, No, open. */
export function answerStatus(item) {
  if (item.yes) return 'yes'
  if (item.maybe) return 'maybe'
  if (item.waiting) return 'waiting'
  if (item.no) return 'no'
  return 'open'
}

const STATUS_COLOUR = { yes: '#4ade80', no: '#f87171', maybe: '#fbbf24', waiting: '#fbbf24', open: '#fbbf24' }

/**
 * The Sunday overview of the coming week.
 * @param {object} p
 * @param {string} p.locale
 * @param {string} [p.firstName]
 * @param {Array<object>} p.items one member's rows for the week, in start order
 * @param {Date|string} [p.now] the run time (only for "deadline still ahead")
 */
export function weeklyDigestContent({ locale, firstName, items, now = new Date() }) {
  const tt = COPY[locale] || COPY.de
  const t = tt.weekly
  const profileUrl = `${FRONTEND_URL}/profile`
  const nowMs = new Date(now).getTime()
  const entries = items.map((item) => {
    const status = answerStatus(item)
    const deadlineAhead = status === 'open' && item.deadline && new Date(item.deadline).getTime() > nowMs
    return {
      label: activityLabel(item, locale),
      when: formatWhen(item, locale),
      place: item.place || '',
      status,
      answer: `${tt.yourAnswer} ${tt.status[status]}`,
      deadline: deadlineAhead ? tt.answerBy(`${zurichDate.format(new Date(item.deadline))}, ${formatTime(item.deadline)}`) : '',
      url: activityUrl(item),
    }
  })
  const open = entries.filter((e) => e.status === 'open').length
  const firstDay = items.length ? formatDay(items[0].starts_at, locale) : ''

  const listHtml = entries.map((e) =>
    '<tr><td style="padding:12px 16px;border-bottom:1px solid #334155">' +
    `<a href="${escHtml(e.url)}" style="font-size:15px;font-weight:600;color:#ffffff;text-decoration:underline">${escHtml(e.label)}</a>` +
    `<div style="font-size:13px;color:#cbd5e1;margin-top:2px">${escHtml([e.when, e.place].filter(Boolean).join(' · '))}</div>` +
    `<div style="font-size:13px;color:${STATUS_COLOUR[e.status]};margin-top:2px">${escHtml(e.answer)}</div>` +
    (e.deadline ? `<div style="font-size:12px;color:#94a3b8;margin-top:2px">${escHtml(e.deadline)}</div>` : '') +
    '</td></tr>',
  ).join('')

  const outro = open ? t.outroOpen : t.outroDone
  const bodyHtml =
    `<div style="font-size:14px;color:#e2e8f0;margin-bottom:12px">${escHtml(t.intro)}</div>` +
    `<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border:1px solid #334155;border-radius:8px;overflow:hidden">${listHtml}</table>` +
    `<div style="font-size:13px;color:#94a3b8;margin-top:16px">${escHtml(outro)}</div>`

  const html = buildEmailLayout(bodyHtml, {
    title: t.title,
    greeting: firstName ? tt.greeting(firstName) : undefined,
    ctaUrl: FRONTEND_URL,
    ctaLabel: t.cta,
    ctaTextColor: '#ffffff',
    footerExtra: tt.footer(profileUrl),
  })

  const text = joinLines([
    firstName ? `${tt.greeting(firstName)},` : '',
    '',
    t.intro,
    '',
    ...entries.flatMap((e) => [
      `- ${e.label}`,
      `  ${[e.when, e.place].filter(Boolean).join(' · ')}`,
      `  ${e.answer}`,
      ...(e.deadline ? [`  ${e.deadline}`] : []),
      `  ${e.url}`,
    ]),
    '',
    outro,
    '',
    tt.footer(profileUrl),
  ])
  return { subject: t.subject(firstDay, open), html, text }
}

/** True on Sunday between 18:00 and 20:59 Zurich (the 19/20 h runs are catch-ups). */
export function isWeeklyDigestTime(ts = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', weekday: 'short', hour: '2-digit', hour12: false }).formatToParts(ts)
  const weekday = parts.find((x) => x.type === 'weekday')?.value
  const hour = Number(parts.find((x) => x.type === 'hour')?.value)
  return weekday === 'Sun' && hour >= WEEKLY_DIGEST_HOUR_ZURICH && hour <= WEEKLY_DIGEST_LAST_HOUR_ZURICH
}

// ── Sending ──────────────────────────────────────────────────────────────────

function usableEmail(raw) {
  const email = normaliseEmail(raw)
  if (!email || !email.includes('@')) return ''
  if (email.includes('@placeholder') || email.endsWith('.invalid')) return ''
  return email
}

/** Group candidate rows by member, keeping row order. */
export function groupByMember(rows) {
  const byMember = new Map()
  for (const r of rows) {
    if (!byMember.has(r.member)) byMember.set(r.member, [])
    byMember.get(r.member).push(r)
  }
  return byMember
}

/**
 * Claim the log rows for one email; returns the activities actually claimed
 * (another run may have claimed some first).
 */
async function claim(db, memberId, kind, items) {
  const rows = items.map((i) => ({ member: memberId, activity_type: i.activity_type, activity_id: i.activity_id, kind }))
  const claimed = await db('email_reminders_sent')
    .insert(rows)
    .onConflict(['member', 'activity_type', 'activity_id', 'kind'])
    .ignore()
    .returning(['activity_type', 'activity_id'])
  const keys = new Set(claimed.map((c) => `${c.activity_type}:${c.activity_id}`))
  return items.filter((i) => keys.has(`${i.activity_type}:${i.activity_id}`))
}

async function release(db, memberId, kind, items) {
  for (const i of items) {
    await db('email_reminders_sent')
      .where({ member: memberId, activity_type: i.activity_type, activity_id: i.activity_id, kind })
      .delete()
  }
}

/**
 * @param {object} deps
 * @param {import('knex').Knex} deps.database
 * @param {any} deps.services Directus services (MailService)
 * @param {() => Promise<any>} deps.getSchema
 * @param {any} deps.log
 * @param {object} deps.sql { gameSquadJoin, eventEligibilitySql, effectiveDeadlineSql }
 */
export function createEmailReminders({ database, services, getSchema, log, sql }) {
  /**
   * Send one email per job ({ memberId, items }). Claims the log rows first and
   * gives them back when the send fails, so the next run retries.
   */
  async function sendJobs(kind, jobs, buildContent) {
    const result = { emails: jobs.length, sent: 0, skipped: 0, failed: 0 }
    if (jobs.length === 0) return result
    const suppressed = await loadSuppressed(database, jobs.map((j) => usableEmail(j.items[0].email)).filter(Boolean))
    let mail = null
    for (const { memberId, items } of jobs) {
      const email = usableEmail(items[0].email)
      if (!email || suppressed.has(email)) { result.skipped++; continue }
      let claimed = []
      try {
        claimed = await claim(database, memberId, kind, items)
        if (claimed.length === 0) { result.skipped++; continue }
        const content = buildContent({ locale: localeFor(items[0].language), firstName: items[0].first_name, items: claimed })
        if (!mail) {
          const { MailService } = services
          mail = new MailService({ schema: await getSchema(), knex: database })
        }
        await mail.send({ to: email, subject: content.subject, html: content.html, text: content.text })
        result.sent++
      } catch (err) {
        result.failed++
        log?.warn?.({ msg: `[email-reminders] ${kind} for member ${memberId} failed: ${err.message}`, event: 'email_reminder_failed', kind, memberId })
        if (claimed.length) await release(database, memberId, kind, claimed).catch(() => {})
      }
    }
    return result
  }

  /** Candidate rows only — for a dry run or a check on dev. */
  async function rsvpCandidates(now = new Date()) {
    const q = rsvpCandidatesQuery(sql, now.toISOString())
    return (await database.raw(q.sql, q.bindings)).rows
  }

  async function activityCandidates(now = new Date()) {
    const q = activityCandidatesQuery(sql, now.toISOString())
    return (await database.raw(q.sql, q.bindings)).rows
  }

  /** Answer reminders due now: one email per member (usually one activity). */
  async function runRsvpReminders(now = new Date()) {
    const jobs = [...groupByMember(await rsvpCandidates(now))].map(([memberId, items]) => ({ memberId, items }))
    return sendJobs('rsvp', jobs, ({ locale, firstName, items }) => rsvpDigestContent({ locale, firstName, items }))
  }

  /** One email per member and activity whose lead time has come. */
  async function runActivityReminders(now = new Date()) {
    const jobs = (await activityCandidates(now)).map((r) => ({ memberId: r.member, items: [r] }))
    return sendJobs('activity', jobs, ({ locale, firstName, items }) => activityReminderContent({ locale, firstName, item: items[0] }))
  }

  async function weeklyCandidates(now = new Date()) {
    const q = weeklyCandidatesQuery(sql, now.toISOString())
    return (await database.raw(q.sql, q.bindings)).rows
  }

  /** The Sunday overview: one email per member with something next week. */
  async function runWeeklyDigest(now = new Date()) {
    const jobs = [...groupByMember(await weeklyCandidates(now))].map(([memberId, items]) => ({ memberId, items }))
    return sendJobs('weekly', jobs, ({ locale, firstName, items }) => weeklyDigestContent({ locale, firstName, items, now }))
  }

  return { runRsvpReminders, runActivityReminders, runWeeklyDigest, rsvpCandidates, activityCandidates, weeklyCandidates }
}
