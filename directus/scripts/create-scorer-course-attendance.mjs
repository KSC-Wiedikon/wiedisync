/**
 * One-off: create the `scorer_course_attendance` collection on Directus.
 *
 * Per-registrant tracking for volleyball scorer-course signups. The signups
 * themselves live in OpnForm (forms.kscw.ch) and are read-only from our side;
 * this collection holds the admin-owned state that OpnForm cannot: attendance,
 * exam progress, a manually-filled SV licence, and notes. Rows are keyed to a
 * single OpnForm submission via (form_slug, submission_id), deduped by the
 * unique `sub_key` = "<form_slug>:<submission_id>".
 *
 * Reached only through the /kscw/wadmin generic CRUD under the `scorer_courses`
 * section grant (see wadmin.js SECTION_COLLECTIONS). All fields are scalar so
 * the section-scoped-admin scalar guards pass unchanged.
 *
 * Plain content collection (no M2M, no file) — API creation is allowed
 * (the admin-UI mandate in CLAUDE.md is M2M-only). After running on dev:
 *   npm run schema:pull   (captures it into directus/sync/, commit that)
 *
 * Auth: same .env.local auto-load + token/password resolution as
 * create-scorer-courses.mjs. Target dev:
 *   DIRECTUS_URL=https://directus-dev.kscw.ch node directus/scripts/create-scorer-course-attendance.mjs
 * Then prod:
 *   DIRECTUS_URL=https://directus.kscw.ch     node directus/scripts/create-scorer-course-attendance.mjs
 */
import { readFileSync as _readFileSync } from 'node:fs'
import { fileURLToPath as _fileURLToPath } from 'node:url'
import { dirname as _dirname, join as _join } from 'node:path'
const _here = _dirname(_fileURLToPath(import.meta.url))
try {
  const envText = _readFileSync(_join(_here, '../../.env.local'), 'utf-8')
  for (const line of envText.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
} catch { /* file missing — fine */ }

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://localhost:8055'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@kscw.ch'
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').replace(/\\!/g, '!')
const STATIC_TOKEN = process.env.DIRECTUS_TOKEN
  || (DIRECTUS_URL.includes('directus-dev') ? process.env.DIRECTUS_DEV_TOKEN : '')
  || (DIRECTUS_URL.includes('directus.kscw.ch') ? process.env.DIRECTUS_PROD_TOKEN : '')
  || ''
if (!STATIC_TOKEN && !ADMIN_PASSWORD) {
  console.error('Need DIRECTUS_TOKEN, DIRECTUS_DEV_TOKEN, DIRECTUS_PROD_TOKEN, or ADMIN_PASSWORD')
  process.exit(1)
}

let token = null
async function auth() {
  if (STATIC_TOKEN) {
    token = STATIC_TOKEN
    const res = await fetch(`${DIRECTUS_URL}/server/info`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) return
    console.log('  Static token invalid, falling back to password auth...')
  }
  const res = await fetch(`${DIRECTUS_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`)
  token = (await res.json()).data.access_token
}

async function api(method, path, body) {
  const res = await fetch(`${DIRECTUS_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  if (!res.ok) {
    if (text.includes('already exists') || text.includes('RECORD_NOT_UNIQUE')) return null
    throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 400)}`)
  }
  return text ? JSON.parse(text).data : null
}

