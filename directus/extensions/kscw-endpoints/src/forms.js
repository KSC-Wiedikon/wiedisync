/**
 * Forms — roster-aware response tracking + reminders (Batch B).
 *
 *   GET  /kscw/forms/:id/stats   — { targeted, responded, nonResponders[] }
 *   POST /kscw/forms/:id/remind  — push + in-app nudge to everyone who hasn't
 *                                  responded yet. Author-scoped.
 *   GET  /kscw/forms/:id/files/:fileId — stream one file answer to someone who
 *                                  manages the form (see authorizeFormFile).
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
import { streamManagedFile } from './storage-read.js'
import {
  FORM_UPLOADS_FOLDER, UPLOAD_QUARANTINE_FOLDER, UUID_RE, answerFileIds,
} from './upload-folders.js'

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
    // No season filter on the player half — `teamIds` comes from forms_teams and
    // already pins the season, and the coach/TR halves below have never had one,
    // so a season-lagged player was dropped from BOTH `targeted` and
    // `nonResponders` and the form read "18/18 responded" while a squad member
    // was never asked.
    const [players, coaches, trs] = await Promise.all([
      db('member_teams').whereIn('team', teamIds).select('member'),
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

const parseRoles = (raw) => (Array.isArray(raw)
  ? raw
  : (raw ? (() => { try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [] } catch { return [] } })() : []))

const SPORT_ADMIN_ROLES = { vb_admin: 'volleyball', bb_admin: 'basketball' }

/**
 * May the caller read the answers (and so the file answers) of this form?
 * Mirrors who can read form_submissions in setup-permissions.mjs:
 *   - a full Directus admin, app roles admin / superuser / vorstand (club-wide CRUD);
 *   - a Sport Admin for a form linked to a team of their sport, or a form with no
 *     team at all (club-wide / public — their policy reads those club-wide too);
 *   - FORMS_LEADER_SCOPE: the form's creator, or a coach / TR of a linked team
 *     that is still ACTIVE (a past season's coach no longer reads it).
 */
export async function canReadFormAnswers(db, accountability, form) {
  if (accountability?.admin === true) return true
  if (!accountability?.user) return false
  const caller = await db('members').where('user', accountability.user).first('id', 'role')
  if (!caller) return false
  const roles = parseRoles(caller.role)
  if (roles.some((r) => r === 'admin' || r === 'superuser' || r === 'vorstand')) return true
  if (form.created_by != null && String(form.created_by) === String(caller.id)) return true

  const teamRows = await db('forms_teams').where('forms_id', form.id).select('teams_id')
  const teamIds = [...new Set(teamRows.map((r) => r.teams_id).filter((v) => v != null))]
  const adminSports = roles.map((r) => SPORT_ADMIN_ROLES[r]).filter(Boolean)
  if (adminSports.length && teamIds.length === 0) return true
  if (teamIds.length === 0) return false

  const teams = await db('teams').whereIn('id', teamIds).select('id', 'sport', 'active')
  if (adminSports.length && teams.some((t) => adminSports.includes(t.sport))) return true
  const activeIds = teams.filter((t) => t.active === true).map((t) => t.id)
  if (activeIds.length === 0) return false
  const [coach, tr] = await Promise.all([
    db('teams_coaches').whereIn('teams_id', activeIds).where('members_id', caller.id).first('id'),
    db('teams_responsibles').whereIn('teams_id', activeIds).where('members_id', caller.id).first('id'),
  ])
  return !!(coach || tr)
}

/**
 * Resolve a form file answer the caller may stream, or explain why not.
 * Returns { ok: true, file } or { ok: false, status }.
 *
 * Answers are client-written JSON, so "the id appears in an answer" alone would let
 * anyone who manages SOME form name any file id in a submission to it and read the
 * file back. The file is therefore bound to its FIRST referencing submission:
 *   - that submission (lowest id whose answers mention the file) must belong to
 *     THIS form, and the id must sit in one of its `file`-type fields;
 *   - the file must be a form upload: in Form uploads, or still unfiled (root /
 *     quarantine — legacy rows and a submit whose filing move failed). Never any
 *     other folder (receipts, registration scans, identity docs, public images);
 *   - an uploader-stamped file must have been uploaded by that submission's
 *     member. A submission without a member (anonymous / public form) may only
 *     carry anonymous uploads — or, once filed into Form uploads by the endpoint
 *     that checked the uploader, the signed-in submitter's own.
 * Misses are 404, never 403, so the route is no existence oracle.
 */
export async function authorizeFormFile(db, accountability, formId, fileId) {
  if (!accountability?.user && accountability?.admin !== true) return { ok: false, status: 401 }
  const fid = Number(formId)
  if (!Number.isInteger(fid) || fid <= 0 || !UUID_RE.test(String(fileId || ''))) return { ok: false, status: 404 }
  const form = await db('forms').where('id', fid).first('id', 'fields', 'created_by', 'audience')
  if (!form) return { ok: false, status: 404 }
  if (!(await canReadFormAnswers(db, accountability, form))) return { ok: false, status: 404 }

  const id = String(fileId).toLowerCase()
  // The uuid is validated above, so it carries no LIKE wildcards.
  const first = await db('form_submissions')
    .whereRaw('answers::text ILIKE ?', [`%${id}%`])
    .orderBy('id', 'asc')
    .first('id', 'form', 'member', 'answers')
  if (!first || Number(first.form) !== fid) return { ok: false, status: 404 }
  if (!answerFileIds(form.fields, first.answers).map((x) => x.toLowerCase()).includes(id)) {
    return { ok: false, status: 404 }
  }

  const file = await db('directus_files').where('id', id)
    .first('id', 'folder', 'uploaded_by', 'type', 'filename_download', 'filename_disk')
  if (!file || !file.filename_disk) return { ok: false, status: 404 }
  const folder = file.folder == null ? null : String(file.folder)
  const filed = folder === FORM_UPLOADS_FOLDER
  if (!(filed || folder === null || folder === UPLOAD_QUARANTINE_FOLDER)) return { ok: false, status: 404 }

  if (file.uploaded_by != null) {
    let submitterUser = null
    if (first.member != null) {
      const m = await db('members').where('id', first.member).first('user')
      submitterUser = m?.user ?? null
    }
    const own = submitterUser != null && String(submitterUser) === String(file.uploaded_by)
    if (!own && !(first.member == null && filed)) return { ok: false, status: 404 }
  }
  return { ok: true, file }
}

export function registerForms(router, { database, logger, services, getSchema }, helpers) {
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

  // Stream one file answer (audit 2026-09-28 F01/F25). Form uploads are private
  // (Form uploads folder); coaches/TRs who manage a team form have no folder read,
  // so FormResponsesModal previews through here instead of /assets/<id>.
  router.get('/forms/:id/files/:fileId', async (req, res) => {
    try {
      requireAuth(req, log)
      const r = await authorizeFormFile(database, req.accountability, req.params.id, req.params.fileId)
      if (!r.ok) return res.status(r.status).json({ error: r.status === 401 ? 'Authentication required' : 'Not found' })
      res.setHeader('Cache-Control', 'private, no-store')
      await streamManagedFile(r.file.id, { services, getSchema, database }, res, {
        filename: r.file.filename_download || 'file',
        type: r.file.type,
      })
    } catch (err) {
      logEndpointError(log, 'forms/files', err, req)
      if (!res.headersSent) res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal error' })
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
