/**
 * The Einsatzliste alert (migration 444; owner, 04.11.2026): 2 hours before a
 * Volleymanager game the list is read and compared with the RSVPs. When it is empty
 * or differs, the team's coaches and team responsibles get one email.
 *
 * The cron lives in kscw-hooks index.js, in the same tick as the kickoff −45 min read, so
 * the reads never collide on the shared VM account (CLAUDE.md → "The shared VolleyManager
 * account"; each read claims it via readOwnNominationList and never waits).
 *
 * Teams with the automatic push (auto_nomination_list) are left out: their list is filed
 * from the RSVPs at about kickoff −60 min, so at −2 h it is empty on purpose.
 *
 * One comparison per game, `game_vm_sheets.alert_checked_at`: a list that matched at −2 h
 * does not mail later because someone changed their answer. When the −2 h read gets no
 * answer from VM, the −45 min read is compared instead. A failed send leaves it unset, and
 * the next tick reaches only those who did not get it (email_reminders_sent).
 */
import { buildEmailLayout, buildInfoCard, escHtml, FRONTEND_URL } from '../../kscw-endpoints/src/email-template.js'
import { einsatzlisteComparison, gameStartMs } from '../../kscw-endpoints/src/scorer-roster.js'
import { loadVmCheck, VM_CHECK_LEAD_MS } from '../../kscw-endpoints/src/vm-sheet-check.js'
import { activityLabel, formatDay, formatTime, reminderCopy } from './email-reminders.js'

/** The list is read and compared this long before kickoff. */
export const EINSATZLISTE_ALERT_LEAD_MS = 2 * 60 * 60 * 1000
/** A read lost to a restart still catches up until this long after kickoff. */
const VM_READ_UNTIL_MS = 3 * 60 * 60 * 1000

const ms = (value) => (value ? new Date(value).getTime() : null)

/**
 * Should this tick read the list from VM? Rows carry the game plus `vm_status`,
 * `vm_checked_at` and `auto_list`.
 *
 * Every game gets a read at −45 min, unless one already happened since: the −2 h read and
 * a coach's earlier Recheck do not replace it. `busy` read nothing, so it is retried.
 */
export function vmReadDue(game, now = Date.now()) {
  const kickoff = gameStartMs(game)
  if (kickoff == null || now > kickoff + VM_READ_UNTIL_MS) return false
  const checkedAt = ms(game.vm_checked_at)
  const stale = (lead) => checkedAt == null || game.vm_status === 'busy' || checkedAt < kickoff - lead
  if (now >= kickoff - VM_CHECK_LEAD_MS) return stale(VM_CHECK_LEAD_MS)
  return now >= kickoff - EINSATZLISTE_ALERT_LEAD_MS && !game.auto_list && stale(EINSATZLISTE_ALERT_LEAD_MS)
}

/** Is there a list from the last 2 h before kickoff still waiting to be compared? */
export function einsatzlisteAlertDue(game, now = Date.now()) {
  const kickoff = gameStartMs(game)
  if (kickoff == null || game.auto_list || game.vm_alert_checked_at) return false
  if (now < kickoff - EINSATZLISTE_ALERT_LEAD_MS || now >= kickoff) return false
  if (game.vm_status !== 'ok' && game.vm_status !== 'no_list') return false
  const listAt = ms(game.vm_list_at)
  return listAt != null && listAt >= kickoff - EINSATZLISTE_ALERT_LEAD_MS
}

