// Shared basketball required-document logic.
//
// Mirrors Swiss Basketball's "Liste der Dokumente für jeden Fall" (licensing
// procedure) and the client gate in kscw-website registration-form.js (bbDocSet).
// The applicant's licensing SITUATION plus nationality and whether they are a
// minor (U18, FIBA minor-transfer rules) decide which documents are mandatory
// beyond ID front/back + signed Lizenzantrag. The school-enrolment certificate
// is always optional and therefore never appears in the required set.
//
// Used by kscw-endpoints (registration create + doc-status + docs-request email),
// kscw-hooks (approval gate) AND the wiedisync admin page, which imports it via
// the `@bb-docs` Vite/tsconfig alias — see bb-docs.d.ts. The admin page kept a
// hand-written copy until 09.09.2026 and it drifted: it never learned the
// Freibrief waiver below, and blocked REG-2026-1054 on a document this module
// had already waived. One copy now, for everything that ships from this repo.
//
// ⚠ kscw-website's registration-form.js is a separate repo, vanilla JS, no
// bundler — it remains a hand-kept mirror and must change alongside this file.

export const BB_SITUATIONS = ['new', 'transfer_ch', 'transfer_intl', 'returning']

// Pre-413 values (and what kscw-website's form still posts) → the slugs above.
const LEGACY_SITUATIONS = { neu: 'new', rueckkehr: 'returning' }
const situationSlug = (s) => LEGACY_SITUATIONS[s] ?? s

// Minor = under 18 at the start of the current season (Sept 1). Accepts either a
// YYYY-MM-DD string (client / Directus REST) OR a JS Date — Postgres `date`
// columns read via raw knex (doc-status route, approval gate) come back as Date
// objects, and String(date).slice(0,10) would be "Thu Jan 15", silently making
// every applicant look adult. Use LOCAL getters: pg parses a `date` to local
// midnight, so getFullYear/Month/Date give back the stored calendar day (toISOString
// would shift a day in a positive-offset timezone like Europe/Zurich).
export function bbAgeAtSeasonStart(dob) {
  if (!dob) return null
  let ymd
  if (dob instanceof Date) {
    if (Number.isNaN(dob.getTime())) return null
    ymd = `${dob.getFullYear()}-${String(dob.getMonth() + 1).padStart(2, '0')}-${String(dob.getDate()).padStart(2, '0')}`
  } else {
    ymd = String(dob).slice(0, 10)
  }
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const by = +m[1], bm = +m[2], bd = +m[3]
  const now = new Date()
  // ⚠ Jul 1 with a Sep 1 age reference, NOT the club's Jun 1 cutover (season.js)
  // — deliberate. This is the licence AGE-BAND rule, not a season label, and it
  // is a matched pair with the same rule in kscw-website's registration-form.js.
  // Change both together or neither. (The wiedisync admin page imports this
  // module now, so it is no longer a third copy that can drift.)
  const seasonStartYear = (now.getUTCMonth() + 1) >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  const refMonth = 9, refDay = 1 // Sept 1
  let age = seasonStartYear - by
  if (refMonth < bm || (refMonth === bm && refDay < bd)) age--
  return age
}

export function bbIsMinor(dob) {
  const age = bbAgeAtSeasonStart(dob)
  return age !== null && age < 18
}

// Swiss Basketball waives the Freibrief (release letter) for a transfer from
// another Swiss club in two cases, per "Verfahren Lizenz SWB" §3:
//   - the player held no licence in the last two seasons — the former club has
//     nothing to release
//   - category U12 and below
//
// `recentLicence` is the applicant's own answer (true | false | null; the pre-413
// 'ja' | 'nein' strings are still accepted). Only an explicit false / 'nein' waives: null means unanswered (or a row created before the
// question existed) and must keep the document required, because wrongly waiving
// it produces an incomplete dossier that Swiss Basketball rejects later.
//
// The age side is derived rather than asked. Swiss Basketball assigns the
// category itself and its procedure document does not state the cut-off, so this
// approximates U12-and-below as "under 12 at season start" — the same Sept 1
// convention bbIsMinor uses for U18. An unknown date of birth keeps the Freibrief
// required. kscw-website's registration-form.js mirrors this exactly; the two
// must change together, or the form and this gate disagree and the applicant is
// either asked for a document they do not owe or blocked from registering.
export function bbFreibriefWaived(dob, recentLicence) {
  if (recentLicence === false || String(recentLicence ?? '').toLowerCase() === 'nein') return true
  const age = bbAgeAtSeasonStart(dob)
  return age !== null && age < 12
}