const COLLECTION = {
  collection: 'scorer_course_attendance',
  schema: {},
  meta: {
    icon: 'fact_check',
    note: 'Per-registrant tracking for scorer-course signups (attendance, exam, SV licence, notes). Keyed to an OpnForm submission. Managed via /admin.',
    hidden: false,
    display_template: '{{sub_key}}',
  },
  fields: [
    { field: 'id', type: 'integer',
      schema: { is_primary_key: true, has_auto_increment: true },
      meta: { hidden: true, interface: 'input', readonly: true } },
    { field: 'sub_key', type: 'string',
      schema: { is_nullable: false, is_unique: true },
      meta: { interface: 'input', required: true, width: 'half',
        note: 'Dedup key: "<form_slug>:<submission_id>". One row per signup.' } },
    { field: 'form_slug', type: 'string',
      schema: { is_nullable: false },
      meta: { interface: 'input', required: true, width: 'half',
        note: 'OpnForm form slug (identifies the course form).' } },
    { field: 'submission_id', type: 'string',
      schema: { is_nullable: false },
      meta: { interface: 'input', required: true, width: 'half',
        note: 'OpnForm submission id this row tracks.' } },
    { field: 'present', type: 'boolean',
      schema: { is_nullable: false, default_value: false },
      meta: { interface: 'boolean', special: ['cast-boolean'], width: 'half',
        note: 'Attended the course.' } },
    { field: 'exam_sent', type: 'boolean',
      schema: { is_nullable: false, default_value: false },
      meta: { interface: 'boolean', special: ['cast-boolean'], width: 'half',
        note: 'Exam was sent to the registrant.' } },
    { field: 'exam_passed', type: 'boolean',
      schema: { is_nullable: false, default_value: false },
      meta: { interface: 'boolean', special: ['cast-boolean'], width: 'half',
        note: 'Superseded by exam_result — kept because it is what was recorded before the Yes/No split. /admin reads and writes exam_result.' } },
    // exam_passed could not answer "has anyone decided yet?": false meant both "failed"
    // and "not looked at", and the overwhelming majority of rows are the latter. Reading
    // that false as "failed" would print "Nicht bestanden" against every undecided
    // participant on an official SVRZ list. Hence a third state, spelled out.
    { field: 'exam_result', type: 'string',
      schema: { is_nullable: true },
      meta: { interface: 'select-dropdown', width: 'half',
        options: { choices: [
          { text: 'Bestanden', value: 'passed' },
          { text: 'Nicht bestanden', value: 'failed' },
        ] },
        note: 'Exam outcome: passed / failed / empty = not decided yet. Empty is NOT a fail — see the SVRZ export.' } },
    { field: 'sv_license', type: 'string',
      schema: { is_nullable: true },
      meta: { interface: 'input', width: 'half',
        note: 'Swiss Volley licence number, filled in when the registrant did not provide one.' } },
    { field: 'exam_date', type: 'date',
      schema: { is_nullable: true },
      meta: { interface: 'datetime', width: 'half',
        note: 'Prüfungsdatum — set to the upload date when the registrant uploads their scoresheet; editable in /admin. Printed on the SVRZ Teilnehmerliste.' } },
    { field: 'exam_file', type: 'uuid',
      schema: { is_nullable: true },
      meta: { interface: 'file', special: ['file'], width: 'half',
        note: 'The scoresheet as the PARTICIPANT uploaded it. Never overwritten by an admin correction — see exam_file_corrected. Private (SCORER_EXAM_FOLDER) — read via /kscw/wadmin/scorer_courses/assets/:id, never /assets.' } },
    // A correction does not replace exam_file: the participant's own sheet is what they
    // actually submitted, and an admin edit on top is a separate claim. Both stay readable.
    { field: 'exam_file_corrected', type: 'uuid',
      schema: { is_nullable: true },
      meta: { interface: 'file', special: ['file'], width: 'half',
        note: 'Admin-corrected scoresheet, uploaded from /admin. Takes precedence in the SVRZ zip. Same private folder as exam_file.' } },
    // Written server-side from the Directus session (wadmin.js) — never accepted from a
    // client, or the attribution would be worth nothing.
    { field: 'exam_file_corrected_by', type: 'string',
      schema: { is_nullable: true },
      meta: { interface: 'input', readonly: true, width: 'half',
        note: 'Name of the admin who uploaded the correction. Set server-side from the session; not client-writable.' } },
    { field: 'exam_file_corrected_on', type: 'timestamp',
      schema: { is_nullable: true },
      meta: { interface: 'datetime', readonly: true, width: 'half',
        note: 'When the correction was uploaded. Set server-side alongside exam_file_corrected_by.' } },
    { field: 'notes', type: 'text',
      schema: { is_nullable: true },
      meta: { interface: 'input-multiline', width: 'full',
        note: 'Free-text remarks / follow-up.' } },
    { field: 'date_created', type: 'timestamp',
      schema: {},
      meta: { interface: 'datetime', readonly: true, hidden: true,
        special: ['date-created'], width: 'half' } },
    { field: 'date_updated', type: 'timestamp',
      schema: {},
      meta: { interface: 'datetime', readonly: true, hidden: true,
        special: ['date-updated'], width: 'half' } },
  ],
}