const COPY = {
  de: {
    title: { no_list: 'Keine Einsatzliste', differs: 'Einsatzliste weicht von den Zusagen ab' },
    intro: {
      no_list: (team) => `Für ${team} ist in Volleymanager keine Einsatzliste erfasst.`,
      differs: (team) => `Die Einsatzliste von ${team} in Volleymanager stimmt nicht mit den Zusagen überein.`,
    },
    game: 'Spiel',
    withoutYes: 'Auf der Liste, ohne Zusage',
    yesOnly: 'Zugesagt, nicht auf der Liste',
    outro: 'Bitte vor dem Spiel in Volleymanager prüfen.',
    cta: 'Matchblatt öffnen',
    footer: (team) => `Du bekommst diese E-Mail als Coach oder Teamverantwortliche/r von ${team}.`,
  },
  gsw: {
    title: { no_list: 'Kei Einsatzliste', differs: 'D Einsatzliste wiicht vo de Zuesäge ab' },
    intro: {
      no_list: (team) => `Für ${team} isch im Volleymanager kei Einsatzliste erfasst.`,
      differs: (team) => `D Einsatzliste vo ${team} im Volleymanager stimmt nöd mit de Zuesäge überii.`,
    },
    game: 'Spiel',
    withoutYes: 'Uf de Liste, ohni Zuesag',
    yesOnly: 'Zuegseit, nöd uf de Liste',
    outro: 'Bitte vor em Spiel im Volleymanager prüefe.',
    cta: 'Matchblatt uftue',
    footer: (team) => `Du überchunsch die E-Mail als Coach oder Teamverantwortlichi Person vo ${team}.`,
  },
  en: {
    title: { no_list: 'No Einsatzliste', differs: 'Einsatzliste differs from RSVPs' },
    intro: {
      no_list: (team) => `No Einsatzliste is filed in Volleymanager for ${team}.`,
      differs: (team) => `The Einsatzliste of ${team} in Volleymanager does not match the RSVPs.`,
    },
    game: 'Game',
    withoutYes: 'On the list, no Yes',
    yesOnly: 'Said Yes, not on the list',
    outro: 'Please check it in Volleymanager before the game.',
    cta: 'Open match roster',
    footer: (team) => `You get this email as coach or team responsible of ${team}.`,
  },
  fr: {
    title: { no_list: "Pas d'Einsatzliste", differs: "L'Einsatzliste diffère des réponses" },
    intro: {
      no_list: (team) => `Aucune Einsatzliste n'est enregistrée dans Volleymanager pour ${team}.`,
      differs: (team) => `L'Einsatzliste de ${team} dans Volleymanager ne correspond pas aux réponses.`,
    },
    game: 'Match',
    withoutYes: 'Sur la liste, sans Oui',
    yesOnly: 'A répondu Oui, pas sur la liste',
    outro: 'Merci de vérifier dans Volleymanager avant le match.',
    cta: 'Ouvrir la feuille de match',
    footer: (team) => `Tu reçois cet e-mail en tant que coach ou responsable d'équipe de ${team}.`,
  },
  it: {
    title: { no_list: 'Nessuna Einsatzliste', differs: "L'Einsatzliste è diversa dalle adesioni" },
    intro: {
      no_list: (team) => `Nessuna Einsatzliste registrata in Volleymanager per ${team}.`,
      differs: (team) => `L'Einsatzliste di ${team} in Volleymanager non corrisponde alle adesioni.`,
    },
    game: 'Partita',
    withoutYes: 'Sulla lista, senza Sì',
    yesOnly: 'Ha detto Sì, non sulla lista',
    outro: 'Controlla in Volleymanager prima della partita.',
    cta: 'Apri il referto di gara',
    footer: (team) => `Ricevi questa e-mail come coach o responsabile di ${team}.`,
  },
}

/** participations.status → the answer wording of the reminder emails. */
const ANSWER_KEY = { declined: 'no', tentative: 'maybe', waitlisted: 'waiting', none: 'open' }

/**
 * @param {object} p
 * @param {string} p.locale de | gsw | en | fr | it
 * @param {string} [p.firstName]
 * @param {object} p.game games row + `team_name`
 * @param {object} p.comparison einsatzlisteComparison() with verdict no_list or differs
 */
