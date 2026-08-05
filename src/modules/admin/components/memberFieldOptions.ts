// src/modules/admin/components/memberFieldOptions.ts
//
// Closed value sets for `members` columns, so the Data Explorer's inline editor
// offers the same controls the member sees in Options → Profile instead of a
// free-text box. Until 2026-08-05 every one of these rendered as `text` —
// `detectKind()` in ExplorerMemberFields.tsx only looked at the *value*, and a
// varchar holding 'hidden' is indistinguishable from a name. A typo there wrote
// a value nothing in the app understands (birthdate_visibility: 'Hidden' would
// silently stop matching the 'full'/'year_only'/'hidden' switch).
//
// Its own module rather than an export from ExplorerMemberFields.tsx: a
// component file that also exports constants breaks React Fast Refresh
// (react-refresh/only-export-components, an ESLint *error* here).
//
// Labels are English-only on purpose — this whole explorer surface is (group
// headers, "Yes"/"No", the field labels next door). Sentence case per CLAUDE.md.

export interface FieldOption {
  value: string
  label: string
}

export interface MemberSelectField {
  options: FieldOption[]
  /** false ⇒ NOT NULL in Postgres, so the editor must not offer "—". */
  nullable: boolean
}

/**
 * Single-value closed sets. Mirrors the pickers in ProfileEditForm.tsx
 * (birthdate_visibility, sex, anrede) and the Directus field choices for the
 * columns the member never edits themselves.
 */
export const MEMBER_SELECT_FIELDS: Record<string, MemberSelectField> = {
  birthdate_visibility: {
    nullable: true,
    options: [
      { value: 'full', label: 'Full date' },
      { value: 'year_only', label: 'Year only' },
      { value: 'hidden', label: 'Hidden' },
    ],
  },
  sex: {
    nullable: true,
    options: [
      { value: 'm', label: 'Male' },
      { value: 'f', label: 'Female' },
    ],
  },
  anrede: {
    nullable: true,
    options: [
      { value: 'Herr', label: 'Herr' },
      { value: 'Frau', label: 'Frau' },
    ],
  },
  language: {
    nullable: true,
    options: [
      { value: 'german', label: 'German' },
      { value: 'swiss_german', label: 'Swiss German' },
      { value: 'english', label: 'English' },
      { value: 'french', label: 'French' },
      { value: 'italian', label: 'Italian' },
    ],
  },
  // NOT NULL, DEFAULT 'pending' — clearing it would 400.
  consent_decision: {
    nullable: false,
    options: [
      { value: 'pending', label: 'Pending' },
      { value: 'accepted', label: 'Accepted' },
      { value: 'declined', label: 'Declined' },
    ],
  },
  // CHECK members_transfer_status_chk: NULL | 'pending' | 'done'.
  transfer_status: {
    nullable: true,
    options: [
      { value: 'pending', label: 'Pending' },
      { value: 'done', label: 'Done' },
    ],
  },
}

/**
 * Multi-value (jsonb array) closed sets. `position` is NOT here — it comes from
 * memberPositions.ts so the explorer and the profile picker cannot drift.
 *
 * The role list is the CHECK constraint `members_role_values_valid`, which is
 * wider than the Directus field choices (those still omit `website_admin`,
 * held by a live member) — the constraint is the real gate.
 */
export const MEMBER_MULTI_FIELDS: Record<string, FieldOption[]> = {
  role: [
    { value: 'user', label: 'User' },
    { value: 'vorstand', label: 'Board' },
    { value: 'finance', label: 'Finance' },
    { value: 'vb_admin', label: 'VB admin' },
    { value: 'bb_admin', label: 'BB admin' },
    { value: 'website_admin', label: 'Website admin' },
    { value: 'admin', label: 'Admin' },
    { value: 'superuser', label: 'Superuser' },
  ],
}

/**
 * Free-text columns with a de-facto canonical list. Rendered as a text input
 * plus a <datalist>: suggestions, never a gate — both columns legitimately hold
 * off-list values (e.g. 'VB Schüler*in Meisterschaft mit Abzug', a one-off
 * ClubDesk category), and gating them would make those rows uneditable.
 *
 * ⚠ The fee categories mirror `CD_BEITRAG_MAP` in
 * kscw-endpoints/src/clubdesk-update.js (the amounts side). Only the primary
 * ClubDesk spellings are listed — the legacy aliases in that map still save
 * fine, they are just not suggested. Add a new category to BOTH.
 */
export const MEMBER_SUGGEST_FIELDS: Record<string, string[]> = {
  sektion: ['Volleyball', 'Basketball', 'KSCW'],
  beitragskategorie: [
    'VB Erwerbstätige',
    'VB Student*in Meisterschaft',
    'VB Schüler*in Meisterschaft',
    'VB Schüler*in Turnier',
    'VB Schüler*in 1. Jahr',
    'VB Turnier KWI',
    'BB Erwerbstätige',
    'BB Erwerbstätige 1. Liga',
    'BB Lernende/Studierende',
    'BB Lernende/Studierende 1. Liga',
    'BB Jugend Meisterschaft',
    'BB Minis Turnier',
    'Passivmitglied',
    'Gratis',
    'Kein Beitrag',
  ],
}

/** Label for a stored code, falling back to the raw value for off-list data. */
export function optionLabel(options: FieldOption[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value
}
