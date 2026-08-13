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

import { KANTONSSCHULEN, KANTONSSCHULE_NONE } from '../../../utils/kantonsschulen'

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
 * The club register's membership statuses — ClubDesk's picklist, in ClubDesk's
 * order (the order the dropdown shows them in over there, so an admin reading
 * both screens sees one list).
 *
 * ⚠ Four copies of this set exist and must agree: here, the CHECK constraint
 * `members_register_status_values` and the Directus dropdown choices (both in
 * migration 302), and `MEMBER_REGISTER_STATUSES` in kscw-endpoints/src/
 * audience.js — which is deliberately the ACTIVE subset, not this whole list,
 * because a mailing to "all members" must not reach the departed.
 */
export const REGISTER_STATUS_VALUES = [
  'Kein Mitglied',
  'Aktivmitglied',
  'Passivmitglied',
  'Ehrenmitglied',
  'Ehemaliges Mitglied',
  'Verstorben',
  'Zwischenjahr',
] as const

export type RegisterStatus = (typeof REGISTER_STATUS_VALUES)[number]

/**
 * The statuses that mean "no longer one of ours". Setting one is what prefills
 * the exit date and ends club membership + app access; setting anything else
 * clears the exit date again.
 *
 * ⚠ Mirrors DEPARTED_STATUSES in kscw-endpoints/src/clubdesk-update.js (the
 * Data Health "departed in ClubDesk" check) and the CHECK constraint
 * `members_austritt_needs_departed_status` in migration 302. 'Zwischenjahr' is
 * NOT departed — a gap year is a member taking a season off, and the register
 * keeps billing them.
 */
export const DEPARTED_REGISTER_STATUSES: ReadonlySet<string> = new Set([
  'Kein Mitglied',
  'Ehemaliges Mitglied',
  'Verstorben',
])

/** True when `value` is a status that ends the membership. */
export function isDepartedRegisterStatus(value: unknown): boolean {
  return typeof value === 'string' && DEPARTED_REGISTER_STATUSES.has(value)
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
  /**
   * CHECK members_register_status_values (migration 302) — ClubDesk's own
   * picklist, verbatim.
   *
   * ⚠ The values are NOT translated and NOT re-spelled, and the labels equal
   * them on purpose. This column is pushed straight into the legal register's
   * Status cell, where "Ehrenmitglieder" or "Honorary member" is not a synonym
   * of 'Ehrenmitglied' but a brand-new picklist entry. Same rule, same reason,
   * as `beitragskategorie` above.
   *
   * NULL is a real state — "wiedisync has never been told", which is what every
   * member without a linked ClubDesk contact holds after migration 302's
   * backfill. It is not the same as 'Kein Mitglied' (a contact the register
   * positively records as a non-member) and must not be conflated with it.
   */
  register_status: {
    nullable: true,
    options: REGISTER_STATUS_VALUES.map((v) => ({ value: v, label: v })),
  },
  /**
   * The three club sections. A closed set in the data (prod 2026-08-13:
   * Volleyball 318, Basketball 314, KSCW 78, one empty — no off-list value has
   * ever existed) and a closed set in the code: `sportFromSektion()` is an exact
   * three-way switch that answers `null` for anything else, and that null feeds
   * permission scope and the Data Health "Unassigned" tab. A typo here does not
   * fail loudly, it quietly makes somebody sectionless — which is why this is a
   * dropdown and not the free-text box it used to be.
   *
   * ⚠ Values are ClubDesk's spellings verbatim and NOT translated: the Saturday
   * sync-down overwrites this column, so a re-spelling would be reverted weekly.
   * SelectEditor keeps an off-list value selected and selectable, so a future
   * ClubDesk section still renders and still saves.
   */
  sektion: {
    nullable: true,
    options: [
      { value: 'Volleyball', label: 'Volleyball' },
      { value: 'Basketball', label: 'Basketball' },
      { value: 'KSCW', label: 'KSCW (club-level)' },
    ],
  },
  /**
   * Zurich Kantonsschulen, mirroring the signup form's list (kscw-website
   * `weiteres/anmeldung.astro` — KS_OTHER, plus the Nein / KS Wiedikon /
   * Andere Kantonsschule head of the first select).
   *
   * ⚠ Suggestions, not a gate — and unlike every other entry in this file there
   * is deliberately NO CHECK constraint behind it (migration 315). The list
   * lives on a public website and grows whenever a school is added, renamed or
   * split; 'KS Rämibühl' is three entries here and one legacy row on prod.
   * SelectEditor keeps an off-list value selected and selectable, so a legacy
   * spelling stays editable instead of becoming an uneditable row.
   *
   * ⚠ 'Nein' is a real answer — "asked, and not at a Kantonsschule". Empty is
   * "never asked", which is most of the club.
   */
  kantonsschule: {
    nullable: true,
    options: [
      { value: KANTONSSCHULE_NONE, label: 'Nein — not at a Kantonsschule' },
      ...KANTONSSCHULEN.map((v) => ({ value: v, label: v })),
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
  // Empty since `sektion` became a select (2026-08-13). The kind and its editor
  // stay: the next free-text column with a canonical list belongs here, and the
  // choice between the two is "can an off-list value be legitimate FOREVER"
  // (suggest) or "is off-list a typo to be corrected" (select).
}

/** Label for a stored code, falling back to the raw value for off-list data. */
export function optionLabel(options: FieldOption[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value
}
