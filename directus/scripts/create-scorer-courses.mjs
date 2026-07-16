/**
 * One-off: create the `scorer_courses` collection + fields on Directus and
 * seed the initial row. Idempotent (re-runnable; "already exists" swallowed).
 *
 * Plain content collection (no M2M, no file) — API creation is allowed
 * (the admin-UI mandate in CLAUDE.md is M2M-only). After running on dev:
 *   npm run schema:pull   (captures it into directus/sync/, commit that)
 *
 * Auth: same .env.local auto-load + token/password resolution as
 * setup-permissions.mjs. Target dev:
 *   DIRECTUS_URL=https://directus-dev.kscw.ch node directus/scripts/create-scorer-courses.mjs
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
  collection: 'scorer_courses',
  schema: {},
  meta: {
    icon: 'edit_note',
    note: 'Volleyball scorer-course sign-up sessions (surfaced on the public schreiberkurse page + /admin).',
    sort_field: 'sort',
    archive_field: 'active',
    archive_value: 'false',
    unarchive_value: 'true',
    display_template: '{{title_en}} ({{date_iso}})',
  },
  fields: [
    { field: 'id', type: 'integer',
      schema: { is_primary_key: true, has_auto_increment: true },
      meta: { hidden: true, interface: 'input', readonly: true } },
    { field: 'slug_id', type: 'string',
      schema: { is_nullable: false },
      meta: { interface: 'input', required: true, note: 'Stable id, e.g. 2026-07-08-en — used for keys/CSV', width: 'half' } },
    { field: 'active', type: 'boolean',
      schema: { is_nullable: false, default_value: true },
      meta: { interface: 'boolean', special: ['cast-boolean'], width: 'half',
        note: 'Only active courses are public.' } },
    { field: 'title_de', type: 'string',
      schema: { is_nullable: false },
      meta: { interface: 'input', required: true, width: 'half' } },
    { field: 'title_en', type: 'string',
      schema: { is_nullable: false },
      meta: { interface: 'input', required: true, width: 'half' } },
    { field: 'date_iso', type: 'date',
      schema: { is_nullable: true },
      meta: { interface: 'datetime', width: 'half',
        note: 'Leave empty = "date to be announced".' } },
    { field: 'time', type: 'string',
      schema: { is_nullable: true },
      meta: { interface: 'input', width: 'half', options: { placeholder: '18:00' },
        note: '24h HH:MM.' } },
    // UTC instant, entered in /admin as Europe/Zurich wall-clock. The public card
    // locks past it (sign-up button → "Anmeldung geschlossen"); the card itself
    // stays visible until date_iso passes. Source of truth for the deadline —
    // /admin mirrors it onto each OpnForm's own closes_at, which is what actually
    // rejects late submissions.
    { field: 'registration_closes', type: 'timestamp',
      schema: { is_nullable: true },
      meta: { interface: 'datetime', width: 'half',
        note: 'Sign-up closes at this instant. Empty = open until the course date.' } },
    { field: 'mode', type: 'string',
      schema: { is_nullable: false, default_value: 'in_person' },
      meta: { interface: 'select-dropdown', width: 'half',
        options: { choices: [
          { text: 'In person', value: 'in_person' },
          { text: 'Recording', value: 'recorded' },
          { text: 'In person or recording', value: 'both' },
        ] } } },
    { field: 'sort', type: 'integer',
      schema: { is_nullable: true, default_value: 0 },
      meta: { interface: 'input', hidden: true, width: 'half' } },
    { field: 'form_slug_de', type: 'string',
      schema: { is_nullable: true },
      meta: { interface: 'input', width: 'half',
        note: 'OpnForm slug for the German form (last URL segment).' } },
    { field: 'form_slug_en', type: 'string',
      schema: { is_nullable: true },
      meta: { interface: 'input', width: 'half',
        note: 'OpnForm slug for the English form (last URL segment).' } },
    { field: 'scorer_expert', type: 'string',
      schema: { is_nullable: true },
      meta: { interface: 'input', width: 'half',
        note: 'Name printed in the "Schreiberexperte" line of the SVRZ Teilnehmerliste export. Nothing public reads it.' } },
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

const SEED = {
  slug_id: '2026-07-08-en',
  active: true,
  title_de: 'Volleyball-Schreiberkurs (Englisch)',
  title_en: 'Volleyball scorer course (English)',
  date_iso: '2026-07-08',
  time: '18:00',
  mode: 'in_person',
  sort: 0,
  form_slug_de: null,
  form_slug_en: null,
}

async function main() {
  await auth()
  console.log(`→ ${DIRECTUS_URL}`)

  const existing = await api('GET', '/collections/scorer_courses').catch(() => null)
  if (existing) {
    console.log('  ✓ collection scorer_courses already exists — skipping create')
  } else {
    await api('POST', '/collections', COLLECTION)
    console.log('  ✓ collection scorer_courses created')
  }

  // Re-runnable field pass — the create above no-ops on an existing collection, so a
  // field added to COLLECTION later would never reach a live instance without this.
  const live = await api('GET', '/fields/scorer_courses')
  const have = new Set((live || []).map((f) => f.field))
  for (const f of COLLECTION.fields) {
    if (have.has(f.field)) continue
    await api('POST', '/fields/scorer_courses', f)
    console.log(`  ✓ field ${f.field} created`)
  }

  const rows = await api('GET', '/items/scorer_courses?filter[slug_id][_eq]=2026-07-08-en&limit=1')
  if (Array.isArray(rows) && rows.length) {
    console.log('  ✓ seed row 2026-07-08-en already present — skipping')
  } else {
    await api('POST', '/items/scorer_courses', SEED)
    console.log('  ✓ seed row 2026-07-08-en inserted')
  }

  console.log('Done. Next: npm run schema:pull && review git diff directus/sync/')
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
