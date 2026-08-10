/**
 * Forms — roster-aware response tracking + reminders (Batch B).
 *
 *   GET  /kscw/forms/:id/stats   — { targeted, responded, nonResponders[] }
 *   POST /kscw/forms/:id/remind  — push + in-app nudge to everyone who hasn't
 *                                  responded yet. Author-scoped.
 *
 * Runs in the extension DB context (knex) so it can resolve the targeted
 * audience + non-responders without tripping the member-read RLS that a
 * coach/sport-admin caller would otherwise hit. Authorisation is enforced
 * here: admin, sport-admin, the form creator, or a coach/TR of a form's team.
 *
 * Anonymous + public forms have no per-member response tracking, so both
 * routes refuse them (the UI hides the controls).
 */

import { FRONTEND_URL } from './email-template.js'
import { currentSeasonShort } from './season.js'

const getCurrentSeason = currentSeasonShort

// Per-(user, form) reminder rate limit — 1 fan-out per form per 10 min per caller.
const remindRateLimit = new Map()
function userFormRateLimit(map, key, maxAttempts, windowMs) {
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

/** Resolve the form's targeted member rows (club-wide ∪ team players/coaches/TRs). */
async function resolveTargetedMembers(db, form) {
  let memberIds = []
  if (form.audience === 'club_wide') {
    const rows = await db('members').where('wiedisync_active', true).select('id')
    memberIds = rows.map(r => r.id)
  } else {
    const teamRows = await db('forms_teams').where('forms_id', form.id).select('teams_id')
    const teamIds = [...new Set(teamRows.map(r => r.teams_id).filter(Boolean))]
    if (teamIds.length === 0) return []
    const season = getCurrentSeason()
    const [players, coaches, trs] = await Promise.all([
      db('member_teams').whereIn('team', teamIds).where('season', season).select('member'),
      db('teams_coaches').whereIn('teams_id', teamIds).select('members_id'),
      db('teams_responsibles').whereIn('teams_id', teamIds).select('members_id'),
    ])
    memberIds = [...new Set([
      ...players.map(r => r.member),
      ...coaches.map(r => r.members_id),
      ...trs.map(r => r.members_id),
    ].filter(Boolean))]
  }
  if (memberIds.length === 0) return []
  return db('members')
    .whereIn('id', memberIds).andWhere('wiedisync_active', true)
    .select('id', 'first_name', 'last_name')
}

/** admin / sport-admin / form creator / coach or TR of a form team. */
async function authorizeManage(db, req, form) {
  if (req.accountability?.admin === true) return true
  const caller = await db('members').where('user', req.accountability.user).select('id', 'role').first()
  if (!caller) return false
  const roles = Array.isArray(caller.role)
    ? caller.role
    : (caller.role ? (() => { try { return JSON.parse(caller.role) } catch { return [] } })() : [])
  if (roles.includes('admin') || roles.includes('superuser') || roles.includes('vb_admin') || roles.includes('bb_admin')) return true
  // The creator branch is scoped to team forms on purpose. `created_by` used to
  // be client-supplied, so this authorised on an attacker-chosen column; the
  // kscw-hooks guard now stamps it server-side, but a club-wide or public form
  // is a manager-tier object either way and must not be manageable just because
  // someone's id sits in that column (audit 2026-08-08, finding 10).
  if (form.audience === 'teams' && form.created_by && String(form.created_by) === String(caller.id)) return true
  if (form.audience === 'teams') {
    const teamRows = await db('forms_teams').where('forms_id', form.id).select('teams_id')
    const teamIds = [...new Set(teamRows.map(r => r.teams_id).filter(Boolean))]
    if (teamIds.length > 0) {
      const [coach, tr] = await Promise.all([
        db('teams_coaches').whereIn('teams_id', teamIds).where('members_id', caller.id).first(),
        db('teams_responsibles').whereIn('teams_id', teamIds).where('members_id', caller.id).first(),
      ])
      if (coach || tr) return true
    }
  }
  return false
}

export function registerForms(router, { database, logger }, helpers) {
  const { logEndpointError, requireAuth } = helpers
  const log = logger.child({ endpoint: 'forms' })

  async function loadManageableForm(req, res) {
    requireAuth(req, log)
    const form = await database('forms').where('id', req.params.id)
      .select('id', 'title', 'audience', 'anonymous', 'is_public', 'created_by').first()
    if (!form) { res.status(404).json({ error: 'Form not found' }); return null }
    if (!(await authorizeManage(database, req, form))) {
      res.status(403).json({ error: 'Not authorised for this form' }); return null
    }
    if (form.anonymous || form.is_public) {
      res.status(400).json({ error: 'Response tracking is unavailable for anonymous or public forms' }); return null
    }
    return form
  }

  router.get('/forms/:id/stats', async (req, res) => {
    try {
      const form = await loadManageableForm(req, res)
      if (!form) return
      const [targeted, subRows] = await Promise.all([
        resolveTargetedMembers(database, form),
        database('form_submissions').where('form', form.id).whereNotNull('member').select('member'),
      ])
      const respondedIds = new Set(subRows.map(r => String(r.member)))
      const nonResponders = targeted
        .filter(m => !respondedIds.has(String(m.id)))
        .map(m => ({ id: m.id, first_name: m.first_name, last_name: m.last_name }))
      res.json({
        targeted: targeted.length,
        responded: targeted.length - nonResponders.length,
        nonResponders,
      })
    } catch (err) {
      logEndpointError(log, 'forms/stats', err, req)
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
    }
  })

  router.post('/forms/:id/remind', async (req, res) => {
    try {
      const form = await loadManageableForm(req, res)
      if (!form) return

      const rateKey = `${req.accountability.user}:${form.id}`
      if (!userFormRateLimit(remindRateLimit, rateKey, 1, 10 * 60 * 1000)) {
        return res.status(429).json({ error: 'Already reminded recently — please wait before reminding again' })
      }

      const [targeted, subRows] = await Promise.all([
        resolveTargetedMembers(database, form),
        database('form_submissions').where('form', form.id).whereNotNull('member').select('member'),
      ])
      const respondedIds = new Set(subRows.map(r => String(r.member)))
      const recipientIds = targeted.map(m => m.id).filter(id => !respondedIds.has(String(id)))
      if (recipientIds.length === 0) return res.json({ reminded: 0 })

      await database('notifications').insert(recipientIds.map(rid => ({
        member: rid,
        type: 'form_reminder',
        title: 'form_reminder',
        body: JSON.stringify({ title: form.title }),
        activity_type: 'form',
        activity_id: String(form.id),
        team: null,
        read: false,
      })))

      try {
        const { sendPushToMembers } = await import('./web-push.js')
        const { sendLocalizedPush } = await import('./push-i18n.js')
        await sendLocalizedPush(
          database, recipientIds,
          (ids, title, body) => sendPushToMembers(database, ids, title, body, `${FRONTEND_URL}/forms`, `form-remind-${form.id}`, log),
          'formReminder.title', 'formReminder.body', { title: form.title },
        )
      } catch (pushErr) {
        log.warn(`forms/remind push failed: ${pushErr.message}`)
      }

      res.json({ reminded: recipientIds.length })
    } catch (err) {
      logEndpointError(log, 'forms/remind', err, req)
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
    }
  })
}
