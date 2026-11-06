/**
 * The Einsatzliste alert (migration 444; owner, 04.11.2026): 2 hours before a
 * Volleymanager game the list is read and compared with the RSVPs. When it is empty
 * or differs, the team's coaches and team responsibles get one email.
 *
 * The cron lives in kscw-hooks index.js, in the same tick as the kickoff −45 min read, so
 * the reads never collide on the shared VM account (CLAUDE.md → "The shared VolleyManager
 * account"; each read claims it via readOwnNominationList and never waits).
 *
 * Teams with the automatic push (auto_nomination_list) are compared too: their list is
 * filed 24 h before kickoff, so this is what tells them about the answers that changed since.
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
 * Should this tick read the list from VM? Rows carry the game plus `vm_status` and
 * `vm_checked_at`.
 *
 * Every game gets a read at −45 min, unless one already happened since: the −2 h read and
 * a coach's earlier Recheck do not replace it. `busy` read nothing, so it is retried.
 *
 * A push that reached VM gets one read as well, up to kickoff, so the sheet shows that list
 * from then on (`vm_nomination_status`, `vm_nomination_pushed_at`; migration 446).
 */
export function vmReadDue(game, now = Date.now()) {
  const kickoff = gameStartMs(game)
  if (kickoff == null || now > kickoff + VM_READ_UNTIL_MS) return false
  const checkedAt = ms(game.vm_checked_at)
  const pushedAt = ms(game.vm_nomination_pushed_at)
  if ((game.vm_nomination_status === 'saved' || game.vm_nomination_status === 'filled')
    && pushedAt != null && now < kickoff
    && (checkedAt == null || checkedAt < pushedAt || game.vm_status === 'busy')) return true
  const stale = (lead) => checkedAt == null || game.vm_status === 'busy' || checkedAt < kickoff - lead
  if (now >= kickoff - VM_CHECK_LEAD_MS) return stale(VM_CHECK_LEAD_MS)
  return now >= kickoff - EINSATZLISTE_ALERT_LEAD_MS && stale(EINSATZLISTE_ALERT_LEAD_MS)
}

/**
 * A list VM flags, before the game (owner, 06.11.2026). A list can match the RSVPs and still be
 * flagged, as 15 Yes against a limit below that does, so the comparison never reports it.
 * Rows carry `vm_nomination_status`; the send log keeps it to one email per person and game.
 */
export function nominationFlagAlertDue(game, now = Date.now()) {
  const kickoff = gameStartMs(game)
  return kickoff != null && now < kickoff && game.vm_nomination_status === 'filled'
}

/** What VM flagged, from the worker's note on the game ('Volleymanager flags: a, b; …'). */
export function flaggedReasons(error) {
  const text = String(error ?? '')
  const reasons = []
  if (text.includes('hasTooManyNominations')) reasons.push('tooMany')
  if (text.includes('hasTooFewNominations')) reasons.push('tooFew')
  if (text.includes('isMissingCoachPerson')) reasons.push('noCoach')
  return reasons.length ? reasons : ['other']
}

