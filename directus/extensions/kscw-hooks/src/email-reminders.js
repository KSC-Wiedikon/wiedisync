/**
 * Email reminders (migration 442; owner 03.11.2026 after a team poll — 8 of 9
 * voted "yes for both").
 *
 * Two emails, each switchable per member in Profile → Email notifications:
 *
 *   - RSVP digest (`email_notify_rsvp_reminders`): once a day at 18:00 Zurich,
 *     one email listing every activity with an answer deadline that the member
 *     is expected at and has not answered Yes or No to — a Maybe counts as not
 *     answered. An activity is listed once, when its deadline (`respond_by`,
 *     read like the frontend's getDeadlineDate) is less than 48 h away.
 *     Activities without a deadline are left out on purpose: on dev data
 *     (03.11.2026) the teams that set deadlines answer 96–100 % of their
 *     trainings, while most teams without one answer 0–12 % — they don't use
 *     RSVP, and a nightly email to every player (kids' teams included) about it
 *     would be spam. A team that wants the reminder sets a deadline.
 *   - Activity reminder (`email_notify_activity_reminders`): one email per
 *     activity the member said Yes or Maybe to, `activity_reminder_lead_minutes`
 *     before it starts. Checked every 5 minutes; a reminder whose moment passed
 *     more than 2 h ago is dropped, so turning the setting on (or a deploy) never
 *     mails a backlog.
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
export const RSVP_WINDOW_HOURS = 48
export const RSVP_DIGEST_HOUR_ZURICH = 18
export const ACTIVITY_REMINDER_GRACE_MINUTES = 120
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
 * Members owed an RSVP reminder: expected, no Yes / No / waiting-list row
 * (a Maybe still counts as unanswered), deadline within the window.
 * @returns {{ sql: string, bindings: any[] }}
 */
