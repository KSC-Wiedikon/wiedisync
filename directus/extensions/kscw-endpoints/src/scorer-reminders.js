/**
 * Scorer Reminders — ported from scorer_reminders_lib.js
 * POST /kscw/admin/scorer-reminders — manual trigger
 * POST /kscw/admin/scorer-reminders/dry-run — test with fake data
 * Cron registered in hooks extension (09:00 UTC)
 */

import { buildEmailLayout, buildInfoCard, formatDateCH, weekday, FRONTEND_URL } from './email-template.js'

function tomorrowYMD() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

/**
 * Arrival lead time, from the ONE table that already owns it.
 *
 * This was a third hand-written copy, and it had already drifted: it returned
 * **10** minutes for the Täfeler where `ROLE_DEFS` and the frontend's
 * `DUTY_ARRIVAL_MIN` both say **15** (audit 2026-08-08, finding 38). Not
 * theoretical — the audit called this path dead on the basis of a missing cron,
 * but `sendReminders` is wired to a live "Send reminders" button on the admin
 * dashboard, so the email told the Täfeler T−10 while `/scorer` showed T−15 and
 * the coach's late alarm (with its CHF 50 no-show fine) armed at T−15.
 *
 * Unified on 15 — the value every continuously-running surface already uses —
 * so nothing with a money consequence moved.
 *
 * ⚠ INFRA.md documents the club rule as "taefeler (10 min before)". If 10 is
 * genuinely the rule, then the FINE WINDOW is the thing that is wrong, not this
 * email, and that is a deliberate change to make in ROLE_DEFS — not here.
 */
import { ROLE_DEFS } from './duty-late.js'

function arrivalMinutes(role, sport) {
  const def = ROLE_DEFS[role]
  if (def) return def.arrival
  // Unknown role: fall back by sport rather than inventing a number.
  return sport === 'basketball' ? 15 : 30
}

// Role keys aligned to the real `games` columns (English). Display labels stay
// in the club's German (these are the user-facing email role names).
const ROLE_LABELS = {
  scorer: 'Scorer', scoreboard: 'Täfeler',
  bb_scorer: 'Anschreiber', bb_timekeeper: 'Zeitnehmer', bb_24s_official: '24s-Operator',
}

const ROLE_MEMBER = {
  scorer: 'scorer_member', scoreboard: 'scoreboard_member',
  bb_scorer: 'bb_scorer_member', bb_timekeeper: 'bb_timekeeper_member', bb_24s_official: 'bb_24s_official',
}

