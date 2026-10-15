// Member value vocabulary: the English slugs wiedisync stores (phase 2b-2 of the
// English-only DB migration) and the ClubDesk strings they meet at the border.
//
// Dependency-free ESM like registration-values.js: kscw-endpoints, kscw-hooks,
// directus/scripts and the frontend (`@member-values`) import this one copy.
// The SQL twins are cd_to_app() / app_to_cd() over clubdesk_value_map
// (migration 412) — keep the two in step.
//
// Every normalizer accepts the old German value too, because ClubDesk, old
// cached bundles and the kscw-website form still send it.

const trim = (v) => String(v ?? '').trim()

// ── salutation (members + registrations) ────────────────────────────────────
export const SALUTATION_VALUES = ['mr', 'ms']
const SALUTATION_CD = { mr: 'Herr', ms: 'Frau' }
const SALUTATION_IN = { mr: 'mr', herr: 'mr', ms: 'ms', frau: 'ms', mrs: 'ms' }
/** 'Herr' | 'Frau' | 'mr' | 'ms' → 'mr' | 'ms' | null. */
export function normalizeSalutation(v) { return SALUTATION_IN[trim(v).toLowerCase()] ?? null }
/** Slug → ClubDesk's Anrede ('Herr' / 'Frau'); an unknown value travels as is. */
export function salutationToClubdesk(v) {
  const s = normalizeSalutation(v)
  return s ? SALUTATION_CD[s] : trim(v)
}
/** Salutation that follows from sex ('m' | 'f'), as a slug. */
export function salutationForSex(sex) {
  return sex === 'm' ? 'mr' : sex === 'f' ? 'ms' : null
}

// ── cantonal_school (members + registrations) ───────────────────────────────
// 'none' = asked, and not at a Kantonsschule (was 'Nein'); NULL = never asked.
// 'other' = a Kantonsschule the list does not name (was 'Andere Kantonsschule').
// Every other value is a school name and stays as typed.
export const CANTONAL_SCHOOL_NONE = 'none'
export const CANTONAL_SCHOOL_OTHER = 'other'
export function normalizeCantonalSchool(v) {
  const s = trim(v)
  if (!s) return null
  const l = s.toLowerCase()
  if (l === 'none' || l === 'nein') return CANTONAL_SCHOOL_NONE
  if (l === 'other' || l === 'andere kantonsschule') return CANTONAL_SCHOOL_OTHER
  return s
}
/** Slug → the value the old signup form and ClubDesk CSV carried. */
export function cantonalSchoolToLegacy(v) {
  const s = normalizeCantonalSchool(v)
  if (s === CANTONAL_SCHOOL_NONE) return 'Nein'
  if (s === CANTONAL_SCHOOL_OTHER) return 'Andere Kantonsschule'
  return s ?? ''
}

// ── licence_category ────────────────────────────────────────────────────────
// Only the officials category is a German word; the playing categories (RLL,
// JLL, Senior, U 14, …) are federation codes and stay as the federation spells them.
export const LICENCE_CATEGORY_OFFICIAL = 'official'
export function normalizeLicenceCategory(v) {
  const s = trim(v)
  if (/^(offizielle\/r|official|ufficiale|officiel(\/le)?)$/i.test(s)) return LICENCE_CATEGORY_OFFICIAL
  return s || null
}
export function licenceCategoryToClubdesk(v) {
  const s = normalizeLicenceCategory(v)
  return s === LICENCE_CATEGORY_OFFICIAL ? 'Offizielle/r' : (s ?? '')
}
