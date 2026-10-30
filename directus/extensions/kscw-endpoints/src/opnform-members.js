/**
 * OpnForm → Wiedisync member checks (server to server, internal network only)
 *
 *   POST /kscw/opnform/v1/member-lookup  { email, name? }
 *        → { status: 'found', name, sections, teams } | { status: 'not_found' } | { status: 'ambiguous' }
 *   POST /kscw/opnform/v1/signup         { form_slug, submission_id?, email, name? }
 *        → { status, events: [eventId, …] }
 *
 * Called only by our OpnForm fork (forms.kscw.ch). An email field there can be set to
 * "check in Wiedisync": the respondent must use the address Wiedisync or ClubDesk knows,
 * and the form gets the member's section and teams filled in server-side. On submit the
 * fork calls /signup, which signs the member into every event bound to that form
 * (`events.signup_form_slug`) that is marked `form_signup_only` (migration 434): the
 * member is added to `events_members` (so the private event becomes visible to them)
 * and gets a confirmed RSVP they cannot change.
 *
 * Auth: same model as the WiePlay service routes — a shared token whose SHA-256 sits in
 * `OPNFORM_SERVICE_TOKEN_HASH`, sent in `x-kscw-service-token` (not `Authorization`, which
 * Directus would try to read as one of its own tokens). Anything arriving through
 * Cloudflare (`cf-connecting-ip`) gets a 404: the OpnForm API reaches Directus over the
 * Docker network, so a request from outside is never legitimate.
 *
 * Privacy: the lookup answers for any address the caller sends, so it lives behind the
 * service token, and the fork decides per form whether the respondent ever sees the
 * section/teams (default: no — they are only written into the stored submission).
 */

import { normalizeEmail } from './normalize.js'
import { REAL_PERSON } from './season-health-sql.js'
import { serviceTokenOk } from './wieplay-bridge.js'
import { writeUserLog } from './activity-log.js'

export const SERVICE_TOKEN_HEADER = 'x-kscw-service-token'

const SPORT_LABELS = { volleyball: 'Volleyball', basketball: 'Basketball' }
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/i

