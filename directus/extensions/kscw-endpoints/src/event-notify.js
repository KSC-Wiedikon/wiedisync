import { buildEmailLayout, buildInfoCard, formatDateCH, weekday, FRONTEND_URL, escHtml } from './email-template.js'
import { currentSeasonShort } from './season.js'
import { writeUserLog } from './activity-log.js'

/** Get current season in Wiedisync short form, e.g. '2025/26' (matches teams.season, member_teams.season) */
const getCurrentSeason = currentSeasonShort

/**
 * Per-(user, event) rate limit for the notify fan-out. Mirrors the in-memory
 * ipRateLimit pattern in index.js but keys on the authenticated user + event so
 * one caller cannot re-blast the same audience. Module-scoped so it survives
 * across requests within the process. Self-cleans when it grows past 1k entries.
 */
const notifyRateLimit = new Map() // `${user}:${eventId}` → { count, resetAt }
function userEventRateLimit(map, key, maxAttempts, windowMs) {
  const now = Date.now()
  const entry = map.get(key)
  if (entry && now < entry.resetAt) {
    if (entry.count >= maxAttempts) return false
    entry.count++
  } else {
    map.set(key, { count: 1, resetAt: now + windowMs })
  }
  if (map.size > 1000) {
    for (const [k, v] of map) { if (now > v.resetAt) map.delete(k) }
  }
  return true
}

