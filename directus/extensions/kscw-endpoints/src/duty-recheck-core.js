/**
 * Moved home games: what the people on the duty seats and the game team's leaders are
 * told (migration 451). Used by the question endpoints (duty-recheck.js) and the job that
 * sends the queue (kscw-hooks/src/duty-recheck.js).
 *
 * Every message is a bell, a push and sometimes an email, per member and in that member's
 * language, because the role name in the sentence is translated too. Nothing here throws:
 * by the time it runs the seat is already written, and a mail failure must not undo that.
 */
import { buildEmailLayout, buildInfoCard, escHtml, FRONTEND_URL } from './email-template.js'
import { loadSuppressed, normaliseEmail } from './email-suppression.js'
import { memberLangToCode, tPush } from './push-i18n.js'
import { sendPushToMembers } from './web-push.js'
import { CLAIM_DEFS, seatDutyTeams } from './duty-seats.js'

const ROLE_LABELS = {
  de: { scorer: 'Schreiber', scoreboard: 'Täfeler', scorer_scoreboard: 'Schreiber/Täfeler', referee: 'Schiedsrichter', bb_scorer: 'Anschreiber/in', bb_timekeeper: 'Zeitnehmer/in', bb_24s_official: '24s' },
  gsw: { scorer: 'Schriiber', scoreboard: 'Täfeler', scorer_scoreboard: 'Schriiber/Täfeler', referee: 'Schiedsrichter', bb_scorer: 'Aaschriiber/in', bb_timekeeper: 'Ziitnehmer/in', bb_24s_official: '24s' },
  en: { scorer: 'Scorer', scoreboard: 'Scoreboard', scorer_scoreboard: 'Scorer/Scoreboard', referee: 'Referee', bb_scorer: 'Scorer', bb_timekeeper: 'Timekeeper', bb_24s_official: '24s' },
  fr: { scorer: 'Marqueur', scoreboard: 'Tableau d\'affichage', scorer_scoreboard: 'Marqueur/Tableau', referee: 'Arbitre', bb_scorer: 'Marqueur', bb_timekeeper: 'Chronométreur', bb_24s_official: '24s' },
  it: { scorer: 'Segnapunti', scoreboard: 'Tabellone', scorer_scoreboard: 'Segnapunti/Tabellone', referee: 'Arbitro', bb_scorer: 'Segnapunti', bb_timekeeper: 'Cronometrista', bb_24s_official: '24s' },
}

const EMAIL_COPY = {
  de: { greeting: (n) => `Hallo ${n}`, cta: 'In WiediSync öffnen', role: 'Aufgabe', game: 'Spiel', was: 'Bisher', now: 'Neu', when: 'Wann' },
  gsw: { greeting: (n) => `Hoi ${n}`, cta: 'I WiediSync uftue', role: 'Ufgab', game: 'Spiel', was: 'Bishär', now: 'Neu', when: 'Wänn' },
  en: { greeting: (n) => `Hi ${n}`, cta: 'Open WiediSync', role: 'Duty', game: 'Game', was: 'Was', now: 'Now', when: 'When' },
  fr: { greeting: (n) => `Bonjour ${n}`, cta: 'Ouvrir WiediSync', role: 'Service', game: 'Match', was: 'Avant', now: 'Maintenant', when: 'Quand' },
  it: { greeting: (n) => `Ciao ${n}`, cta: 'Apri WiediSync', role: 'Servizio', game: 'Partita', was: 'Prima', now: 'Ora', when: 'Quando' },
}

export function roleLabel(locale, role) {
  return (ROLE_LABELS[locale] || ROLE_LABELS.de)[role] || role || ''
}

/** dd.mm.yyyy + HH:MM + hall as one line; any of them may be missing. */
export function whenLabel(date, time, hall) {
  return [[date, time].filter(Boolean).join(', '), hall].filter(Boolean).join(' · ')
}

/** Dev is a scrubbed clone: no duty email leaves it unless a test asks for it. */
function emailsOn() {
  return !(process.env.PUBLIC_URL || '').includes('directus-dev') || process.env.DUTY_RECHECK_FORCE_EMAIL === '1'
}