/** "Müller-Lüdi  Anna" → ['muller', 'ludi', 'anna'] — accent-, case- and hyphen-blind. */
export function nameTokens(raw) {
  return String(raw ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/**
 * Narrow members who share one email (siblings on a parent's address are normal here —
 * there is deliberately no unique index on members.email) by the typed name. A candidate
 * matches when every token of its first + last name appears in the typed name, so
 * "Anna Müller", "Müller Anna" and "Anna Maria Müller" all find Anna Müller.
 */
export function pickByName(candidates, typedName) {
  const typed = new Set(nameTokens(typedName))
  if (typed.size === 0) return []
  return candidates.filter((c) => {
    const own = nameTokens(`${c.first_name ?? ''} ${c.last_name ?? ''}`)
    return own.length > 0 && own.every((t) => typed.has(t))
  })
}

/**
 * Current members whose email — Wiedisync's primary, the ClubDesk address kept in
 * `vm_email`, or a ClubDesk contact's E-Mail / E-Mail Alternativ — is `email`.
 * Former members (`kscw_membership_active = false`) and service rows are not members.
 */
export async function findMembersByEmail(database, email) {
  const res = await database.raw(`
    SELECT m.id, m.first_name, m.last_name, m.club_section, m."user"
    FROM members m
    WHERE m.kscw_membership_active = true
      AND ${REAL_PERSON}
      AND (LOWER(BTRIM(m.email)) = ?
           OR LOWER(BTRIM(m.vm_email)) = ?
           OR (m.clubdesk_id IS NOT NULL AND m.clubdesk_id IN (
                 SELECT BTRIM(cx.clubdesk_id) FROM clubdesk_export cx
                 WHERE LOWER(BTRIM(cx.email)) = ? OR LOWER(BTRIM(cx.email_alternative)) = ?)))
    ORDER BY m.id
  `, [email, email, email, email])
  return res?.rows ?? []
}

/** Resolve one member: { status: 'found', member } | { status: 'not_found' | 'ambiguous' }. */
export async function resolveMember(database, rawEmail, name) {
  const email = normalizeEmail(rawEmail)
  if (!email.ok || !email.value) return { status: 'not_found' }
  const candidates = await findMembersByEmail(database, email.value)
  if (candidates.length === 0) return { status: 'not_found' }
  if (candidates.length === 1) return { status: 'found', member: candidates[0] }
  const named = pickByName(candidates, name)
  return named.length === 1 ? { status: 'found', member: named[0] } : { status: 'ambiguous' }
}

/** "Anna Müller" — first + last name as Wiedisync holds them. */
export function memberDisplayName(member) {
  return [member.first_name, member.last_name].map((s) => String(s ?? '').trim()).filter(Boolean).join(' ')
}

/** Active teams the member plays in, coaches or is responsible for, plus their sections. */
export async function memberTeamsAndSections(database, member) {
  const res = await database.raw(`
    SELECT DISTINCT t.name, LOWER(t.sport) AS sport
    FROM teams t
    WHERE t.active = true
      AND t.id IN (
        SELECT team FROM member_teams WHERE member = ?
        UNION SELECT teams_id FROM teams_coaches WHERE members_id = ?
        UNION SELECT teams_id FROM teams_responsibles WHERE members_id = ?)
    ORDER BY sport, t.name
  `, [member.id, member.id, member.id])
  const rows = res?.rows ?? []
  const sports = [...new Set(rows.map((r) => r.sport).filter((s) => SPORT_LABELS[s]))]
  // No team (passive member, new joiner): fall back to the ClubDesk Sektion.
  if (sports.length === 0 && SPORT_LABELS[member.club_section]) sports.push(member.club_section)
  return {
    sections: sports.map((s) => SPORT_LABELS[s]),
    teams: rows.map((r) => r.name),
  }
}

/**
 * A member's form submission is their RSVP to every live event bound to `slug`
 * (`events.signup_form_slug`): a confirmed participation. A `form_signup_only` (private)
 * event also gets the audience row, which is what makes it visible to them; an ordinary
 * event keeps its audience as it is — adding a row there would turn a club-wide event
 * into an invite-only one. Idempotent — a resubmitted form, a retried job or a re-sync
 * changes nothing the second time. Per-session events get no whole-event RSVP.
 */
export async function signUpForFormEvents(database, slug, member) {
  const events = await database('events')
    .where({ signup_form_slug: slug })
    .andWhere((q) => q.where('cancelled', false).orWhereNull('cancelled'))
    .select('id', 'participation_mode', 'form_signup_only')
  const added = []
  for (const event of events) {
    await database.transaction(async (trx) => {
      if (event.form_signup_only) {
        await trx('events_members')
          .insert({ events_id: event.id, members_id: member.id })
          .onConflict(['events_id', 'members_id']).ignore()
      }
      if (event.participation_mode && event.participation_mode !== 'whole') return
      // Targetless ON CONFLICT: the uniques are partial (session_id IS NULL / NOT NULL).
      await trx.raw(`
        INSERT INTO participations (member, activity_type, activity_id, status, note, guest_count, is_staff)
        VALUES (?, 'event', ?::text, 'confirmed', '', 0, false)
        ON CONFLICT DO NOTHING
      `, [member.id, String(event.id)])
      // An older row (an absence auto-decline, an RSVP from before the event went
      // form-only) must not outrank the form: the submission is the answer.
      await trx('participations')
        .where({ activity_type: 'event', activity_id: String(event.id), member: member.id })
        .whereNull('session_id')
        .whereNot('status', 'confirmed')
        .update({ status: 'confirmed', waitlisted_at: null, auto_declined_by: null })
    })
    added.push(event.id)
  }
  return added
}

/**
 * Sign in everyone who already submitted the form (connecting a form to an event, or the
 * admins' "Sync sign-ups"). `submissions` is listAllSubmissions' shape. The email answer
 * is the form's first email question; a "Name" text question, when there is one, tells
 * siblings on a shared address apart. Guests (not members) are simply not signed in.
 */
export async function syncFormSignups(database, slug, submissions) {
  const fields = Array.isArray(submissions?.fields) ? submissions.fields : []
  const emailField = fields.find((f) => f?.type === 'email')
  const nameField = fields.find((f) => f?.type === 'text' && /name/i.test(String(f.name ?? '')))
  const result = { submissions: 0, signed_in: 0, not_members: 0, ambiguous: 0, events: [] }
  if (!emailField) return { ...result, error: 'no_email_question' }
  const events = new Set()
  for (const row of submissions?.data ?? []) {
    result.submissions++
    // ⚠ OpnForm nests the answers: { id, data: { <field id>: answer } } (see scorer-exam.js
    // answersOf). Reading row[fieldId] matched nobody — "signed in: 0" on 30.10.2026.
    const answers = (row && row.data) || row || {}
    const found = await resolveMember(database, answers[emailField.id], nameField ? answers[nameField.id] : null)
    if (found.status === 'not_found') { result.not_members++; continue }
    if (found.status === 'ambiguous') { result.ambiguous++; continue }
    const added = await signUpForFormEvents(database, slug, found.member)
    if (added.length) result.signed_in++
    added.forEach((id) => events.add(id))
  }
  result.events = [...events]
  return result
}

export function registerOpnformMembers(router, { database, logger }) {
  const log = logger.child({ endpoint: 'opnform-members' })

  const service = (route, handler) => async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const hash = String(process.env.OPNFORM_SERVICE_TOKEN_HASH ?? '').trim().toLowerCase()
    if (!hash) return res.status(503).json({ error: 'Not configured' })
    if (req.headers['cf-connecting-ip']) return res.status(404).json({ error: 'Not found' })
    if (!serviceTokenOk(req.headers[SERVICE_TOKEN_HEADER], hash)) {
      return res.status(401).json({ error: 'Invalid service token' })
    }
    try {
      await handler(req, res)
    } catch (err) {
      log.error(`[${route}] ${err?.message || err}`)
      res.status(500).json({ error: 'Internal error' })
    }
  }

  router.post('/opnform/v1/member-lookup', service('member-lookup', async (req, res) => {
    const { email, name } = req.body ?? {}
    const found = await resolveMember(database, email, name)
    if (found.status !== 'found') return res.json({ status: found.status })
    res.json({
      status: 'found',
      // Fills the form's name field when the respondent left it empty.
      name: memberDisplayName(found.member),
      ...(await memberTeamsAndSections(database, found.member)),
    })
  }))

  router.post('/opnform/v1/signup', service('signup', async (req, res) => {
    const { form_slug: slug, submission_id: submissionId, email, name } = req.body ?? {}
    if (!slug || !SLUG_RE.test(String(slug))) return res.status(400).json({ error: 'Invalid form_slug' })
    const found = await resolveMember(database, email, name)
    if (found.status !== 'found') {
      // The fork validated the email on submit, so this means the member changed in
      // between (or two members now share the address). Nothing to sign in; say so.
      log.warn(`[signup] ${slug}: submission ${submissionId ?? '?'} matched ${found.status}`)
      return res.json({ status: found.status, events: [] })
    }
    const events = await signUpForFormEvents(database, String(slug), found.member)
    if (events.length > 0) {
      log.info(`[signup] ${slug}: member ${found.member.id} signed into event(s) ${events.join(', ')}`)
      // Actor = the member themself (they submitted the form); no app account → container log only.
      if (found.member.user) {
        for (const eventId of events) {
          await writeUserLog(database, log, {
            accountability: { user: found.member.user },
            action: 'create',
            collection: 'participations',
            recordId: eventId,
            data: { via: 'opnform_signup', form_slug: slug, submission_id: submissionId ?? null },
          })
        }
      }
    }
    res.json({ status: 'found', events })
  }))
}