export function registerScorerReminders(router, { database, logger, services, getSchema }) {
  const log = logger.child({ endpoint: 'scorer-reminders' })

  async function sendReminders(db, getSchemaFn, mailServiceClass) {
    // Check if enabled
    // app_settings has an `enabled` boolean column (no `value` column) — the
    // ScorerPage toggle reads/writes `enabled`. Reading a nonexistent `value`
    // here meant the cron ALWAYS skipped, so reminders never sent (2026-07-03 review).
    const setting = await db('app_settings').where('key', 'scorer_reminders_enabled').first()
    if (!setting || setting.enabled !== true) {
      return { sent: 0, skipped: 'disabled' }
    }

    const tomorrow = tomorrowYMD()
    const games = await db('games')
      .where('date', tomorrow)
      .where('type', 'home')
      .whereIn('source', ['swiss_volley', 'basketplan'])
      .whereNotIn('status', ['completed', 'postponed', 'cancelled'])
      .select('*')

    if (games.length === 0) return { sent: 0, games: 0 }

    const schema = await getSchemaFn()
    const mailService = new mailServiceClass({ schema, knex: db })
    let sent = 0, errors = 0

    for (const game of games) {
      const sport = game.source === 'basketplan' ? 'basketball' : 'volleyball'

      // Find assigned roles
      const roles = sport === 'volleyball'
        ? ['scorer', 'scoreboard']
        : ['bb_scorer', 'bb_timekeeper', 'bb_24s_official']

      for (const role of roles) {
        const memberField = ROLE_MEMBER[role]
        const memberId = game[memberField]
        if (!memberId) continue

        const member = await db('members').where('id', memberId).first()
        if (!member || !member.email || member.email.includes('@placeholder')) continue

        const hall = game.hall ? await db('halls').where('id', game.hall).first() : null
        const arrival = arrivalMinutes(role, sport)
        const gameTime = game.time || '??:??'

        // Calculate arrival time
        let arrivalTime = gameTime
        if (gameTime !== '??:??') {
          const [h, m] = gameTime.split(':').map(Number)
          const totalMin = h * 60 + m - arrival
          arrivalTime = `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`
        }

        const subject = `Schreibereinsatz morgen: ${game.home_team} vs ${game.away_team}`
        const roleLabel = ROLE_LABELS[role] || role
        const sportKey = sport === 'basketball' ? 'bb' : 'vb'
        const dateStr = `${weekday(game.date)}, ${formatDateCH(game.date)}`

        const infoRows = [
          { label: 'Spiel', value: `${game.home_team} vs ${game.away_team}` },
          { label: 'Datum', value: dateStr, halfWidth: true },
          { label: 'Anpfiff', value: gameTime, halfWidth: true },
          { label: 'Ankunft', value: `${arrivalTime} (${arrival} Min. vor Anpfiff)`, halfWidth: true },
          { label: 'Rolle', value: roleLabel, halfWidth: true },
        ]
        if (hall) infoRows.push({ label: 'Halle', value: hall.name })

        const bodyHtml =
          `<div style="font-size:14px;color:#e2e8f0;margin-bottom:16px">Du bist morgen als <strong>${roleLabel}</strong> eingeteilt.</div>` +
          buildInfoCard(infoRows)

        const html = buildEmailLayout(bodyHtml, {
          title: 'Schreibereinsatz',
          subtitle: `${game.home_team} vs ${game.away_team}`,
          sport: sportKey,
          greeting: `Hallo ${member.first_name},`,
          ctaUrl: `${FRONTEND_URL}/scorer`,
          ctaLabel: 'Schreibereinsätze anzeigen',
        })

        const text = [
          `Hallo ${member.first_name},`,
          '',
          `Du bist morgen als ${roleLabel} eingeteilt:`,
          `Spiel: ${game.home_team} vs ${game.away_team}`,
          `Datum: ${dateStr}`,
          `Anpfiff: ${gameTime}`,
          `Ankunft: ${arrivalTime} (${arrival} Min. vor Anpfiff)`,
          hall ? `Halle: ${hall.name}` : '',
          '',
          `${FRONTEND_URL}/scorer`,
          '',
          'KSC Wiedikon',
          FRONTEND_URL.replace('https://', ''),
        ].filter(Boolean).join('\n')

        try {
          await mailService.send({ to: member.email, subject, html, text })
          sent++
        } catch (mailErr) {
          log.warn(`Scorer reminder failed for ${member.email}: ${mailErr.message}`)
          errors++
        }
      }
    }

    return { sent, errors, games: games.length }
  }

  router.post('/admin/scorer-reminders', async (req, res) => {
    if (!req.accountability?.admin) return res.status(403).json({ error: 'Admin access required' })
    try {
      const { MailService } = services
      const result = await sendReminders(database, getSchema, MailService)
      res.json({ status: 'ok', tomorrow: tomorrowYMD(), ...result })
    } catch (err) {
      log.error({ msg: `scorer-reminders: ${err.message}`, endpoint: 'scorer-reminders', userId: req?.accountability?.user || null, method: req?.method, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  router.post('/admin/scorer-reminders/dry-run', async (req, res) => {
    if (!req.accountability?.admin) return res.status(403).json({ error: 'Admin access required' })
    try {
      const tomorrow = tomorrowYMD()
      const games = await database('games')
        .where('date', tomorrow).where('type', 'home')
        .whereIn('source', ['swiss_volley', 'basketplan'])
        .select('id', 'home_team', 'away_team', 'date', 'time', 'scorer_member', 'scoreboard_member')

      res.json({ status: 'ok', tomorrow, games })
    } catch (err) {
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
