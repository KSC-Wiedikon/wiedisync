// Typed contract for bb-docs.js, so the wiedisync frontend can IMPORT the
// basketball document rules instead of keeping a copy of them.
//
// Why this file exists. The rules were mirrored by hand in three places —
// registration.js + kscw-hooks (via the module), AnmeldungenPage.tsx, and
// kscw-website's registration-form.js — each carrying a "change both or neither"
// comment. Comments do not enforce anything: the admin page went eight weeks
// without bbFreibriefWaived() while the server had it, and blocked approvals the
// backend would have accepted (REG-2026-1054, 09.09.2026). The page now imports
// this module through the `@bb-docs` alias, so that particular drift is no
// longer possible.
//
// ⚠ kscw-website's registration-form.js is a SEPARATE REPO and still a hand-kept
// mirror — it is vanilla JS served to the public site with no bundler. It stays
// the one copy that must be changed alongside this file.
//
// Keep these signatures in step with bb-docs.js. They are only the shapes; the
// rules themselves have exactly one home, next door.

/** Registration columns that can hold a document. */
export type BbDocField =
  | 'id_upload_front'
  | 'id_upload_back'
  | 'bb_doc_lizenz'
  | 'bb_doc_freibrief'
  | 'bb_doc_selfdecl'
  | 'bb_doc_natdecl'
  | 'bb_doc_u18parents'
  | 'bb_doc_schoolcert'

/** Licensing situations the required-document rules recognise. */
export const BB_SITUATIONS: string[]

/** Accepts an ISO date string or a JS Date (raw knex returns `date` as Date). */
export function bbAgeAtSeasonStart(dob: string | Date | null | undefined): number | null

export function bbIsMinor(dob: string | Date | null | undefined): boolean

export function bbFreibriefWaived(
  dob: string | Date | null | undefined,
  recentLicence: string | null | undefined,
): boolean

/** `codes` is the comma list; `fallback` the legacy singular code. */
export function fibaNatCode(
  codes: string | null | undefined,
  fallback?: string | null | undefined,
): string

export function bbRequiredDocs(
  situation: string | null | undefined,
  natCode: string,
  dob: string | Date | null | undefined,
  recentLicence?: string | null | undefined,
): BbDocField[]

export function parseWaivedDocs(waived: string | null | undefined): BbDocField[]

export function bbRequiredDocsAfterWaiver(
  situation: string | null | undefined,
  natCode: string,
  dob: string | Date | null | undefined,
  recentLicence: string | null | undefined,
  waived: string | null | undefined,
): BbDocField[]
