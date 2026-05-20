import { buildEmailLayout, buildInfoCard, formatDateCH, weekday, FRONTEND_URL } from './email-template.js'

/** Get current season in Wiedisync short form, e.g. '2025/26' (matches teams.season, member_teams.season) */
function getCurrentSeason() {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() // 0-based; Aug+ counts as new season
  const startYear = m >= 7 ? y : y - 1
  return `${startYear}/${(startYear + 1).toString().slice(-2)}`
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
      const isAdmin = req.accountability.admin === true
      let allowed = isAdmin
      let caller = null
      if (!allowed) {
        caller = await db('members')
          .where('user', req.accountability.user)
          .select('id', 'role')
          .first()
        const roles = Array.isArray(caller?.role)
          ? caller.role
          : (caller?.role ? (() => { try { return JSON.parse(caller.role) } catch { return [] } })() : [])
        if (roles.includes('admin') || roles.includes('superuser') || roles.includes('vb_admin') || roles.includes('bb_admin')) {
          allowed = true
        } else if (caller && event.created_by && String(event.created_by) === String(caller.id)) {
          allowed = true
        } else if (caller) {
          const evTeamIds = (event.teams ?? []).map(t => t.teams_id ?? t).filter(Boolean)
          if (evTeamIds.length > 0) {
            const hit = await db('teams_coaches')
              .whereIn('teams_id', evTeamIds)
              .where('members_id', caller.id)
              .first()
            if (hit) allowed = true
            if (!allowed) {
              const hit2 = await db('teams_responsibles')
                .whereIn('teams_id', evTeamIds)
                .where('members_id', caller.id)
                .first()
              if (hit2) allowed = true
            }
          }
        }
      }
      if (!allowed) {
        return res.status(403).json({ error: 'Not authorised to notify for this event' })
      }

      // Resolve audience: team members + role members + directly invited
      const memberIds = new Set()

      // 1. Team members (current season only)
      const teamIds = (event.teams ?? []).map(t => t.teams_id ?? t)
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

      // 2. Role-based members
      const roles = event.invited_roles ?? []
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
        if (['scorer_vb', 'referee_vb', 'otr1_bb', 'otr2_bb', 'otn_bb', 'referee_bb'].includes(role)) {
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

      // 3. Directly invited members
      const directInvites = (event.invited_members ?? []).map(m => String(m.members_id ?? m))
      for (const id of directInvites) memberIds.add(id)

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
              + (event.description ? `<div style="font-size:14px;color:#cbd5e1;margin-top:12px">${event.description}</div>` : '')

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

      res.json({ notified: memberIdArray.length, emailed: sendEmail })
    } catch (err) {
      logger.error('Event notify error: ' + (err?.message || err))
      logger.error(err?.stack || '')
      res.status(500).json({ error: 'Notification failed', message: err?.message })
    }
  })
}
