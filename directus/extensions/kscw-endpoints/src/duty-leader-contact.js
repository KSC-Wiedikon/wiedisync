/**
 * Duty leader-contact — GET/POST /kscw/games/:id/duty-leader-contact
 *
 * The mirror of duty-late.js. The assigned duty official (scorer / Täfeler /
 * combined / referee / BB official) for a game can, in the 60' before kickoff,
 * hit "Emergency: contact team leaders". That:
 *   - reveals the PLAYING team's Coach + Team-Responsible phone/email to them
 *     (always — hide_phone/hide_email are IGNORED in this emergency window, a
 *     deliberate reachability override for the narrow assigned-official audience),
 *   - emails the club admin + the sport's TK ONCE (idempotent per official),
 *   - records the press on games.duty_leader_alert_json (migration 203).
 *
 * GET returns the revealed leaders (only once the official has alerted) +
 * whether the button window is live, so reopening keeps the reveal WITHOUT
 * re-emailing.
 *
 * Authorised in code (not Directus perms): the grant is "leaders of the team
 * whose game I'm on duty for" — a per-game relationship a field-level policy
 * can't express without the documented deep-filter silent-empty trap.
 */

import { buildEmailLayout, buildAlertBox, buildInfoCard, FRONTEND_URL } from './email-template.js'
import { writeUserLog } from './activity-log.js'
import { ROLE_DEFS, gameStartMs, dateYMD, sportTkEmails } from './duty-late.js'

// Club admin alerted on every leader-contact emergency (env override).
const DUTY_ADMIN_EMAIL = (process.env.DUTY_LEADER_ADMIN_EMAIL || 'admin@wiedisync.kscw.ch').toLowerCase()

// The button is live from 60' before kickoff until 30' after.
const LEAD_MS = 60 * 60 * 1000
const GRACE_MS = 30 * 60 * 1000

// Suppress the alert email on dev (scrubbed clone) — same convention as
// duty-late.js. DUTY_LATE_FORCE_EMAIL=1 re-enables for a deliberate test.
const IS_DEV = (process.env.PUBLIC_URL || '').includes('directus-dev')
const SEND_EMAILS = !IS_DEV || process.env.DUTY_LATE_FORCE_EMAIL === '1'

function inWindow(startMs) {
  if (startMs == null) return false
  const now = Date.now()
  return now >= startMs - LEAD_MS && now <= startMs + GRACE_MS
}

function parseAlert(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try { const o = JSON.parse(raw); return o && typeof o === 'object' ? o : {} } catch { return {} }
}

// The playing team's Coach + Team-Responsible, with contact. Contact is ALWAYS
// revealed here (emergency reachability) — hide_phone/hide_email are ignored.
async function leadersFor(database, teamId) {
  if (teamId == null) return []
  const [coachRows, trRows] = await Promise.all([
    database('teams_coaches').where('teams_id', teamId).pluck('members_id'),
    database('teams_responsibles').where('teams_id', teamId).pluck('members_id'),
  ])
  const roleById = new Map()
  for (const id of coachRows) if (id != null) roleById.set(Number(id), 'coach')
  for (const id of trRows) if (id != null && !roleById.has(Number(id))) roleById.set(Number(id), 'responsible')
  const ids = [...roleById.keys()]
  if (!ids.length) return []
  const rows = await database('members').whereIn('id', ids)
    .select('id', 'first_name', 'last_name', 'phone', 'email')
  return rows.map((r) => ({
    id: r.id,
    name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
    role: roleById.get(Number(r.id)) || 'coach',
    phone: r.phone || null,
    email: r.email || null,
  }))
}