export function rsvpCandidatesQuery(h, nowIso) {
  const sql = `${baseCtes(h, `a.deadline > p.ts
      AND a.deadline <= p.ts + interval '${RSVP_WINDOW_HOURS} hours'`)}${expectedCte(h)}
    SELECT ${SELECT_COLUMNS}, COALESCE(an.maybe, false) AS maybe
    FROM expected x
    JOIN acts a ON a.activity_type = x.activity_type AND a.activity_id = x.activity_id
    JOIN members m ON m.id = x.member
    LEFT JOIN answers an
      ON an.activity_type = x.activity_type AND an.activity_id = x.activity_id AND an.member = x.member
    WHERE m.wiedisync_active = true
      AND m.email_notify_rsvp_reminders = true
      AND NOT COALESCE(an.yes, false) AND NOT COALESCE(an.no, false) AND NOT COALESCE(an.waiting, false)
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

// ── Copy ─────────────────────────────────────────────────────────────────────

const COPY = {
  de: {
    greeting: (name) => `Hallo ${name}`,
    training: 'Training',
    activity: 'Aktivität', date: 'Datum', time: 'Zeit', place: 'Ort',
    allDay: 'Ganztägig',
    answerBy: (d) => `Antworten bis ${d}`,
    saidMaybe: 'Du hast «Vielleicht» gesagt.',
    footer: (url) => `Du bekommst diese E-Mail, weil die Erinnerungen in deinem Profil eingeschaltet sind. Ausschalten: ${url}`,
    rsvp: {
      subjectOne: (label) => `WiediSync — Deine Antwort fehlt: ${label}`,
      subjectMany: (n) => `WiediSync — Deine Antwort fehlt bei ${n} Aktivitäten`,
      title: 'Deine Antwort fehlt',
      intro: 'Hier hast du noch nicht Ja oder Nein gesagt:',
      outro: 'Ein Tipp in der App genügt. So weiss dein Team, mit wem es rechnen kann.',
      cta: 'Jetzt antworten',
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
    saidMaybe: 'Du häsch «Villicht» gseit.',
    footer: (url) => `Du überchunsch die E-Mail, will d Erinnerige i dim Profil iigschalte sind. Uusschalte: ${url}`,
    rsvp: {
      subjectOne: (label) => `WiediSync — Dini Antwort fehlt: ${label}`,
      subjectMany: (n) => `WiediSync — Dini Antwort fehlt bi ${n} Aktivitäte`,
      title: 'Dini Antwort fehlt',
      intro: 'Da häsch nonig Ja oder Nei gseit:',
      outro: 'En Tipp i de App längt. So weiss dis Team, mit wem es cha rächne.',
      cta: 'Jetzt antworte',
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
    saidMaybe: 'You said Maybe.',
    footer: (url) => `You get this email because reminders are switched on in your profile. Switch them off: ${url}`,
    rsvp: {
      subjectOne: (label) => `WiediSync — Your answer is missing: ${label}`,
      subjectMany: (n) => `WiediSync — Your answer is missing for ${n} activities`,
      title: 'Your answer is missing',
      intro: "You haven't said Yes or No to these yet:",
      outro: 'One tap in the app is enough. It tells your team who they can count on.',
      cta: 'Answer now',
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
    saidMaybe: 'Tu as répondu « Peut-être ».',
    footer: (url) => `Tu reçois cet e-mail parce que les rappels sont activés dans ton profil. Les désactiver : ${url}`,
    rsvp: {
      subjectOne: (label) => `WiediSync — Ta réponse manque : ${label}`,
      subjectMany: (n) => `WiediSync — Ta réponse manque pour ${n} activités`,
      title: 'Ta réponse manque',
      intro: "Tu n'as pas encore répondu Oui ou Non ici :",
      outro: "Un geste dans l'app suffit. Ton équipe sait ainsi sur qui compter.",
      cta: 'Répondre maintenant',
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
    saidMaybe: 'Hai risposto «Forse».',
    footer: (url) => `Ricevi questa e-mail perché i promemoria sono attivi nel tuo profilo. Disattivarli: ${url}`,
    rsvp: {
      subjectOne: (label) => `WiediSync — Manca la tua risposta: ${label}`,
      subjectMany: (n) => `WiediSync — Manca la tua risposta per ${n} attività`,
      title: 'Manca la tua risposta',
      intro: 'Qui non hai ancora risposto Sì o No:',
      outro: "Basta un tocco nell'app. Così la tua squadra sa su chi può contare.",
      cta: 'Rispondi ora',
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
 * The daily "your answer is missing" email.
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
    maybe: !!item.maybe,
    url: activityUrl(item),
  }))

  const listHtml = entries.map((e) =>
    '<tr><td style="padding:12px 16px;border-bottom:1px solid #334155">' +
    `<a href="${escHtml(e.url)}" style="font-size:15px;font-weight:600;color:#ffffff;text-decoration:underline">${escHtml(e.label)}</a>` +
    `<div style="font-size:13px;color:#cbd5e1;margin-top:2px">${escHtml([e.when, e.place].filter(Boolean).join(' · '))}</div>` +
    (e.deadline ? `<div style="font-size:13px;color:#fbbf24;margin-top:2px">${escHtml(e.deadline)}</div>` : '') +
    (e.maybe ? `<div style="font-size:12px;color:#94a3b8;margin-top:2px">${escHtml(tt.saidMaybe)}</div>` : '') +
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
      ...(e.maybe ? [`  ${tt.saidMaybe}`] : []),
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

// ── Sending ──────────────────────────────────────────────────────────────────

/** True when `ts` is in the RSVP digest hour in Zurich. */
export function isRsvpDigestHour(ts = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', hour12: false }).format(ts))
  return hour === RSVP_DIGEST_HOUR_ZURICH
}

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

  /** The daily digest: one email per member listing every open answer. */
  async function runRsvpDigest(now = new Date()) {
    const jobs = [...groupByMember(await rsvpCandidates(now))].map(([memberId, items]) => ({ memberId, items }))
    return sendJobs('rsvp', jobs, ({ locale, firstName, items }) => rsvpDigestContent({ locale, firstName, items }))
  }

  /** One email per member and activity whose lead time has come. */
  async function runActivityReminders(now = new Date()) {
    const jobs = (await activityCandidates(now)).map((r) => ({ memberId: r.member, items: [r] }))
    return sendJobs('activity', jobs, ({ locale, firstName, items }) => activityReminderContent({ locale, firstName, item: items[0] }))
  }

  return { runRsvpDigest, runActivityReminders, rsvpCandidates, activityCandidates }
}
