/**
 * Editable transactional email templates.
 *
 * Staff can rewrite the copy of certain outbound emails from /admin/email-templates
 * instead of waiting for a code change and an ext:deploy. The database row is the
 * source of truth WHEN IT EXISTS AND IS NON-EMPTY; every field independently falls
 * back to the hardcoded default the endpoint passes in.
 *
 * That per-field fallback is the whole safety story. A missing row, a blanked
 * field, a locale nobody translated, a table that does not exist yet because the
 * migration has not run — each degrades to the compiled-in copy rather than
 * sending an email with a hole in it. The send path must never be able to fail
 * because someone was editing text.
 *
 * Placeholders are `{{name}}`-style and are substituted AFTER escaping the values,
 * so a registrant called `<script>` cannot inject markup into the email. The body
 * itself is authored by staff and is intentionally allowed to contain HTML — it is
 * the same trust level as any other admin-authored content in the app, and the
 * hook in kscw-hooks strips <script>/<style>/event handlers on write.
 */

// Registry of editable templates. `vars` is the complete set a template may use;
// `required` are the ones the copy is meaningless without, and the write hook
// rejects a body missing any of them.
//
// ⚠ Adding a key here is only half the job — the endpoint that sends it has to
// call loadTemplate()/renderTemplate() with a matching default, and the key needs
// a row per locale (migration or the admin UI's "reset to default").
export const TEMPLATE_KEYS = Object.freeze({
  registration_docs_request: {
    vars: ['name', 'documents', 'reference', 'email', 'link'],
    // Without {{documents}} the reader is told something is missing but not what,
    // and the whole point of the email is the list.
    required: ['documents'],
    // Which fields accept placeholders at all (subject lines cannot carry a list).
    placeholderFields: ['subject', 'title', 'greeting', 'body_html', 'cta_label', 'footer'],
    listOnly: ['documents'],
  },
})

export const TEMPLATE_LOCALES = Object.freeze(['de', 'gsw', 'en', 'fr', 'it'])

// The editable fields, in the order the admin UI shows them. Kept here so the
// endpoint, the write hook and the page agree on one list.
export const TEMPLATE_FIELDS = Object.freeze([
  'subject', 'title', 'greeting', 'body_html', 'cta_label', 'footer',
])

const PLACEHOLDER_RE = /\{\{\s*([a-z_]+)\s*\}\}/gi

/**
 * Read the stored template for (key, locale). Returns null when there is nothing
 * usable — the caller then runs entirely on its defaults.
 *
 * Never throws: a missing table (migration not yet applied on this environment)
 * or any other read failure resolves to null, because a text edit must not be
 * able to take down a send.
 */
export async function loadTemplate(database, key, locale, log) {
  if (!TEMPLATE_KEYS[key]) return null
  try {
    const row = await database('email_templates')
      .where({ template_key: key, locale })
      .first(...TEMPLATE_FIELDS)
    return row || null
  } catch (err) {
    try {
      log?.warn?.({ msg: `email template read failed, using defaults: ${err.message}`, key, locale })
    } catch { /* ignore */ }
    return null
  }
}

/**
 * Merge a stored row over the compiled-in defaults, FIELD BY FIELD.
 *
 * Blank-but-present is treated as "not set" on purpose: clearing a box in the
 * editor restores the built-in wording rather than sending an email with an empty
 * subject line.
 */
export function mergeTemplate(defaults, row) {
  const out = {}
  for (const f of TEMPLATE_FIELDS) {
    const stored = row?.[f]
    out[f] = (typeof stored === 'string' && stored.trim()) ? stored : (defaults?.[f] ?? '')
  }
  return out
}

/**
 * Substitute {{placeholders}}. Values must ALREADY be escaped/rendered by the
 * caller — `documents` in particular arrives as an HTML <li> run.
 *
 * An unknown placeholder is left verbatim rather than blanked, so a typo shows up
 * as `{{documnets}}` in the preview instead of silently vanishing from the email.
 */
export function renderTemplate(tpl, vars) {
  const out = {}
  for (const [k, v] of Object.entries(tpl)) {
    out[k] = typeof v === 'string'
      ? v.replace(PLACEHOLDER_RE, (m, name) => (name in vars ? String(vars[name]) : m))
      : v
  }
  return out
}