export function registerEventNotify(router, { services, database, getSchema, logger }) {
  const { ItemsService, MailService } = services

  router.post('/events/:id/notify', async (req, res) => {
    try {
      // Auth: must be a logged-in member; mass-fanout (push + email) is restricted
      // to Directus admins, KSCW sport admins, the event creator, or a
      // coach/team-responsible of one of the event's teams. An anonymous /
      // unauthorised caller previously could spam every member via this route.
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' })
      }

      const eventId = req.params.id
      const sendEmail = req.body?.send_email === true
      const schema = await getSchema()
      const db = database

      // Fetch event with teams + invited_members
      const eventsService = new ItemsService('events', { schema, knex: db })
      const event = await eventsService.readOne(eventId, {
        fields: ['*', 'teams.teams_id', 'invited_members.members_id', 'created_by'],
      })

      if (!event) return res.status(404).json({ error: 'Event not found' })

      // Authorise: admin, sport-admin role, event creator, or coach/TR of
      // any of the event's teams. Compute against the same user once.
      //
      // `elevated` (admin / sport-admin / event creator) may notify the event's
      // full resolved audience. A leader-only caller (coach/TR) is allowed but
      // their fan-out is scoped to the team(s) they actually lead — they must
      // NOT be able to expand the event's club-wide invited_roles, and they may
      // NOT trigger a club-wide email blast.
      const isAdmin = req.accountability.admin === true
      let elevated = isAdmin
      let allowed = isAdmin
      let caller = null
      const ledTeamIds = new Set() // event-team ids the caller leads as coach/TR
      if (!elevated) {
        caller = await db('members')
          .where('user', req.accountability.user)
          .select('id', 'role')
          .first()
        const roles = Array.isArray(caller?.role)
          ? caller.role
          : (caller?.role ? (() => { try { return JSON.parse(caller.role) } catch { return [] } })() : [])
        if (roles.includes('admin') || roles.includes('superuser') || roles.includes('vb_admin') || roles.includes('bb_admin')) {
          elevated = true
          allowed = true
        } else if (caller && event.created_by && String(event.created_by) === String(caller.id)) {
          elevated = true
          allowed = true
        } else if (caller) {
          const evTeamIds = (event.teams ?? []).map(t => t.teams_id ?? t).filter(Boolean)
          if (evTeamIds.length > 0) {
            const coachRows = await db('teams_coaches')
              .whereIn('teams_id', evTeamIds)
              .where('members_id', caller.id)
              .select('teams_id')
            for (const r of coachRows) ledTeamIds.add(Number(r.teams_id))
            const trRows = await db('teams_responsibles')
              .whereIn('teams_id', evTeamIds)
              .where('members_id', caller.id)
              .select('teams_id')
            for (const r of trRows) ledTeamIds.add(Number(r.teams_id))
            if (ledTeamIds.size > 0) allowed = true
          }
        }
      }
      if (!allowed) {
        return res.status(403).json({ error: 'Not authorised to notify for this event' })
      }

      // A leader-only caller cannot trigger a club-wide email blast — only
      // admins, sport-admins, and the event creator may send_email:true.
      if (sendEmail && !elevated) {
        return res.status(403).json({ error: 'Only an admin or the event creator can send the email notification' })
      }

      // Per-(user, event) rate limit: max 1 fan-out per event per 10 min per
      // caller, so the same user cannot repeatedly blast the audience.
      const rateKey = `${req.accountability.user}:${eventId}`
      if (!userEventRateLimit(notifyRateLimit, rateKey, 1, 10 * 60 * 1000)) {
        return res.status(429).json({ error: 'Already notified recently — please wait before notifying again' })
      }

      // Resolve audience: team members + role members + directly invited.
      // For a leader-only caller (coach/TR), the audience is restricted to the
      // team(s) they actually lead — the event's club-wide invited_roles and
      // invited_members are NOT expanded for them.
      const memberIds = new Set()

      // 1. Team members (current season only)
      const allTeamIds = (event.teams ?? []).map(t => t.teams_id ?? t)
      const teamIds = elevated ? allTeamIds : allTeamIds.filter(t => ledTeamIds.has(Number(t)))
      if (teamIds.length > 0) {
        const currentSeason = getCurrentSeason()
        const memberTeams = await db('member_teams')
          .whereIn('team', teamIds)
          .where('season', currentSeason)
          .select('member')
        for (const mt of memberTeams) memberIds.add(String(mt.member))

        // Also coaches of these teams
        const coaches = await db('teams_coaches')
          .whereIn('teams_id', teamIds)
          .select('members_id')
        for (const c of coaches) memberIds.add(String(c.members_id))
      }

      // 2. Role-based members (elevated callers only — never expand club-wide
      //    invited_roles for a leader-only coach/TR).
      const roles = elevated ? (event.invited_roles ?? []) : []
      for (const role of roles) {
        // Global roles (use JSONB containment to avoid substring matches)
        if (['vorstand', 'admin', 'vb_admin', 'bb_admin', 'superuser'].includes(role)) {
          const members = await db('members')
            .whereRaw(`role::jsonb @> ?`, [JSON.stringify([role])])
            .select('id')
          for (const m of members) memberIds.add(String(m.id))
        }
        // Coach
        if (role === 'coach') {
          const coaches = await db('teams_coaches').select('members_id')
          for (const c of coaches) memberIds.add(String(c.members_id))
        }
        // Team responsible
        if (role === 'team_responsible') {
          const trs = await db('teams_responsibles').select('members_id')
          for (const tr of trs) memberIds.add(String(tr.members_id))
        }
        // Captain (M2O field on teams table)
        if (role === 'captain') {
          const caps = await db('teams').whereNotNull('captain').select('captain')
          for (const c of caps) memberIds.add(String(c.captain))
        }
        // Licences — migration 067 split licences (json) into per-flag booleans.
        // role is whitelisted by the .includes() check above before reaching .where(),
        // which is the only safe way to pass a dynamic column name to Knex.
        // Migration 228 split OTN into its two Basketplan levels, so an invite
        // must list both to reach every OTN official (migration 303 dropped the
        // coarse `otn_bb` flag that used to sit alongside them).
        if (['scorer_vb', 'referee_vb', 'otr1_bb', 'otr2_bb', 'otn1_bb', 'otn2_bb', 'referee_bb'].includes(role)) {
          const members = await db('members')
            .where(role, true)
            .select('id')
          for (const m of members) memberIds.add(String(m.id))
        }
        // Boolean flags
        if (role === 'is_spielplaner') {
          const members = await db('members')
            .where('is_spielplaner', true)
            .select('id')
          for (const m of members) memberIds.add(String(m.id))
        }
      }

      // 3. Directly invited members (elevated callers only — a leader-only
      //    coach/TR is limited to members of the team(s) they lead, above).
      if (elevated) {
        const directInvites = (event.invited_members ?? []).map(m => String(m.members_id ?? m))
        for (const id of directInvites) memberIds.add(id)
      }

      // Remove event creator from notifications
      if (event.created_by) memberIds.delete(String(event.created_by))

      // Filter out invalid entries (String(null) → "null", String(undefined) → "undefined", empty strings)
      memberIds.delete('null')
      memberIds.delete('undefined')
      memberIds.delete('')
      const memberIdArray = [...memberIds].filter(id => id && !isNaN(Number(id)))
      if (memberIdArray.length === 0) return res.json({ notified: 0 })

      // Insert in-app notifications
      const notifRows = memberIdArray.map(mid => ({
        member: mid,
        type: 'event_invite',
        title: event.title,
        body: '',
        activity_type: 'event',
        activity_id: String(eventId),
        team: teamIds.length > 0 ? Number(teamIds[0]) || null : null,
        read: false,
      }))

      await db('notifications').insert(notifRows)

      // Send web push (per-recipient locale; event.title kept as-is)
      try {
        const { sendPushToMembers } = await import('./web-push.js')
        const { sendLocalizedPush } = await import('./push-i18n.js')
        const url = `${FRONTEND_URL}/events`
        await sendLocalizedPush(
          db, memberIdArray,
          (ids, title, body) => sendPushToMembers(db, ids, title, body, url, `event-${eventId}`, logger),
          null, 'eventInvite.body', {}, event.title,
        )
      } catch (pushErr) {
        logger.warn('Push notification failed:', pushErr.message)
      }

      // Send email if toggled
      if (sendEmail) {
        try {
          const mailService = new MailService({ schema, knex: db })
          const members = await db('members')
            .whereIn('id', memberIdArray)
            .whereNotNull('email')
            // Migration 156: respect per-member opt-out. Push (above) is unaffected.
            .where('email_notify_events', true)
            .select('id', 'email', 'first_name', 'language')

          const dateStr = event.start_date
            ? `${weekday(event.start_date)}, ${formatDateCH(event.start_date)}`
            : ''

          // Per-member locale: routes by `members.language` into 5 buckets.
          // Unknown / null falls back to `de` (canonical club language).
          const L = {
            de: { greeting: 'Hallo', greetingNoName: 'Hallo', event: 'Anlass', date: 'Datum', place: 'Ort', title: 'Einladung', cta: 'Antworten', subject: 'Einladung' },
            gsw: { greeting: 'Hoi', greetingNoName: 'Hoi', event: 'Aalass', date: 'Datum', place: 'Ort', title: 'Yyladig', cta: 'Antworte', subject: 'Yyladig' },
            en: { greeting: 'Hi', greetingNoName: 'Hello', event: 'Event', date: 'Date', place: 'Location', title: 'Invitation', cta: 'Respond', subject: 'Invitation' },
            fr: { greeting: 'Salut', greetingNoName: 'Bonjour', event: 'Événement', date: 'Date', place: 'Lieu', title: 'Invitation', cta: 'Répondre', subject: 'Invitation' },
            it: { greeting: 'Ciao', greetingNoName: 'Salve', event: 'Evento', date: 'Data', place: 'Luogo', title: 'Invito', cta: 'Rispondi', subject: 'Invito' },
          }
          const LANG_TO_CODE = { german: 'de', swiss_german: 'gsw', english: 'en', french: 'fr', italian: 'it' }

          let emailsSent = 0
          let emailsFailed = 0
          for (const member of members) {
            try {
              const code = LANG_TO_CODE[member.language] || 'de'
              const l = L[code]
              const greeting = member.first_name ? `${l.greeting} ${member.first_name}` : l.greetingNoName
              const body = buildInfoCard([
                { label: l.event, value: event.title },
                ...(dateStr ? [{ label: l.date, value: dateStr, halfWidth: true }] : []),
                ...(event.location ? [{ label: l.place, value: event.location, halfWidth: true }] : []),
              ])
              // event.description is free text — escape before interpolating so
              // a creator cannot inject HTML/phishing markup into the email.
              + (event.description ? `<div style="font-size:14px;color:#cbd5e1;margin-top:12px">${escHtml(event.description)}</div>` : '')

              const html = buildEmailLayout(body, {
                title: l.title,
                subtitle: event.title,
                greeting,
                ctaUrl: `${FRONTEND_URL}/events`,
                ctaLabel: l.cta,
              })

              await mailService.send({
                to: member.email,
                subject: `${l.subject}: ${event.title}`,
                html,
              })
              emailsSent++
            } catch (perEmailErr) {
              emailsFailed++
              logger.warn(`Email to ${member.email} failed: ${perEmailErr.message}`)
            }
          }
          logger.info(`Event invite emails: ${emailsSent} sent, ${emailsFailed} failed out of ${members.length}`)
        } catch (emailErr) {
          logger.warn('Email invite batch failed: ' + emailErr.message)
        }
      }

      // Actor capture. This endpoint inserts `notifications` via raw knex
      // (bypassing directus_activity), pushes to every resolved member and, for
      // elevated callers, emails the whole invited_roles expansion — and
      // `notifications` has no actor column and is in audit.js's
      // SKIP_COLLECTIONS, so nothing recorded WHO fired it or how large the
      // audience was (audit 2026-08-08, finding 29). The comparable mass-send
      // path (broadcast.js) records sender + audience + recipient count, and
      // SECURITY.md's Broadcast TOCTOU row explicitly leans on that trail.
      try {
        await writeUserLog(database, logger, {
          accountability: req.accountability,
          action: 'notify',
          collection: 'events',
          recordId: String(eventId),
          data: { recipient_count: memberIdArray.length, emailed: !!sendEmail, teams: teamIds },
        })
      } catch (logErr) {
        logger.warn(`event-notify: audit log failed: ${logErr.message}`)
      }

      res.json({ notified: memberIdArray.length, emailed: sendEmail })
    } catch (err) {
      logger.error('Event notify error: ' + (err?.message || err))
      logger.error(err?.stack || '')
      res.status(500).json({ error: 'Notification failed', message: err?.message })
    }
  })
}
