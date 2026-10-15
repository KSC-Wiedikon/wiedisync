// Registration vocabulary: the English column names and value slugs of
// `registrations` (migration 413), and the translation from / to what the
// public signup form and ClubDesk speak.
//
// Dependency-free ESM, like bb-docs.js: kscw-endpoints, kscw-hooks and the
// wiedisync frontend (`@registration-values` alias) all import this one copy.
// Types: registration-values.d.ts beside it.
//
// Phase 2a of the English-only DB migration (.planning/english-db-migration.md).
// Request bodies carry the English keys only: kscw-website posts them since
// 15.10.2026, and the German-key mapping (REG_KEY_RENAMES) is gone. The value
// normalisers below still accept the German form values.
//
// Converted in 2a: sex, role, officials_requested, bb_situation,
// bb_recent_licence, nationality_codes. Still ClubDesk-valued until phase 2b
// (members shares them): salutation, fee_category, cantonal_school,
// club_section_choice.

const norm = (v) => String(v ?? '').trim().toLowerCase()

// ── sex ─────────────────────────────────────────────────────────────────────
export const SEX_VALUES = ['m', 'f']
const SEX_IN = {
  m: 'm', male: 'm', männlich: 'm', maennlich: 'm', mann: 'm', man: 'm',
  f: 'f', female: 'f', weiblich: 'f', frau: 'f', woman: 'f',
}
/** Any spelling the form or an admin sends → 'm' | 'f' | null. */
export function normalizeSex(v) { return SEX_IN[norm(v)] ?? null }
/** 'm' | 'f' → ClubDesk 'männlich' | 'weiblich' (CSV export). */
export function sexToClubdesk(v) {
  const s = normalizeSex(v)
  return s === 'm' ? 'männlich' : s === 'f' ? 'weiblich' : ''
}
/** Salutation ClubDesk derives from sex (CSV export). */
export function salutationFromSex(v) {
  const s = normalizeSex(v)
  return s === 'm' ? 'Herr' : s === 'f' ? 'Frau' : ''
}

// ── role (the "Funktion" picked on the form) ────────────────────────────────
export const ROLE_VALUES = ['player', 'coach', 'guest', 'team_responsible', 'other']
const ROLE_IN = {
  player: 'player', 'spieler*in': 'player', spieler: 'player', spielerin: 'player',
  coach: 'coach', 'trainer*in': 'coach', trainer: 'coach', trainerin: 'coach',
  guest: 'guest', gast: 'guest',
  team_responsible: 'team_responsible', 'teamverantwortliche*r': 'team_responsible',
  other: 'other', andere: 'other',
}
const ROLE_CD = {
  player: 'Spieler*in', coach: 'Trainer*in', guest: 'Guest',
  team_responsible: 'Teamverantwortliche*r', other: 'Andere',
}
/** Form value → slug, or null (a passive registration's licence list is not a role). */
export function normalizeRole(v) { return ROLE_IN[norm(v)] ?? null }
/** Slug → the German label ClubDesk and the old CSV carried. */
export function roleToClubdesk(v) { return ROLE_CD[normalizeRole(v)] ?? '' }

// ── officials_requested ('OTR 1, Schiedsrichter' → 'otr1,bb_referee') ──────
export const OFFICIAL_VALUES = ['vb_scorer', 'vb_referee', 'bb_referee', 'otr1', 'otr2', 'otn']
const OFFICIAL_CD = {
  vb_scorer: 'VB Schreiber', vb_referee: 'VB Schiedsrichter', bb_referee: 'BB Schiedsrichter',
  otr1: 'OTR 1', otr2: 'OTR 2', otn: 'OTN',
}

/** One token of the form's licence list → slug, or null when unknown. */
export function officialSlug(token, membershipType) {
  const t = norm(token).replace(/\s+/g, '')
  if (OFFICIAL_VALUES.includes(t)) return t
  switch (t) {
    case 'schreiber': case 'vbschreiber': return 'vb_scorer'
    case 'vbschiedsrichter': return 'vb_referee'
    case 'bbschiedsrichter': return 'bb_referee'
    case 'schiedsrichter': return membershipType === 'basketball' ? 'bb_referee' : 'vb_referee'
    case 'otr1': case 'bbotr1': return 'otr1'
    case 'otr2': case 'bbotr2': return 'otr2'
    case 'otn': case 'bbotn': return 'otn'
    default: return null
  }
}

/** Anything the form sends (German list, slug list, array) → 'otr1,bb_referee' or null. */
export function normalizeOfficials(v, membershipType) {
  const tokens = Array.isArray(v) ? v : String(v ?? '').split(',')
  const out = []
  for (const tok of tokens) {
    const s = officialSlug(tok, membershipType)
    if (s && !out.includes(s)) out.push(s)
  }
  return out.length ? out.join(',') : null
}

/** Slug list → array of slugs ('' / null → []). */
export function officialsList(v) {
  return String(v ?? '').split(',').map((s) => s.trim()).filter((s) => OFFICIAL_VALUES.includes(s))
}

/**
 * Slug list → the German text the old column held, for ClubDesk's
 * "Offiziellen Lizenz" cell and for the licence parser of the fee engine.
 * A single-sport registration drops the sport prefix the way the form did
 * ('Schreiber', 'OTR 1, Schiedsrichter'); a passive one keeps it.
 */
export function officialsToClubdesk(v, membershipType) {
  return officialsList(v).map((s) => {
    const label = OFFICIAL_CD[s]
    if (membershipType === 'volleyball' && s.startsWith('vb_')) return label.slice(3)
    if (membershipType === 'basketball' && s === 'bb_referee') return label.slice(3)
    return label
  }).join(', ')
}

// ── bb_situation / bb_recent_licence ────────────────────────────────────────
export const BB_SITUATION_VALUES = ['new', 'transfer_ch', 'transfer_intl', 'returning']
const SITUATION_IN = { new: 'new', neu: 'new', returning: 'returning', rueckkehr: 'returning', transfer_ch: 'transfer_ch', transfer_intl: 'transfer_intl' }
export function normalizeBbSituation(v) { return SITUATION_IN[norm(v)] ?? null }

/** true / false / null from a boolean, 'ja'/'nein', 'yes'/'no', 'true'/'false'. */
export function normalizeRecentLicence(v) {
  if (v === true || v === false) return v
  const s = norm(v)
  if (['ja', 'yes', 'true', '1'].includes(s)) return true
  if (['nein', 'no', 'false', '0'].includes(s)) return false
  return null
}