// The single nationality code the document gate must judge a (possibly multi-)
// national by. FIBA treats a dual national who holds Swiss nationality as
// Swiss, so a CH code ANYWHERE in the list clears the foreign-player documents
// (self declaration / national team declaration) — ordering it first is a UI
// convention, not a legal one. Without a CH code the primary (first) code
// decides. `fallback` is an optional single code (the old `nationalitaet_code`
// column, folded into `nationality_codes` by migration 413).
//
// Lives here so all three backend enforcement points (registration create,
// doc-status, approval gate) apply one rule, and the wiedisync admin page
// imports it through the `@bb-docs` alias rather than restating it.
export function fibaNatCode(codes, fallback) {
  const list = String(codes || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s))
  if (list.includes('CH')) return 'CH'
  return list[0] || String(fallback || '').trim().toUpperCase().slice(0, 2)
}

// Document columns renamed since the website went live (migrations 413 / 422).
// Waiver lists stored before a rename still name the old column.
export const LEGACY_DOC_COLUMNS = Object.freeze({
  __proto__: null,
  bb_doc_freibrief: 'bb_doc_release_letter',
  bb_doc_lizenz: 'bb_doc_licence',
})

// Documents an approver has waived for ONE registration (migration 358), parsed
// from the stored comma list. Unknown names are dropped rather than trusted: the
// column is admin-writable, and a typo that silently waived nothing is safer than
// a typo that silently waived something.
export function parseWaivedDocs(waived) {
  const known = new Set([
    'id_upload_front', 'id_upload_back', 'bb_doc_licence', 'bb_doc_release_letter',
    'bb_doc_selfdecl', 'bb_doc_natdecl', 'bb_doc_u18parents', 'bb_doc_schoolcert',
  ])
  return String(waived || '')
    .split(',')
    .map((s) => s.trim())
    // Columns renamed by migrations 413 / 422; an older waiver still counts.
    .map((s) => LEGACY_DOC_COLUMNS[s] ?? s)
    .filter((s) => known.has(s))
}

// What this registration must still produce: the procedure's required set minus
// what an approver waived on the record. Subtractive by construction — a waiver
// can only ever remove a requirement — so a row with no waiver is unchanged.
//
// Every reader of the required set goes through here, NOT bbRequiredDocs, or the
// club waives a document on the approval screen and the docs-request email keeps
// asking the applicant for it. bbRequiredDocs stays the pure statement of what
// Swiss Basketball's procedure demands; the create route uses it directly,
// because a submission that does not exist yet cannot carry a waiver.
export function bbRequiredDocsAfterWaiver(situation, natCode, dob, recentLicence, waived) {
  const w = parseWaivedDocs(waived)
  return bbRequiredDocs(situation, natCode, dob, recentLicence).filter((k) => !w.includes(k))
}

// Required document COLUMNS (registrations table) for a basketball registration.
// A falsy/unknown situation falls back to the legacy nationality-only rule so
// rows created before the situation field existed keep a sane required set.
export function bbRequiredDocs(rawSituation, natCode, dob, recentLicence) {
  const situation = situationSlug(rawSituation)
  const base = ['id_upload_front', 'id_upload_back', 'bb_doc_licence']
  const foreign = natCode && natCode !== 'CH'
  const minor = bbIsMinor(dob)
  if (!BB_SITUATIONS.includes(situation)) {
    // Legacy fallback (matches the pre-2026-07 natCode-only gate).
    if (foreign) base.push('bb_doc_selfdecl', 'bb_doc_natdecl')
    return base
  }
  switch (situation) {
    case 'transfer_ch':
      if (!bbFreibriefWaived(dob, recentLicence)) base.push('bb_doc_release_letter')
      break
    case 'transfer_intl':
    case 'returning':
      base.push('bb_doc_selfdecl')
      if (minor) base.push('bb_doc_natdecl', 'bb_doc_u18parents')
      break
    case 'new':
    default:
      if (foreign) base.push('bb_doc_selfdecl')
      if (foreign && minor) base.push('bb_doc_natdecl')
      break
  }
  return base
}