/** The email for one message in one language. Pure, so the test can pin it. */
export function dutyRecheckEmailContent({ locale, kind, vars, firstName, url }) {
  const copy = EMAIL_COPY[locale] || EMAIL_COPY.de
  const role = vars.role ?? roleLabel(locale, vars.roleKey)
  const plain = { ...vars, role }
  const title = tPush(locale, `dutyRecheck.${kind}.title`, plain)
  const intro = tPush(locale, `dutyRecheck.${kind}.body`, plain)
  const safe = Object.fromEntries(Object.entries(plain).map(([k, v]) => [k, v == null ? v : escHtml(String(v))]))
  const rows = [
    ...(role ? [{ label: copy.role, value: role }] : []),
    { label: copy.game, value: vars.game || '' },
    ...(vars.was ? [{ label: copy.was, value: vars.was }] : []),
    ...(vars.now ? [{ label: vars.was ? copy.now : copy.when, value: vars.now }] : []),
  ]
  const bodyHtml = `<div style="font-size:14px;color:#e2e8f0;margin-bottom:16px">${tPush(locale, `dutyRecheck.${kind}.body`, safe)}</div>${buildInfoCard(rows)}`
  const html = buildEmailLayout(bodyHtml, {
    title,
    subtitle: `WiediSync — ${vars.game || ''}`,
    greeting: firstName ? copy.greeting(firstName) : undefined,
    ctaUrl: url,
    ctaLabel: copy.cta,
  })
  const text = [
    firstName ? `${copy.greeting(firstName)},` : '',
    '',
    intro,
    '',
    ...rows.map((r) => `${r.label}: ${r.value}`),
    '',
    url,
  ].filter((l, i, a) => l !== '' || (a[i - 1] ?? '') !== '').join('\n')
  return { subject: `WiediSync — ${title}: ${vars.game || ''}`, html, text }
}

async function sendEmail(ctx, member, locale, kind, vars, url) {
  const log = ctx.logger
  try {
    const email = normaliseEmail(member.email)
    if (!email || email.includes('@placeholder')) return
    const suppressed = await loadSuppressed(ctx.database, [email])
    if (suppressed.has(email)) return
    const content = dutyRecheckEmailContent({ locale, kind, vars, firstName: member.first_name, url })
    const mail = new ctx.services.MailService({ schema: await ctx.getSchema(), knex: ctx.database })
    await mail.send({ to: email, subject: content.subject, html: content.html, text: content.text })
  } catch (err) {
    log?.warn?.({ msg: `[duty-recheck] email to member ${member.id} (${kind}) failed: ${err.message}`, event: 'duty_recheck_email' })
  }
}

/**
 * Bell + push + (optionally) email to each member, each in their own language.
 * @param {{ database, logger, services, getSchema }} ctx
 * @param {Array<number|string>} memberIds
 * @param {string} kind key under dutyRecheck.* (push-i18n) and duty_recheck_* (bell)
 * @param {object} vars game, date, time, when, hall, name, by, team, was, now; roleKey → role
 * @param {{ gameId?: number|null, email?: boolean, tag?: string }} [opts]
 */
export async function notifyDuty(ctx, memberIds, kind, vars, { gameId = null, email = false, tag } = {}) {
  const ids = [...new Set((memberIds || []).filter((x) => x != null).map(Number))]
  if (!ids.length) return 0
  const { database, logger: log } = ctx
  const url = `${FRONTEND_URL || ''}/`
  const members = await database('members').whereIn('id', ids).select('id', 'email', 'first_name', 'language')
  for (const member of members) {
    const locale = memberLangToCode(member.language)
    const v = { ...vars, role: roleLabel(locale, vars.roleKey) }
    delete v.roleKey
    try {
      await database('notifications').insert({
        member: member.id,
        type: 'duty_recheck',
        title: `duty_recheck_${kind}`,
        body: JSON.stringify(v),
        activity_type: 'scorer_duty',
        activity_id: gameId != null ? String(gameId) : null,
        read: false,
      })
    } catch (err) {
      log?.warn?.({ msg: `[duty-recheck] bell for member ${member.id} failed: ${err.message}`, event: 'duty_recheck_bell' })
    }
    try {
      await sendPushToMembers(
        database, [member.id],
        tPush(locale, `dutyRecheck.${kind}.title`, v), tPush(locale, `dutyRecheck.${kind}.body`, v),
        url, tag || `duty-recheck-${gameId ?? 'x'}-${kind}`, log,
      )
    } catch (err) {
      log?.warn?.({ msg: `[duty-recheck] push for member ${member.id} failed: ${err.message}`, event: 'duty_recheck_push' })
    }
    if (email && emailsOn()) await sendEmail(ctx, member, locale, kind, v, url)
  }
  return members.length
}