/** Is there a list from the last 2 h before kickoff still waiting to be compared? */
export function einsatzlisteAlertDue(game, now = Date.now()) {
  const kickoff = gameStartMs(game)
  if (kickoff == null || game.vm_alert_checked_at) return false
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
    outro: 'Bitte vor dem Spiel im Matchblatt korrigieren. Beim Speichern wird die Liste im Volleymanager aktualisiert.',
    flagged: {
      title: 'Der Volleymanager meldet ein Problem mit der Einsatzliste',
      intro: (team) => `Der Volleymanager meldet ein Problem mit der Einsatzliste von ${team}.`,
      problem: 'Problem',
      reasons: { tooMany: 'Zu viele Spieler auf der Liste', tooFew: 'Zu wenige Spieler auf der Liste', noCoach: 'Kein Coach auf der Liste', other: 'Der Volleymanager beanstandet die Liste' },
    },
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
    outro: 'Bitte vor em Spiel im Matchblatt korrigiere. Bim Speichere wird d Liste im Volleymanager aktualisiert.',
    flagged: {
      title: 'De Volleymanager mäldet es Problem mit de Einsatzliste',
      intro: (team) => `De Volleymanager mäldet es Problem mit de Einsatzliste vo ${team}.`,
      problem: 'Problem',
      reasons: { tooMany: 'Z vill Spieler uf de Liste', tooFew: 'Z wenig Spieler uf de Liste', noCoach: 'Kein Coach uf de Liste', other: 'De Volleymanager beaastandet d Liste' },
    },
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
    outro: 'Please fix it on the match sheet before the game. Saving it updates the list in Volleymanager.',
    flagged: {
      title: 'Volleymanager flags the Einsatzliste',
      intro: (team) => `Volleymanager reports a problem with the Einsatzliste of ${team}.`,
      problem: 'Problem',
      reasons: { tooMany: 'Too many players on the list', tooFew: 'Too few players on the list', noCoach: 'No head coach on the list', other: 'Volleymanager reports a problem with the list' },
    },
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
    outro: "Merci de corriger la feuille de match avant le match. L'enregistrement met à jour la liste dans Volleymanager.",
    flagged: {
      title: "Volleymanager signale un problème avec l'Einsatzliste",
      intro: (team) => `Volleymanager signale un problème avec l'Einsatzliste de ${team}.`,
      problem: 'Problème',
      reasons: { tooMany: 'Trop de joueurs sur la liste', tooFew: 'Pas assez de joueurs sur la liste', noCoach: 'Pas de coach sur la liste', other: 'Volleymanager signale un problème avec la liste' },
    },
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
    outro: 'Correggi il referto di gara prima della partita. Salvando, la lista in Volleymanager viene aggiornata.',
    flagged: {
      title: "Volleymanager segnala un problema con l'Einsatzliste",
      intro: (team) => `Volleymanager segnala un problema con l'Einsatzliste di ${team}.`,
      problem: 'Problema',
      reasons: { tooMany: 'Troppi giocatori sulla lista', tooFew: 'Troppo pochi giocatori sulla lista', noCoach: 'Nessun coach sulla lista', other: 'Volleymanager segnala un problema con la lista' },
    },
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
 * @param {object} p
 * @param {string} p.locale de | gsw | en | fr | it
 * @param {string} [p.firstName]
 * @param {object} p.game games row + `team_name` and `vm_nomination_error`
 */
export function nominationFlagAlertContent({ locale, firstName, game }) {
  const shared = reminderCopy(locale)
  const t = COPY[locale] || COPY.de
  const team = game.team_name || ''
  const label = activityLabel({ activity_type: 'game', home_team: game.home_team, away_team: game.away_team }, locale)
  const startsAt = new Date(gameStartMs(game))
  const day = formatDay(startsAt, locale)
  const time = formatTime(startsAt)
  const url = `${FRONTEND_URL}/games/${game.id}/roster`
  const problem = flaggedReasons(game.vm_nomination_error).map((r) => t.flagged.reasons[r]).join(', ')
  const intro = t.flagged.intro(team)

  const bodyHtml =
    `<div style="font-size:14px;color:#e2e8f0;margin-bottom:16px">${escHtml(intro)}</div>` +
    buildInfoCard([
      { label: t.game, value: label },
      { label: shared.date, value: day, halfWidth: true },
      { label: shared.time, value: time, halfWidth: true },
      { label: t.flagged.problem, value: problem },
    ]) +
    `<div style="font-size:13px;color:#94a3b8;margin-top:16px">${escHtml(t.outro)}</div>`

  const html = buildEmailLayout(bodyHtml, {
    title: t.flagged.title,
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
    `${t.flagged.problem}: ${problem}`,
    '',
    t.outro,
    url,
    '',
    t.footer(team),
  ].join('\n')

  return { subject: `WiediSync — ${t.flagged.title}: ${label}, ${day}, ${time}`, html, text }
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

  /** One email per person about a list VM flags. The send log makes every later tick a no-op. */
  async function runFlagged(game) {
    const jobs = (await recipients(game.kscw_team)).map((r) => ({
      memberId: r.member,
      items: [{ ...r, activity_type: 'game', activity_id: String(game.id) }],
    }))
    return emailReminders.sendJobs('nomination_flagged', jobs, ({ locale, firstName }) =>
      nominationFlagAlertContent({ locale, firstName, game }))
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

  return { run, runFlagged }
}