export function registerDutyLeaderContact(router, ctx) {
  const { services, database, logger, getSchema } = ctx
  const { MailService } = services
  const log = logger.child({ endpoint: 'duty-leader-contact' })

  // Load game + authorise: caller must be the member assigned to ANY duty role
  // on this game (or an admin). Returns { game, member, roles }.
  async function authorize(req) {
    const userId = req.accountability?.user
    if (!userId && !req.accountability?.admin) {
      const e = new Error('Authentication required'); e.status = 401; throw e
    }
    const game = await database('games').where('id', req.params.id).first()
    if (!game) { const e = new Error('Game not found'); e.status = 404; throw e }

    const member = userId
      ? await database('members').where('user', userId).first('id', 'first_name', 'last_name')
      : null
    const roles = []
    if (member) {
      for (const [role, def] of Object.entries(ROLE_DEFS)) {
        if (game[def.member] != null && Number(game[def.member]) === Number(member.id)) roles.push(role)
      }
    }
    const authorized = !!req.accountability?.admin || roles.length > 0
    if (!authorized) { const e = new Error('Forbidden'); e.status = 403; throw e }
    return { game, member, roles }
  }

  function fail(res, err, req) {
    if (err && err.status) return res.status(err.status).json({ error: err.message })
    log.error({
      msg: `duty-leader-contact: ${err?.message}`,
      endpoint: 'games/:id/duty-leader-contact',
      userId: req.accountability?.user || null,
      method: req.method,
      stack: err?.stack,
    })
    return res.status(500).json({ error: 'Internal error' })
  }

  async function sendAlertEmail({ game, official, leaders }) {
    const schema = await getSchema()
    const mail = new MailService({ schema, knex: database })
    const teamRow = game.kscw_team != null
      ? await database('teams').where('id', game.kscw_team).first('name', 'sport')
      : null
    const sport = teamRow?.sport === 'basketball' ? 'basketball' : 'volleyball'
    const tk = await sportTkEmails(database, sport)
    const cc = [...new Set(tk.filter(Boolean))].filter((e) => e !== DUTY_ADMIN_EMAIL)

    const matchup = `${game.home_team || ''} vs ${game.away_team || ''}`.trim()
    const kickoff = `${dateYMD(game.date)} ${String(game.time || '').slice(0, 5)}`.trim()
    const officialName = `${official.first_name || ''} ${official.last_name || ''}`.trim() || 'Einsatz-Person'
    const leaderLines = leaders.length
      ? leaders.map((l) => `${l.name} (${l.role})${l.phone ? ' · ' + l.phone : ''}${l.email ? ' · ' + l.email : ''}`).join('\n')
      : 'Keine Team-Leiter hinterlegt · none on file'

    const alert = buildAlertBox(
      'warning',
      'Notfall: Einsatz-Person braucht Hilfe · Duty official needs help',
      `${officialName} hat vor ${matchup || 'einem Spiel'} den Notfall-Knopf gedrückt · pressed the emergency "contact team leaders" button.`,
    )
    const card = buildInfoCard([
      { label: 'Person', value: officialName, halfWidth: true },
      { label: 'Spiel · Game', value: matchup || '—', halfWidth: true },
      { label: 'Anpfiff · Start', value: kickoff || '—' },
      { label: 'Team-Leiter · Leaders', value: leaderLines },
    ])
    const html = buildEmailLayout(alert + card, {
      sport: sport === 'basketball' ? 'bb' : 'vb',
      title: 'Notfall · Duty emergency',
      subtitle: matchup || undefined,
    })
    const text = `${officialName} pressed the emergency "contact team leaders" button before ${matchup} (${kickoff}).`
      + `\n\nTeam leaders:\n${leaderLines}`
      + `\n\n${FRONTEND_URL}/games`

    await mail.send({
      to: DUTY_ADMIN_EMAIL,
      ...(cc.length ? { cc } : {}),
      subject: `🚨 Notfall · Duty emergency: ${matchup || 'Spiel'}`,
      html,
      text,
    })
  }

  // GET — leaders (only after the official alerted) + window state. Never emails.
  router.get('/games/:id/duty-leader-contact', async (req, res) => {
    try {
      const { game, member } = await authorize(req)
      const startMs = gameStartMs(game)
      if (!inWindow(startMs)) return res.json({ leaders: [], alerted: false, in_window: false })
      const alerts = parseAlert(game.duty_leader_alert_json)
      const alerted = !!(member && alerts[String(member.id)])
      const leaders = alerted ? await leadersFor(database, game.kscw_team) : []
      res.json({ leaders, alerted, in_window: true })
    } catch (err) { fail(res, err, req) }
  })

  // POST — reveal leaders + email admin/TK once (idempotent per official).
  router.post('/games/:id/duty-leader-contact', async (req, res) => {
    try {
      const { game, member } = await authorize(req)
      const startMs = gameStartMs(game)
      if (!inWindow(startMs)) return res.status(409).json({ error: 'Outside the emergency window' })

      const leaders = await leadersFor(database, game.kscw_team)
      const alerts = parseAlert(game.duty_leader_alert_json)
      const key = member ? String(member.id) : 'admin'

      if (!alerts[key]) {
        const byName = member ? `${member.first_name} ${member.last_name}`.trim() : 'Admin'
        alerts[key] = { at: new Date().toISOString(), by_name: byName }
        await database('games').where('id', game.id).update({ duty_leader_alert_json: JSON.stringify(alerts) })

        await writeUserLog(database, log, {
          accountability: req.accountability,
          action: 'duty-leader-alert',
          collection: 'games',
          recordId: game.id,
          data: { member: member?.id ?? null, leaders: leaders.map((l) => l.id) },
        })

        // Email is best-effort — a mail failure must not lose the recorded press.
        if (SEND_EMAILS) {
          try {
            await sendAlertEmail({ game, official: member || { first_name: 'Admin', last_name: '' }, leaders })
          } catch (e) {
            log.error({ msg: `duty-leader-contact email failed: ${e.message}`, gameId: game.id, stack: e.stack })
          }
        } else {
          log.info({ msg: 'duty-leader-contact: email suppressed (dev)', gameId: game.id })
        }
      }

      res.json({ leaders, alerted: true, in_window: true })
    } catch (err) { fail(res, err, req) }
  })
}