export function einsatzlisteAlertContent({ locale, firstName, game, comparison }) {
  const shared = reminderCopy(locale)
  const t = COPY[locale] || COPY.de
  const { verdict } = comparison
  const team = game.team_name || ''
  const label = activityLabel({ activity_type: 'game', home_team: game.home_team, away_team: game.away_team }, locale)
  const startsAt = new Date(gameStartMs(game))
  const day = formatDay(startsAt, locale)
  const time = formatTime(startsAt)
  const url = `${FRONTEND_URL}/games/${game.id}/roster`

  const withoutYes = comparison.nominated_without_yes
    .map((p) => `${p.name} (${shared.status[ANSWER_KEY[p.rsvp] ?? 'open']})`)
    .join(', ')
  const yesOnly = comparison.yes_not_nominated.map((p) => p.name).join(', ')

  const rows = [
    { label: t.game, value: label },
    { label: shared.date, value: day, halfWidth: true },
    { label: shared.time, value: time, halfWidth: true },
    ...(withoutYes ? [{ label: t.withoutYes, value: withoutYes }] : []),
    ...(yesOnly ? [{ label: t.yesOnly, value: yesOnly }] : []),
  ]
  const intro = t.intro[verdict](team)
  const bodyHtml =
    `<div style="font-size:14px;color:#e2e8f0;margin-bottom:16px">${escHtml(intro)}</div>` +
    buildInfoCard(rows) +
    `<div style="font-size:13px;color:#94a3b8;margin-top:16px">${escHtml(t.outro)}</div>`

  const html = buildEmailLayout(bodyHtml, {
    title: t.title[verdict],
    subtitle: label,
    sport: 'vb',
    greeting: firstName ? shared.greeting(firstName) : undefined,
    ctaUrl: url,
    ctaLabel: t.cta,
    footerExtra: t.footer(team),
  })

  const text = [
    ...(firstName ? [`${shared.greeting(firstName)},`, ''] : []),
    intro,
    `${t.game}: ${label}`,
    `${shared.date}: ${day}, ${time}`,
    ...(withoutYes ? [`${t.withoutYes}: ${withoutYes}`] : []),
    ...(yesOnly ? [`${t.yesOnly}: ${yesOnly}`] : []),
    '',
    t.outro,
    url,
    '',
    t.footer(team),
  ].join('\n')

  return { subject: `WiediSync — ${t.title[verdict]}: ${label}, ${day}, ${time}`, html, text }
}

/**
 * @param {object} deps
 * @param {import('knex').Knex} deps.database
 * @param {object} deps.emailReminders createEmailReminders() — its send log and mail sending
 */
export function createEinsatzlisteAlert({ database, emailReminders }) {
  /** The team's coaches and team responsibles, each once. */
  async function recipients(teamId) {
    const { rows } = await database.raw(
      `SELECT m.id AS member, m.email, m.first_name, m.language
       FROM (
         SELECT members_id FROM teams_coaches WHERE teams_id = ?
         UNION
         SELECT members_id FROM teams_responsibles WHERE teams_id = ?
       ) s
       JOIN members m ON m.id = s.members_id`,
      [teamId, teamId],
    )
    return rows
  }

  /** Compare the stored list with the RSVPs, mail when it does not match, mark it done. */
  async function run(game) {
    const check = await loadVmCheck(database, game.id)
    const comparison = await einsatzlisteComparison(database, game, check)
    let result = { emails: 0, sent: 0, skipped: 0, failed: 0 }
    if (comparison.verdict !== 'matches') {
      const jobs = (await recipients(game.kscw_team)).map((r) => ({
        memberId: r.member,
        items: [{ ...r, activity_type: 'game', activity_id: String(game.id) }],
      }))
      result = await emailReminders.sendJobs('nomination_list', jobs, ({ locale, firstName }) =>
        einsatzlisteAlertContent({ locale, firstName, game, comparison }))
    }
    if (result.failed === 0) {
      await database('game_vm_sheets').where('game', game.id).update({ alert_checked_at: new Date() })
    }
    return { verdict: comparison.verdict, ...result }
  }

  return { run }
}
