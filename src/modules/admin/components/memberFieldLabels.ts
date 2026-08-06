// src/modules/admin/components/memberFieldLabels.ts
//
// Display names for `members` columns, shared by every admin surface that
// prints a column name at a human — the Data Explorer's field list and the
// ClubDesk sync-up modal's change chips (which showed the raw
// "federation_of_origin" until 2026-07-26).
//
// DERIVED from memberFieldSchema.ts rather than hand-maintained: the map used
// to be a second, independent list, so a label fixed in one place silently
// disagreed with the other and six of its keys had outlived their columns
// (licence_activation_date, licence_validation_date, status, sort,
// user_created, user_updated — none of them exist on `members` any more).
// Add a column to the schema and its label appears here for free.
//
// Its own module rather than an export from ExplorerMemberFields.tsx: a
// component file that also exports constants breaks React Fast Refresh
// (react-refresh/only-export-components, an ESLint *error* here).

import { MEMBER_FIELDS } from './memberFieldSchema'

/**
 * Non-column keys that still need a label. `gast` is not a `members` column at
 * all — it is a ClubDesk drift field derived from the roster (guest on some
 * team, core on none), and the sync-up modal's change chips render whatever
 * field name the drift flag wrote. Its only consumer is ClubdeskSyncUpModal.
 */
const EXTRA_LABELS: Record<string, string> = {
  gast: 'Guest (ClubDesk)',
}

/**
 * Human-readable labels for the `members` collection. Anything not in this map
 * falls back to the caller's own humanize(key) (snake_case → "Sentence case").
 * Sentence case only (per CLAUDE.md capitalisation rule).
 */
export const MEMBER_FIELD_LABELS: Record<string, string> = {
  // Virtual schema keys (`__teams`) are excluded — this map is column → label,
  // and nothing that consumes it can be handed a virtual field name.
  ...Object.fromEntries(MEMBER_FIELDS.filter((f) => !f.virtual).map((f) => [f.key, f.label])),
  ...EXTRA_LABELS,
}