/** The game row plus what the messages show. `started` is against Zurich wall-clock. */
export async function loadGame(database, gameId) {
  const { rows } = await database.raw(
    `SELECT g.*, t.name AS team_name, t.sport AS team_sport,
            to_char(g.date, 'DD.MM.YYYY') AS date_ch,
            to_char(g.time, 'HH24:MI') AS time_ch,
            kscw_hall_label(kscw_game_hall_ids(g.hall, g.additional_halls)) AS hall_label,
            COALESCE(((g.date + g.time) AT TIME ZONE 'Europe/Zurich') <= now(), false) AS started,
            (g.type = 'home' AND COALESCE(g.status, 'scheduled') NOT IN ('completed', 'cancelled', 'postponed')) AS live
       FROM games g LEFT JOIN teams t ON t.id = g.kscw_team
      WHERE g.id = ?`,
    [gameId],
  )
  return rows[0] ?? null
}

export function matchup(home, away) {
  return `${home || ''} – ${away || ''}`.trim()
}

export function gameVars(game) {
  return {
    game: matchup(game.home_team, game.away_team),
    date: game.date_ch || '',
    time: game.time_ch || '',
    when: [game.date_ch, game.time_ch].filter(Boolean).join(', '),
    hall: game.hall_label || '',
    team: game.team_name || '',
    now: whenLabel(game.date_ch, game.time_ch, game.hall_label),
  }
}

/** Coaches and team responsibles of these teams. */
export async function teamLeaderIds(database, teamIds) {
  const ids = [...new Set((teamIds || []).filter((x) => x != null).map(Number))]
  if (!ids.length) return []
  const [coaches, responsibles] = await Promise.all([
    database('teams_coaches').whereIn('teams_id', ids).pluck('members_id'),
    database('teams_responsibles').whereIn('teams_id', ids).pluck('members_id'),
  ])
  return [...new Set([...coaches, ...responsibles].filter((x) => x != null).map(Number))]
}

export async function memberName(database, memberId) {
  const m = await database('members').where('id', memberId).first('first_name', 'last_name')
  return m ? [m.first_name, m.last_name].filter(Boolean).join(' ').trim() : ''
}

/** Somebody refused: the game team's leaders look for a replacement, the duty team's get a copy. */
export async function notifySeatRefused(ctx, game, role, refuserId) {
  const def = CLAIM_DEFS[role]
  const leaders = await teamLeaderIds(ctx.database, [game.kscw_team, ...seatDutyTeams(game, def)])
  return notifyDuty(ctx, leaders.filter((id) => id !== Number(refuserId)), 'leaderRefused', {
    ...gameVars(game), roleKey: role, name: await memberName(ctx.database, refuserId),
  }, { gameId: game.id, email: true, tag: `duty-recheck-refused-${game.id}-${role}` })
}

/** The seat has somebody again: the people looking for them can stop. */
export async function notifySeatFilled(ctx, gameId, role, memberId) {
  try {
    const game = await loadGame(ctx.database, gameId)
    if (!game) return
    const leaders = await teamLeaderIds(ctx.database, [game.kscw_team])
    await notifyDuty(ctx, leaders.filter((id) => id !== Number(memberId)), 'seatFilled', {
      ...gameVars(game), roleKey: role, name: await memberName(ctx.database, memberId),
    }, { gameId, tag: `duty-recheck-filled-${gameId}-${role}` })
  } catch (err) {
    ctx.logger?.warn?.({ msg: `[duty-recheck] seat filled notice for game ${gameId} failed: ${err.message}`, event: 'duty_recheck_filled' })
  }
}
