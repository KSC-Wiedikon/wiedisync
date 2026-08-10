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
  /**
   * The column is a nullable BOOLEAN, not a string. Option values are the
   * literals 'true' / 'false' and the editor converts on the way in and out —
   * a select is the only control that can express the third state (NULL =
   * "derive it"), which a switch cannot.
   */
  boolean?: true
  /** What the null option reads as. Defaults to "—" (i.e. "no value"). */
  noneLabel?: string
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
  /**
   * ⚠ Mirrors `CD_BEITRAG_MAP` in kscw-endpoints/src/clubdesk-update.js (the
   * amounts side). Only the primary ClubDesk spellings are listed — the legacy
   * aliases in that map still save fine, they are just not offered. Add a new
   * category to BOTH, or the explorer offers a category the fee engine cannot
   * price.
   */
  beitragskategorie: {
    nullable: true,
    options: [
      { value: 'VB Erwerbstätige', label: 'VB Erwerbstätige' },
      { value: 'VB Student*in Meisterschaft', label: 'VB Student*in Meisterschaft' },
      { value: 'VB Schüler*in Meisterschaft', label: 'VB Schüler*in Meisterschaft' },
      { value: 'VB Schüler*in Turnier', label: 'VB Schüler*in Turnier' },
      { value: 'VB Schüler*in 1. Jahr', label: 'VB Schüler*in 1. Jahr' },
      { value: 'VB Turnier KWI', label: 'VB Turnier KWI' },
      { value: 'BB Erwerbstätige', label: 'BB Erwerbstätige' },
      { value: 'BB Erwerbstätige 1. Liga', label: 'BB Erwerbstätige 1. Liga' },
      { value: 'BB Lernende/Studierende', label: 'BB Lernende/Studierende' },
      { value: 'BB Lernende/Studierende 1. Liga', label: 'BB Lernende/Studierende 1. Liga' },
      { value: 'BB Jugend Meisterschaft', label: 'BB Jugend Meisterschaft' },
      { value: 'BB Minis Turnier', label: 'BB Minis Turnier' },
      { value: 'Passivmitglied', label: 'Passivmitglied' },
      { value: 'Gratis', label: 'Gratis' },
      { value: 'Kein Beitrag', label: 'Kein Beitrag' },
    ],
  },
  /**
   * Nullable boolean (migration 300). Three states, and the third is the point:
   * empty follows the rule, so a member who earns a scorer licence in March
   * stops owing the surcharge without anybody editing this field.
   */
  fee_surcharge_override: {
    nullable: true,
    boolean: true,
    noneLabel: 'Automatic — follow the licence',
    options: [
      { value: 'true', label: 'Yes — charge the CHF 100' },
      { value: 'false', label: 'No — waive it' },
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
  /**
   * CHECK members_licence_status_values (migration 301). NOT NULL, DEFAULT
   * 'none' — "no licence" is a real answer, so there is no empty state to
   * offer and clearing it would 400.
   *
   * ⚠ Mirrors LICENCE_STATUSES in src/utils/licenceStatus.ts, the same list in
   * kscw-endpoints/src/licence-status.js, and the Directus dropdown choices in
   * migration 301. Four copies, one meaning — add a state to all four or to
   * none. "Licenced" is offered by hand only so an admin can CORRECT the sync
   * (a licence the register has not caught up with yet); the sweep is what
   * normally sets it.
   */
  licence_status: {
    nullable: false,
    options: [
      { value: 'none', label: 'No licence' },
      { value: 'to_be_ordered', label: 'To be ordered' },
      { value: 'ordered', label: 'Ordered' },
      { value: 'finalized', label: 'Finalized' },
      { value: 'licenced', label: 'Licenced' },
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
 * plus a <datalist>: suggestions, never a gate.
 *
 * `beitragskategorie` used to live here for that reason — a one-off ClubDesk
 * category like 'VB Schüler*in Meisterschaft mit Abzug' is legitimate, and a
 * gate would make such a row uneditable. It is a `select` now anyway: SelectEditor
 * keeps an off-list value selected and selectable (labelled "(unrecognised)"),
 * so the dropdown is a dropdown without ever silently overwriting one.
 */
export const MEMBER_SUGGEST_FIELDS: Record<string, string[]> = {
  sektion: ['Volleyball', 'Basketball', 'KSCW'],
}

/** Label for a stored code, falling back to the raw value for off-list data. */
export function optionLabel(options: FieldOption[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value
}
