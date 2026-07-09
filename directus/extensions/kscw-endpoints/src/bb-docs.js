// Shared basketball required-document logic.
//
// Mirrors Swiss Basketball's "Liste der Dokumente für jeden Fall" (licensing
// procedure) and the client gate in kscw-website registration-form.js (bbDocSet).
// The applicant's licensing SITUATION plus nationality and whether they are a
// minor (U18, FIBA minor-transfer rules) decide which documents are mandatory
// beyond ID front/back + signed Lizenzantrag. The school-enrolment certificate
// is always optional and therefore never appears in the required set.
//
// Used by both kscw-endpoints (registration create + doc-status) and kscw-hooks
// (approval gate) so all three enforcement points agree.

export const BB_SITUATIONS = ['neu', 'transfer_ch', 'transfer_intl', 'rueckkehr']

// Minor = under 18 at the start of the current season (Sept 1). Accepts either a
// YYYY-MM-DD string (client / Directus REST) OR a JS Date — Postgres `date`
// columns read via raw knex (doc-status route, approval gate) come back as Date
// objects, and String(date).slice(0,10) would be "Thu Jan 15", silently making
// every applicant look adult. Use LOCAL getters: pg parses a `date` to local
// midnight, so getFullYear/Month/Date give back the stored calendar day (toISOString
// would shift a day in a positive-offset timezone like Europe/Zurich).
export function bbIsMinor(dob) {
  if (!dob) return false
  let ymd
  if (dob instanceof Date) {
    if (Number.isNaN(dob.getTime())) return false
    ymd = `${dob.getFullYear()}-${String(dob.getMonth() + 1).padStart(2, '0')}-${String(dob.getDate()).padStart(2, '0')}`
  } else {
    ymd = String(dob).slice(0, 10)
  }
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return false
  const by = +m[1], bm = +m[2], bd = +m[3]
  const now = new Date()
  const seasonStartYear = (now.getUTCMonth() + 1) >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  const refMonth = 9, refDay = 1 // Sept 1
  let age = seasonStartYear - by
  if (refMonth < bm || (refMonth === bm && refDay < bd)) age--
  return age < 18
}

// Required document COLUMNS (registrations table) for a basketball registration.
// A falsy/unknown situation falls back to the legacy nationality-only rule so
// rows created before the situation field existed keep a sane required set.
export function bbRequiredDocs(situation, natCode, dob) {
  const base = ['id_upload_front', 'id_upload_back', 'bb_doc_lizenz']
  const foreign = natCode && natCode !== 'CH'
  const minor = bbIsMinor(dob)
  if (!BB_SITUATIONS.includes(situation)) {
    // Legacy fallback (matches the pre-2026-07 natCode-only gate).
    if (foreign) base.push('bb_doc_selfdecl', 'bb_doc_natdecl')
    return base
  }
  switch (situation) {
    case 'transfer_ch':
      base.push('bb_doc_freibrief')
      break
    case 'transfer_intl':
    case 'rueckkehr':
      base.push('bb_doc_selfdecl')
      if (minor) base.push('bb_doc_natdecl', 'bb_doc_u18parents')
      break
    case 'neu':
    default:
      if (foreign) base.push('bb_doc_selfdecl')
      if (foreign && minor) base.push('bb_doc_natdecl')
      break
  }
  return base
}