// Scoresheets are personal data. The Public file policy grants /assets reads on
// FOLDER-LESS files only (setup-permissions.mjs: "a folder assignment === private"), so
// this folder is the privacy boundary — an upload written with folder=null would be
// fetchable by anyone holding its id. Mirrored as SCORER_EXAM_FOLDER in scorer-exam.js.
const SCORER_EXAM_FOLDER = 'd0c00002-0000-4000-8000-000000000001'

async function main() {
  await auth()
  console.log(`→ ${DIRECTUS_URL}`)

  const existing = await api('GET', '/collections/scorer_course_attendance').catch(() => null)
  if (existing) {
    console.log('  ✓ collection scorer_course_attendance already exists — skipping create')
  } else {
    await api('POST', '/collections', COLLECTION)
    console.log('  ✓ collection scorer_course_attendance created')
  }

  // Re-runnable field pass. The create above is a no-op on an existing collection, so
  // fields added to COLLECTION after the first run would otherwise never reach a live
  // instance — which is exactly how exam_date/exam_file came to exist on prod but not
  // here. Add fields to COLLECTION.fields and re-run; this reconciles the difference.
  const live = await api('GET', '/fields/scorer_course_attendance')
  const have = new Set((live || []).map((f) => f.field))
  for (const f of COLLECTION.fields) {
    if (have.has(f.field)) continue
    await api('POST', '/fields/scorer_course_attendance', f)
    console.log(`  ✓ field ${f.field} created`)
  }

  const folders = await api('GET', `/folders?filter[id][_eq]=${SCORER_EXAM_FOLDER}&limit=1`)
  if (folders?.length) {
    console.log('  ✓ scorer exam folder already exists')
  } else {
    await api('POST', '/folders', { id: SCORER_EXAM_FOLDER, name: 'Scorer exam scoresheets', parent: null })
    console.log('  ✓ scorer exam folder created')
  }

  // exam_file / exam_file_corrected → directus_files. Without the relation Directus treats
  // the column as a bare uuid and the admin file interface cannot resolve it.
  for (const field of ['exam_file', 'exam_file_corrected']) {
    const rels = await api('GET', `/relations/scorer_course_attendance/${field}`).catch(() => null)
    if (rels) {
      console.log(`  ✓ ${field} relation already exists`)
      continue
    }
    await api('POST', '/relations', {
      collection: 'scorer_course_attendance',
      field,
      related_collection: 'directus_files',
    })
    console.log(`  ✓ ${field} relation created`)
  }

  // Backfill exam_result from the exam_passed it replaces. Only `true` carries over:
  // exam_passed=false is the default every row is born with, so reading it as "failed"
  // would invent a verdict nobody gave. Those rows stay undecided until someone answers.
  // Guarded on exam_result IS NULL, so a re-run cannot overwrite a later correction.
  const stale = await api('GET', '/items/scorer_course_attendance'
    + '?filter[exam_passed][_eq]=true&filter[exam_result][_null]=true&fields=id&limit=-1')
  if (stale?.length) {
    await api('PATCH', '/items/scorer_course_attendance', {
      keys: stale.map((r) => r.id),
      data: { exam_result: 'passed' },
    })
    console.log(`  ✓ exam_result backfilled to 'passed' on ${stale.length} row(s)`)
  } else {
    console.log('  ✓ no exam_passed=true rows need an exam_result backfill')
  }

  console.log('Done. Next: npm run schema:pull && review git diff directus/sync/')
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