/** Every distinct placeholder used in a string. */
export function placeholdersIn(str) {
  const found = new Set()
  let m
  PLACEHOLDER_RE.lastIndex = 0
  while ((m = PLACEHOLDER_RE.exec(String(str || '')))) found.add(m[1].toLowerCase())
  return [...found]
}

/**
 * Validate one template row before it is written. Returns an array of
 * human-readable problems — empty means OK.
 *
 * Enforced here rather than only in the browser because the items API is reachable
 * from the Directus admin app and any API client, and a bad template reaches real
 * members' inboxes.
 */
export function validateTemplate(key, fields) {
  const spec = TEMPLATE_KEYS[key]
  const errors = []
  if (!spec) return [`Unknown template "${key}".`]

  for (const f of TEMPLATE_FIELDS) {
    const val = fields[f]
    if (val == null) continue
    if (typeof val !== 'string') { errors.push(`${f} must be text.`); continue }
    for (const p of placeholdersIn(val)) {
      if (!spec.vars.includes(p)) {
        errors.push(`Unknown placeholder {{${p}}} in ${f}. Available: ${spec.vars.map((v) => `{{${v}}}`).join(', ')}.`)
      } else if (spec.listOnly.includes(p) && f !== 'body_html') {
        // {{documents}} expands to a bulleted list — it only makes sense in the body.
        errors.push(`{{${p}}} can only be used in the message body, not in ${f}.`)
      }
    }
  }

  // Required placeholders are checked against the body as it will be SAVED. A
  // field left null on a partial update keeps its stored value, so the caller
  // passes the merged row, not the patch.
  //
  // ⚠ An EMPTY body is valid and must stay valid: blank means "fall back to the
  // compiled-in copy" (mergeTemplate treats blank as unset), and that copy is
  // guaranteed to carry the placeholder — migration 287 refuses to seed a row
  // without it. Enforcing the requirement on an empty body made "restore
  // defaults" impossible, because clearing the box is exactly how a reset is
  // expressed.
  const body = typeof fields.body_html === 'string' ? fields.body_html : ''
  if (body.trim()) {
    for (const p of spec.required) {
      if (!placeholdersIn(body).includes(p)) {
        errors.push(`The message body must contain {{${p}}} — without it the email does not say which documents are missing.`)
      }
    }
  }

  if (typeof fields.subject === 'string' && fields.subject.trim() && fields.subject.length > 200) {
    errors.push('Subject is too long (max 200 characters).')
  }
  return errors
}

/**
 * Archive one outbound message into `email_sends`.
 *
 * `user_logs` already records that a send happened and by whom; this stores the
 * message itself, because the template is editable — reconstructing "what did we
 * actually tell this family in August?" from the template as it reads in November
 * would give the wrong answer.
 *
 * Best-effort, exactly like writeUserLog: the mail is already gone by the time
 * this runs, so a logging failure must not turn a successful send into a 500 that
 * invites the operator to send it a second time.
 */
export async function recordEmailSend(database, log, { templateKey, locale, to, subject, html, collection, recordId, actor }) {
  try {
    await database('email_sends').insert({
      template_key: templateKey || null,
      locale: locale || null,
      to_email: to || null,
      subject: subject || null,
      body_html: html || null,
      collection_name: collection || null,
      record_id: recordId != null ? String(recordId) : null,
      sent_by: actor?.id ?? null,
      sent_by_name: actor ? [actor.first_name, actor.last_name].filter(Boolean).join(' ') || null : null,
      sent_at: new Date(),
    })
  } catch (err) {
    try { log?.warn?.({ msg: `email_sends write failed: ${err.message}`, templateKey, to }) } catch { /* ignore */ }
  }
}

/**
 * Strip the markup an email must never carry, regardless of who authored it.
 * Staff-authored HTML is trusted for layout (<p>, <strong>, <ul>, <a>) but not for
 * script execution — an email client that runs it, or the admin preview that
 * renders it, would both be XSS sinks.
 */
export function sanitizeTemplateHtml(html) {
  if (typeof html !== 'string') return html
  return html
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'>\s]*\2/gi, '$1="#"')
}
