// src/modules/admin/components/memberFieldSchema.ts
//
// The single source of truth for how a `members` row is laid out in the Data
// Explorer: which group a column belongs to, what it is called, which control
// edits it, whether it is read-only and WHY, and which sport it belongs to.
//
// It replaces `detectKind()`, which guessed the control from the *value* at
// render time and therefore got a NULL boolean wrong (text box), a NULL jsonb
// wrong (text box that then wrote a string into a jsonb column), and a long
// secret wrong (a 120-char-triggered textarea that printed the member's
// private key into the DOM). A column's type is a property of the column, not
// of the row you happen to be looking at.
//
// Two invariants this file exists to hold:
//   • Every one of the 104 `members` columns is claimed by exactly one group.
//     There is no "Other" bucket — an unclaimed column is a bug, and
//     __tests__/memberFieldSchema.test.ts fails the build over it.
//   • Every read-only field says where its value comes from (`provenance`).
//     "Why can't I edit this and who wrote it" is answered in the product, on
//     the tooltip of the Read-only badge, not in a wiki nobody opens.
//
// Its own .ts module rather than an export from a .tsx: a component file that
// also exports constants breaks React Fast Refresh
// (react-refresh/only-export-components, an ESLint *error* here).
//
// Column list verified against prod `information_schema` on 2026-08-06 (100
// columns), + migration 299's four fee overrides (104). When a migration adds
// one, add it here in the same commit — the
// fallback in getFieldDef() keeps the page alive but flags the column as
// unmapped and refuses to let anybody edit it.

import type { MemberSport } from './memberSport'
import { sportCovers } from './memberSport'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** The closed set of editors. A def's `kind` must be one of these 23. */
export type MemberFieldKind =
  | 'text' | 'longtext' | 'number' | 'bool' | 'date' | 'datetime' | 'json'
  | 'select' | 'multiselect' | 'suggest'
  | 'email' | 'phone' | 'ahv' | 'iban' | 'postalcode' | 'photo'
  | 'team' | 'teamMulti' | 'countryMulti' | 'country'
  | 'positions' | 'trainerLicences' | 'readonlyMasked'

/** null = always shown. Otherwise the sport whose members see it. */
export type SportGate = 'volleyball' | 'basketball' | null

export type MemberFieldGroupId =
  | 'identity' | 'contact' | 'membership' | 'playing' | 'association'
  | 'roles_access' | 'finance' | 'privacy' | 'notifications'
  | 'clubdesk' | 'transfer' | 'system'

export type MemberFieldSubsectionId = 'assoc_common' | 'assoc_vb' | 'assoc_bb'

export interface MemberFieldDef {
  /** `members` column name, or a `__`-prefixed virtual key. */
  key: string
  group: MemberFieldGroupId
  /** Only set for `group: 'association'`. */
  subsection?: MemberFieldSubsectionId
  /** 1-based position inside the group (or subsection). Unique per group+subsection. */
  order: number
  /** English, sentence case. NOT translated — see the header of memberFieldOptions.ts. */
  label: string
  /** One short English line under the control. Omit rather than pad. */
  help?: string
  kind: MemberFieldKind
  /** Hard read-only: rendered as a display value even in edit mode, never in dirtyKeys. */
  readOnly: boolean
  /** Read-only ONLY for non-global-admins (the server strips the key for anybody else). */
  privileged?: true
  /** Shown as the tooltip on the "Read-only" badge. REQUIRED when readOnly or privileged. */
  provenance?: string
  /** Editable, but a sync overwrites it. Rendered as an amber "Overwritten by sync" chip. */
  overwrittenBy?: string
  /**
   * Machine-owned plumbing: audit stamps, sync bookkeeping, key material, and
   * values derived from a field shown elsewhere. Hidden behind the "Show
   * technical fields" toggle so the default view is the ~25 fields an admin
   * actually reasons about instead of all 100.
   *
   * The bar is "does an admin ever ACT on this": `clubdesk_id` stays visible
   * (you look it up), `clubdesk_pushed_at` does not (the sync writes it). Every
   * technical field is also `readOnly` — see the test that pins that, which is
   * what makes hiding them safe for the edit flow.
   */
  technical?: true
  sportGate: SportGate
  /** Value is never rendered and never PATCHed. Implies kind 'readonlyMasked'. */
  sensitive: boolean
  /** Editing surface is the danger zone, not the field grid. Implies readOnly. */
  dangerZone?: true
  /** Not a `members` column — excluded from the PATCH payload entirely. */
  virtual?: true
  /** Card spans 2 grid columns. Derived from `kind` — see WIDE_KINDS. */
  wide?: true
}

export interface MemberFieldSubsection {
  id: MemberFieldSubsectionId
  /** English, sentence case. Empty string = render the fields with no sub-header. */
  label: string
  sportGate: SportGate
}

export interface MemberFieldGroup {
  id: MemberFieldGroupId
  /** English, sentence case. */
  label: string
  /** One English line under the header. */
  description: string
  order: number
  subsections?: MemberFieldSubsection[]
}

/** Virtual key for the player-roster multiselect. Never sent in a PATCH. */
export const TEAMS_VIRTUAL_KEY = '__teams'

/**
 * Virtual key for the itemised Beitrag card. Never sent in a PATCH — the amount
 * is computed by the server's fee engine (`GET /kscw/finance/members/:id/fee`)
 * from the category, the season rate schedule, the licence flags and the four
 * override columns below. There is no `members` column holding a total, and
 * there must not be: it would be a cached copy of an answer four other columns
 * already give, wrong the moment any of them changes.
 */
export const FEE_AMOUNT_VIRTUAL_KEY = '__fee_amount'

// ─────────────────────────────────────────────────────────────────────────────
// Groups
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "Association admin" is ONE group with three subsections, not two sibling
 * groups: the sport-neutral pair (federation of origin, J+S — BASPO is federal
 * and applies to basketball too) sits above the two governing-body blocks, and
 * the group header carries the reveal toggle for whichever block is hidden.
 */
export const MEMBER_FIELD_GROUPS: readonly MemberFieldGroup[] = [
  { id: 'identity', order: 1, label: 'Identity', description: 'Who this person is.' },
  { id: 'contact', order: 2, label: 'Contact', description: 'How to reach them, and what other members may see.' },
  { id: 'membership', order: 3, label: 'Membership', description: 'Club membership, app access and team assignment.' },
  { id: 'playing', order: 4, label: 'Playing & coaching', description: 'On-court role and coaching qualification.' },
  {
    id: 'association',
    order: 5,
    label: 'Association admin',
    description: 'Licences and identifiers held with the sport governing bodies.',
    subsections: [
      { id: 'assoc_common', label: '', sportGate: null },
      { id: 'assoc_vb', label: 'Swiss Volley', sportGate: 'volleyball' },
      { id: 'assoc_bb', label: 'Basketplan', sportGate: 'basketball' },
    ],
  },
  { id: 'roles_access', order: 6, label: 'Roles & access', description: 'What this person may do in the app.' },
  { id: 'finance', order: 7, label: 'Finance & billing', description: 'Payment details and billing address.' },
  { id: 'privacy', order: 8, label: 'Privacy & consent', description: 'What the member agreed to and what is published.' },
  { id: 'notifications', order: 9, label: 'Notifications & communications', description: 'Email, chat and auto-confirm preferences.' },
  { id: 'clubdesk', order: 10, label: 'ClubDesk sync', description: "The link to the club's legal member register." },
  { id: 'transfer', order: 11, label: 'International transfer', description: 'Staff record of an incoming transfer.' },
  { id: 'system', order: 12, label: 'System & audit', description: 'Machine-owned. Nothing here is edited by hand.' },
]

// ─────────────────────────────────────────────────────────────────────────────
// Field definitions
// ─────────────────────────────────────────────────────────────────────────────

/** Kinds whose card spans two grid columns — they need the horizontal room. */
const WIDE_KINDS: ReadonlySet<MemberFieldKind> = new Set<MemberFieldKind>([
  'json', 'longtext', 'multiselect', 'positions', 'trainerLicences',
  'countryMulti', 'teamMulti', 'photo',
])

/**
 * One field, minus everything the builder derives: `group` and `subsection`
 * come from the block it is declared in, `order` from its position in that
 * block (so the orders can never collide or skip), `sportGate` from the
 * subsection, and `wide` from the kind.
 */
type FieldSeed =
  Omit<MemberFieldDef, 'group' | 'subsection' | 'order' | 'sportGate' | 'readOnly' | 'sensitive' | 'wide'>
  & { readOnly?: boolean; sensitive?: boolean }

const SUBSECTION_GATE: Record<MemberFieldSubsectionId, SportGate> = {
  assoc_common: null,
  assoc_vb: 'volleyball',
  assoc_bb: 'basketball',
}

function block(
  group: MemberFieldGroupId,
  subsection: MemberFieldSubsectionId | undefined,
  seeds: readonly FieldSeed[],
  /** Merged UNDER every seed, so a field can still override it. */
  defaults: Partial<FieldSeed> = {},
): MemberFieldDef[] {
  return seeds.map((seed, i) => {
    const def: MemberFieldDef = {
      ...defaults,
      ...seed,
      group,
      order: i + 1,
      sportGate: subsection ? SUBSECTION_GATE[subsection] : null,
      readOnly: seed.readOnly ?? false,
      sensitive: seed.sensitive ?? false,
    }
    if (subsection) def.subsection = subsection
    if (WIDE_KINDS.has(def.kind)) def.wide = true
    return def
  })
}

// Reused provenance strings — one wording, one place to fix it.
const P_VM_MIRROR =
  'Mirrored from Swiss Volley VM every Monday 04:00 UTC — a hand edit is overwritten within a week.'
const P_DANGER_ZONE = 'Managed in the danger zone below.'
const P_DIRECTUS_STAMP =
  'Stamped by Directus on every write. Any value written here is overwritten in the same request.'
const O_CLUBDESK_WINS =
  'ClubDesk wins: the Saturday 22:00 sync-down overwrites this. Change it in ClubDesk to make it stick.'
const O_CLUBDESK_OFFICIALS =
  'Set to Yes (never back to No) by the ClubDesk officials-licence sync.'
const O_LICENCE_FLAG =
  'Set to Yes (never back to No) by the ClubDesk sync and the VM sync. Turning it off here comes back if ClubDesk still carries the group.'
const P_GLOBAL_ADMIN_ONLY =
  "Only a global admin can change this. A sport admin's write is silently discarded by the server, so the field is locked rather than pretending to save."

// ── 1.a Identity (11) ───────────────────────────────────────────────────────
const IDENTITY = block('identity', undefined, [
  { key: 'first_name', label: 'First name', kind: 'text' },
  { key: 'last_name', label: 'Last name', kind: 'text' },
  {
    key: 'nickname', label: 'Nickname', kind: 'text',
    help: 'Shown instead of the first name where the app has room for one.',
  },
  {
    key: 'anrede', label: 'Salutation', kind: 'select',
    help: 'Used by ClubDesk letters and the dues mailing.',
  },
  { key: 'photo', label: 'Profile photo', kind: 'photo' },
  {
    key: 'sex', label: 'Sex', kind: 'select',
    help: "Drives the team picker (women's / men's teams).",
    overwrittenBy: 'Swiss Volley VM overwrites this every Monday 04:00 for licensed volleyball players.',
  },
  { key: 'birthdate', label: 'Birthdate', kind: 'date' },
  {
    key: 'birthdate_visibility', label: 'Birthdate visibility', kind: 'select',
    help: "Who sees the birthdate on the member's profile.",
  },
  {
    key: 'nationalitaet_codes', label: 'Nationality', kind: 'countryMulti',
    help: 'Several are allowed. The first one is the primary and is what gets pushed to ClubDesk.',
  },
  {
    key: 'nationalitaet', label: 'Nationality (ClubDesk spelling, derived)', kind: 'country',
    readOnly: true, technical: true,
    provenance:
      'Derived by the Postgres trigger members_sync_nationality_trg (migration 223) from the first entry of nationalitaet_codes. Edit the nationality field above instead — writing here silently rewrites the codes.',
  },
  {
    key: 'language', label: 'Preferred language', kind: 'select',
    help: 'The language emails and push notifications are sent in.',
  },
])

// ── 1.b Contact (7) ─────────────────────────────────────────────────────────
// hide_email / hide_phone sit directly under the field they hide rather than
// in Privacy: they are that field's own setting, and an admin looking at a
// phone number needs to see "and it is hidden from other members" right there.
const CONTACT = block('contact', undefined, [
  {
    key: 'email', label: 'Email address', kind: 'email',
    help: 'Also the login. Cannot be blanked — the database rejects it.',
  },
  { key: 'hide_email', label: 'Hide email from other members', kind: 'bool' },
  {
    key: 'phone', label: 'Phone number', kind: 'phone',
    help: 'Formatted to +41 79 123 45 67 when you leave the field.',
  },
  { key: 'hide_phone', label: 'Hide phone from other members', kind: 'bool' },
  {
    key: 'adresse', label: 'Street address', kind: 'text',
    help: 'Street and house number on one line — ClubDesk stores it as a single line.',
  },
  { key: 'plz', label: 'Postal code', kind: 'postalcode' },
  { key: 'ort', label: 'City', kind: 'text' },
])

// ── 1.c Membership (8 columns + 1 virtual) ──────────────────────────────────
// `beitragskategorie` lives in Finance & billing, not here: it is the input the
// fee amount is computed from, and reading a category without the CHF it
// produces is what made "why is this member billed 310?" a two-page question.
const MEMBERSHIP = block('membership', undefined, [
  {
    key: 'sektion', label: 'Section', kind: 'suggest',
    help: 'Volleyball, Basketball or KSCW (club-level). Decides which association fields are shown below.',
    overwrittenBy: O_CLUBDESK_WINS,
  },
  {
    // Virtual: writes member_teams junction rows, never a `members` column.
    // Coach / team-responsible / captain links stay in the read-only relations
    // table below — one chip field cannot express three relation types without
    // a role picker per chip.
    key: TEAMS_VIRTUAL_KEY, label: 'Teams (player)', kind: 'teamMulti', virtual: true,
    help: 'Roster memberships only. Coach and team-responsible links are shown in the relations table below and are edited there.',
  },
  {
    key: 'requested_team', label: 'Requested team', kind: 'team',
    help: 'One team only — the column holds a single team, not a list. Set when the member asks to join and cleared once a coach approves.',
  },
  {
    key: 'coach_approved_team', label: 'Coach approved the team request', kind: 'bool',
    help: 'The database refuses Yes unless the member already has a roster row.',
  },
  {
    key: 'kscw_membership_active', label: 'Club membership active', kind: 'bool',
    readOnly: true, dangerZone: true, provenance: P_DANGER_ZONE,
  },
  {
    key: 'wiedisync_active', label: 'App access active', kind: 'bool',
    readOnly: true, dangerZone: true, provenance: P_DANGER_ZONE,
  },
  {
    key: 'shell', label: 'Shell account', kind: 'bool',
    help: 'A placeholder record for somebody who has not claimed a login yet.',
    readOnly: true, dangerZone: true,
    provenance:
      `Flipped to No automatically by the trigger trg_members_shell_convert the first time the member activates their login. ${P_DANGER_ZONE}`,
  },
  {
    key: 'shell_expires', label: 'Shell account expires', kind: 'datetime',
    readOnly: true, dangerZone: true, technical: true, provenance: P_DANGER_ZONE,
  },
  {
    key: 'shell_reminder_sent', label: 'Shell reminder sent', kind: 'bool',
    readOnly: true, technical: true,
    provenance:
      'Set by the daily 09:00 UTC shell-invite reminder sweep (kscw-hooks); reset to No whenever a new invite is issued. Setting it back by hand emails a real person the next morning.',
  },
])

// ── 1.d Playing & coaching (3) ──────────────────────────────────────────────
const PLAYING = block('playing', undefined, [
  { key: 'number', label: 'Jersey number', kind: 'number' },
  {
    key: 'position', label: 'Positions', kind: 'positions',
    help: "Only the positions of this member's sport are offered.",
  },
  {
    key: 'trainer_licences', label: 'Coaching qualification', kind: 'trainerLicences',
    help: 'J+S is federal; C/B/A is Swiss Volley; T1/T2/T3 is Swiss Basketball. The two ladders do not map onto each other.',
  },
])

// ── 1.e Association admin (2 + 10 + 6) ──────────────────────────────────────
const ASSOC_COMMON = block('association', 'assoc_common', [
  {
    key: 'federation_of_origin', label: 'Federation of origin', kind: 'country',
    help: 'The federation that first licensed this member — not the most recent one. "None" is an explicit answer, different from empty.',
  },
  {
    // ⚠ NOT a volleyball field. Basketball licences live in this same column —
    // the Basketplan people scrape writes it — so filing it under "Swiss Volley"
    // hid 272 basketball members' own licence number behind a "Show volleyball
    // fields" toggle.
    key: 'license_nr', label: 'Licence number', kind: 'text',
    help: 'Leading zeros are part of the number. Swiss Volley and Swiss Basketball licences share this column.',
    readOnly: true,
    provenance:
      'Filled once by the Swiss Volley VM sync (Mondays 04:00 UTC) or the Basketplan people scrape, only when empty. It is the join key for every licence lookup — a wrong value breaks them all permanently.',
  },
  {
    key: 'js_id', label: 'J+S / SALTO number', kind: 'text',
    help: 'Federal BASPO identifier, used by the J+S course exports. Applies to both sports.',
    overwrittenBy:
      'Filled from ClubDesk when empty (Saturday 22:00). A value set here is never overwritten, so a typo files attendance under another person.',
  },
])

const ASSOC_VB = block('association', 'assoc_vb', [
  { key: 'licence_category', label: 'Licence category', kind: 'text', readOnly: true, provenance: P_VM_MIRROR },
  { key: 'licence_activated', label: 'Licence activated', kind: 'bool', readOnly: true, provenance: P_VM_MIRROR },
  { key: 'licence_validated', label: 'Licence validated', kind: 'bool', readOnly: true, provenance: P_VM_MIRROR },
  {
    key: 'vm_email', label: 'Swiss Volley VM email', kind: 'email',
    help: 'The address Swiss Volley has on file, which may differ from the club one.',
    readOnly: true, provenance: P_VM_MIRROR,
  },
  { key: 'scorer_vb', label: 'Scorer licence', kind: 'bool', overwrittenBy: O_LICENCE_FLAG },
  { key: 'referee_vb', label: 'Referee licence', kind: 'bool', overwrittenBy: O_LICENCE_FLAG },
  {
    // Read-only on purpose: a hand-set Yes reads as "cleared to play" when
    // nothing was actually verified.
    key: 'in_vis', label: 'Found in FIVB VIS', kind: 'bool',
    help: 'No is a lead to check, not a verdict — VIS misses plenty of players.',
    readOnly: true,
    provenance: 'Written by the FIVB VIS player check (Mondays 05:15 UTC, or on demand from /admin/transfers).',
  },
  {
    key: 'vis_player_no', label: 'FIVB VIS player number', kind: 'number',
    overwrittenBy: 'Refreshed weekly from FIVB VIS (Mondays 05:15 UTC) — a hand edit is replaced at the next run.',
  },
  {
    key: 'in_vis_checked_at', label: 'VIS last checked', kind: 'datetime',
    readOnly: true, technical: true,
    provenance: 'Stamped by the FIVB VIS player check (Mondays 05:15 UTC).',
  },
])

const ASSOC_BB = block('association', 'assoc_bb', [
  { key: 'referee_bb', label: 'Referee licence', kind: 'bool', overwrittenBy: O_CLUBDESK_OFFICIALS },
  { key: 'otr1_bb', label: 'OTR 1 (table official)', kind: 'bool', overwrittenBy: O_CLUBDESK_OFFICIALS },
  { key: 'otr2_bb', label: 'OTR 2 (table official)', kind: 'bool', overwrittenBy: O_CLUBDESK_OFFICIALS },
  { key: 'otn1_bb', label: 'OTN 1 (table official)', kind: 'bool', overwrittenBy: O_CLUBDESK_OFFICIALS },
  { key: 'otn2_bb', label: 'OTN 2 (table official)', kind: 'bool', overwrittenBy: O_CLUBDESK_OFFICIALS },
  {
    key: 'otn_bb', label: 'OTN, any level (legacy)', kind: 'bool',
    help: 'Predates the levels above. Keep it as the coarse "holds some OTN" flag — it is not a third level.',
    overwrittenBy: O_CLUBDESK_OFFICIALS,
  },
])

// ── 1.f Roles & access (3) ──────────────────────────────────────────────────
const ROLES_ACCESS = block('roles_access', undefined, [
  {
    key: 'role', label: 'Roles', kind: 'multiselect',
    help: "Grants app permissions. Only a global admin can change this — a sport admin's change is silently discarded by the server.",
    privileged: true, provenance: P_GLOBAL_ADMIN_ONLY,
  },
  {
    key: 'is_spielplaner', label: 'Spielplaner', kind: 'bool',
    help: 'Club-wide game-scheduling rights. Only a global admin can change this.',
    privileged: true, provenance: P_GLOBAL_ADMIN_ONLY,
  },
  {
    key: 'user', label: 'Login account (Directus user)', kind: 'text',
    readOnly: true,
    provenance:
      "Created by the signup / invite-claim hook when the member first activates a login. Repointing it would hand one person's login to another member's record.",
  },
])

// ── 1.g Finance & billing (17 columns + 1 virtual) ──────────────────────────
// Reading order is the fee itself: what category the member is in → what that
// costs → the three per-person exceptions → where the money moves.
const FINANCE = block('finance', undefined, [
  {
    key: 'beitragskategorie', label: 'Membership fee category', kind: 'suggest',
    help: 'Drives the amount billed at the next ClubDesk push.',
    overwrittenBy: O_CLUBDESK_WINS,
  },
  {
    // Virtual: computed by the fee engine, never a column. See
    // FEE_AMOUNT_VIRTUAL_KEY.
    key: FEE_AMOUNT_VIRTUAL_KEY, label: 'Beitrag amount', kind: 'number',
    virtual: true, readOnly: true,
    help: 'Base + scorer-licence surcharge − discounts, as the dues run and the ClubDesk push compute it.',
    provenance:
      'Computed by feeBreakdown() on the server (GET /kscw/finance/members/:id/fee) from the fee category, this season’s rate schedule, the licence flags, the guest roster and the three override fields below (empty ones appear in edit mode). Nothing stores a total — edit the parts, not the sum.',
  },
  {
    key: 'fee_base_override', label: 'Fee base override (CHF)', kind: 'number',
    help: 'Empty = the season rate for the category (or the codified map where no rate is set). Fill it only for a genuine per-person exception.',
  },
  {
    key: 'fee_surcharge_override', label: 'Scorer-licence surcharge (CHF)', kind: 'number',
    help: 'Empty = the rule: CHF 100 when the member owes table duty (U16+) and holds no licence, otherwise 0. Enter 0 to waive it.',
  },
  {
    key: 'fee_discount', label: 'Discount (CHF)', kind: 'number',
    help: 'Standing reduction off this member’s dues. Capped at what is owed — it can reach 0, never below.',
  },
  {
    key: 'fee_discount_reason', label: 'Discount reason', kind: 'text',
    help: 'Printed as the credit line on the invoice. Empty = "Rabatt".',
  },
  {
    key: 'iban', label: 'IBAN', kind: 'iban',
    help: 'Checked against the IBAN checksum when you leave the field.',
  },
  { key: 'iban_confirmed', label: 'IBAN confirmed', kind: 'bool' },
  {
    key: 'ahv_nummer', label: 'AHV number', kind: 'ahv',
    help: 'Formatted to 756.1234.5678.97; the check digit is verified.',
  },
  {
    key: 'never_dun', label: 'Never send reminders', kind: 'bool',
    help: 'Excludes this member from dunning runs.',
  },
  {
    key: 'billing_different', label: 'Separate billing address', kind: 'bool',
    help: 'Turn on when invoices go to somebody else (a parent, an employer).',
  },
  { key: 'billing_name', label: 'Billing name', kind: 'text' },
  { key: 'billing_email', label: 'Billing email', kind: 'email' },
  { key: 'billing_address', label: 'Billing street address', kind: 'text' },
  { key: 'billing_plz', label: 'Billing postal code', kind: 'postalcode' },
  { key: 'billing_ort', label: 'Billing city', kind: 'text' },
  { key: 'billing_phone', label: 'Billing phone', kind: 'phone' },
  { key: 'billing_iban', label: 'Billing IBAN', kind: 'iban' },
])

// ── 1.h Privacy & consent (6) ───────────────────────────────────────────────
const PRIVACY = block('privacy', undefined, [
  {
    key: 'consent_decision', label: 'Data-protection consent', kind: 'select',
    help: 'Cannot be emptied — the column is mandatory.',
  },
  {
    key: 'consent_prompted_at', label: 'Consent last asked', kind: 'datetime',
    readOnly: true, technical: true,
    provenance: 'Stamped by the app each time the consent prompt is shown or postponed.',
  },
  { key: 'website_visible', label: 'Visible on the public website', kind: 'bool' },
  {
    key: 'website_name_private', label: 'Hide the name on the website', kind: 'bool',
    help: 'Shown on the website as an initial instead of the full name.',
  },
  { key: 'push_preview_content', label: 'Show message text in push notifications', kind: 'bool' },
  {
    key: 'profile_verified_at', label: 'Profile confirmed by the member', kind: 'datetime',
    readOnly: true,
    provenance:
      'Stamped by the member themselves in the annual profile check. It records that they looked and said yes — stamping it for them fabricates that confirmation and switches off their login gate.',
  },
])

// ── 1.i Notifications & communications (11) ─────────────────────────────────
const NOTIFICATIONS = block('notifications', undefined, [
  { key: 'communications_team_chat_enabled', label: 'Team chat enabled', kind: 'bool' },
  { key: 'communications_dm_enabled', label: 'Direct messages enabled', kind: 'bool' },
  { key: 'communications_banned', label: 'Banned from all messaging', kind: 'bool' },
  {
    key: 'auto_confirm_trainings', label: 'Auto-confirm trainings', kind: 'bool',
    help: 'Counts the member as attending unless they say otherwise.',
  },
  { key: 'auto_confirm_games', label: 'Auto-confirm games', kind: 'bool' },
  { key: 'auto_confirm_events', label: 'Auto-confirm events', kind: 'bool' },
  { key: 'email_notify_events', label: 'Email about events', kind: 'bool' },
  { key: 'email_notify_announcements', label: 'Email about announcements', kind: 'bool' },
  {
    key: 'email_notify_registrations', label: 'Email about new registrations', kind: 'bool',
    help: 'Staff notification, not a member one.',
  },
  {
    key: 'email_notify_join_requests', label: 'Email about team join requests', kind: 'bool',
    help: 'Staff notification, not a member one.',
  },
  {
    key: 'email_notify_form_submissions', label: 'Email about form submissions', kind: 'bool',
    help: 'Staff notification, not a member one.',
  },
])

// ── 1.j ClubDesk sync (5) ───────────────────────────────────────────────────
const CLUBDESK = block('clubdesk', undefined, [
  {
    key: 'clubdesk_id', label: 'ClubDesk contact ID', kind: 'text',
    readOnly: true,
    provenance:
      'Matched once by the ClubDesk sync-down (Saturdays 22:00 UTC). It is the record identity of the CSV import — an unknown ID aborts the whole club import, not just this row.',
  },
  {
    key: 'clubdesk_sync_exclude', label: 'Exclude from ClubDesk sync', kind: 'bool',
    help: 'Stops this member being pushed to or read from the register.',
  },
  {
    key: 'clubdesk_push_pending', label: 'Changes waiting to be pushed', kind: 'bool',
    readOnly: true, technical: true,
    provenance:
      'Set by the app whenever a pushable field changes, and cleared by the sync-up. Clearing it by hand drops a real pending change on the floor.',
  },
  {
    key: 'clubdesk_push_changes', label: 'Pending change set', kind: 'json',
    readOnly: true, technical: true,
    provenance:
      "Written by the app alongside the pending flag. This is the payload that gets written into the club's legal member register — hand-editing it writes arbitrary values there.",
  },
  {
    key: 'clubdesk_pushed_at', label: 'Last pushed to ClubDesk', kind: 'datetime',
    readOnly: true, technical: true,
    provenance:
      'Stamped by the sync-up dispatcher. It doubles as "created, awaiting link-back" — clearing it creates a duplicate contact in the register.',
  },
])

// ── 1.k International transfer (4) ──────────────────────────────────────────
const TRANSFER = block('transfer', undefined, [
  {
    key: 'transfer_status', label: 'Transfer status', kind: 'select',
    help: 'Set it to "Done" on /admin/transfers, not here — that page also records who did it and when.',
  },
  {
    key: 'transfer_done_at', label: 'Transfer completed at', kind: 'datetime',
    readOnly: true, technical: true,
    provenance: "Stamped by /admin/transfers together with the status and the staff member's name.",
  },
  {
    key: 'transfer_done_by_name', label: 'Transfer completed by', kind: 'text',
    readOnly: true, technical: true,
    provenance:
      'Stamped by /admin/transfers together with the status. It is the audit line for the transfer — it must not be assertable by hand.',
  },
  { key: 'transfer_note', label: 'Transfer note', kind: 'longtext' },
])

// ── 1.l System & audit (11) ─────────────────────────────────────────────────
// The four `readonlyMasked` keys are bearer credentials or key material. Their
// value is stripped by sanitizeRecord() BEFORE it reaches React state, so it
// never lands in the DOM, a devtools dump, a screenshot or a PATCH — the card
// renders "Set" / "Not set" and nothing else.
const SYSTEM = block('system', undefined, [
  {
    key: 'id', label: 'ID', kind: 'number', readOnly: true,
    provenance: 'The database primary key, assigned on insert. Every other table points at it.',
  },
  {
    key: 'uuid', label: 'Wiedisync UUID', kind: 'text',
    help: "The value you type into ClubDesk's Filtern box to find this person.",
    readOnly: true,
    provenance:
      'Generated once by Postgres and never re-issued. Changing it orphans the member in ClubDesk with no way to find them by ID again.',
  },
  {
    key: 'date_created', label: 'Created at', kind: 'datetime', readOnly: true,
    provenance: 'Stamped by Directus on insert. Any value written here is overwritten in the same request.',
  },
  { key: 'date_updated', label: 'Updated at', kind: 'datetime', readOnly: true, provenance: P_DIRECTUS_STAMP },
  {
    key: 'last_online_at', label: 'Last login', kind: 'datetime', readOnly: true,
    provenance: 'Stamped by the login hook on every real login. A refresh-token session does not bump it.',
  },
  {
    key: 'last_export_at', label: 'Last chat export', kind: 'datetime', readOnly: true,
    provenance:
      'Stamped by the messaging export. It is the once-a-day rate limit — clearing it hands the member an unlimited export bypass.',
  },
  {
    key: 'ical_token', label: 'Calendar feed token', kind: 'readonlyMasked',
    readOnly: true, sensitive: true,
    provenance:
      "A bearer credential minted the first time the member subscribes to their calendar. It is never displayed: anybody who reads it can subscribe to that member's private calendar. Rotate it from the member's own calendar settings.",
  },
  {
    key: 'e2ee_public_key', label: 'Encryption public key', kind: 'readonlyMasked',
    readOnly: true, sensitive: true,
    provenance:
      "Generated with the member's identity-document keypair. Changing it means every future document is locked to a key they cannot open.",
  },
  {
    key: 'e2ee_private_key', label: 'Encryption private key', kind: 'readonlyMasked',
    readOnly: true, sensitive: true,
    provenance:
      'The member\'s private key, wrapped under their own password. The club genuinely cannot open it and there is no escrow. It is never displayed and never editable — changing it destroys their uploaded identity documents permanently.',
  },
  {
    key: 'e2ee_kdf_salt', label: 'Encryption key salt', kind: 'readonlyMasked',
    readOnly: true, sensitive: true,
    provenance:
      'The other half of the wrapped private key. Changing it makes the private key undecryptable even with the correct password.',
  },
  {
    key: 'e2ee_key_created', label: 'Encryption key created', kind: 'datetime', readOnly: true,
    provenance:
      'Stamped when the keypair was generated. It is the only audit trail for "why did this member\'s document uploads stop opening".',
  },
// `technical` comes from the block default, not from each field: the group is
// defined as "machine-owned, nothing here is edited by hand", so a column added
// to it later inherits the flag instead of quietly becoming the one audit stamp
// that shows up in the default view.
], { technical: true })

/** All 104 columns + TEAMS_VIRTUAL_KEY + FEE_AMOUNT_VIRTUAL_KEY, in group order. */
export const MEMBER_FIELDS: readonly MemberFieldDef[] = [
  ...IDENTITY,
  ...CONTACT,
  ...MEMBERSHIP,
  ...PLAYING,
  ...ASSOC_COMMON,
  ...ASSOC_VB,
  ...ASSOC_BB,
  ...ROLES_ACCESS,
  ...FINANCE,
  ...PRIVACY,
  ...NOTIFICATIONS,
  ...CLUBDESK,
  ...TRANSFER,
  ...SYSTEM,
]

/** key → def. O(1) lookup built once at module load. */
export const MEMBER_FIELD_BY_KEY: Readonly<Record<string, MemberFieldDef>> =
  Object.freeze(Object.fromEntries(MEMBER_FIELDS.map((f) => [f.key, f])))

/**
 * Keys that must never appear in a PATCH: readOnly ∪ sensitive ∪ virtual ∪
 * dangerZone. `privileged` is deliberately NOT in here — a global admin may
 * write those, so the gate is isFieldReadOnly(def, ctx), not this set.
 */
export const NEVER_PATCH_KEYS: ReadonlySet<string> = new Set(
  MEMBER_FIELDS.filter((f) => f.readOnly || f.sensitive || f.virtual || f.dangerZone).map((f) => f.key),
)

/** Sensitive columns, stripped before the record ever reaches React state. */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set(
  MEMBER_FIELDS.filter((f) => f.sensitive).map((f) => f.key),
)

/**
 * key → "who writes this value", for every field an admin cannot freely edit.
 * Derived from the defs, so it cannot drift from what the field cards render.
 *
 * The primary access path is `def.provenance` (the tooltip on the Read-only
 * badge); this map exists for surfaces that only hold a column name — an audit
 * export, a "why did this change" panel, a sync-diff table.
 */
export const MEMBER_FIELD_PROVENANCE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    MEMBER_FIELDS.filter((f) => f.provenance).map((f) => [f.key, f.provenance as string]),
  ),
)

/**
 * key → "a sync overwrites this", for the editable-but-clobbered fields. These
 * are NOT read-only: the amber chip is a warning ("your edit survives until
 * Monday 04:00"), not a lock.
 */
export const MEMBER_FIELD_OVERWRITTEN_BY: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    MEMBER_FIELDS.filter((f) => f.overwrittenBy).map((f) => [f.key, f.overwrittenBy as string]),
  ),
)

// ─────────────────────────────────────────────────────────────────────────────
// Lookups
// ─────────────────────────────────────────────────────────────────────────────

/** snake_case → "Sentence case", for a column this file does not know about. */
function humanize(key: string): string {
  const words = key.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Synthesised defs are cached so repeated calls return a referentially stable object. */
const UNMAPPED_CACHE = new Map<string, MemberFieldDef>()

/**
 * Credential-shaped column names, for columns the taxonomy does not describe.
 *
 * The declared `sensitive` flags are an allow-list, which is the wrong default
 * for a secret: the next migration that adds a token column would render its
 * value straight into the DOM in the amber "Unmapped columns" group until
 * somebody noticed. A name that looks like key material is therefore MASKED
 * until it is described here — the cost of a false positive is one field
 * reading "Set" instead of showing an id, and the cost of a false negative is a
 * bearer credential in a screenshot.
 */
const SECRET_NAME_RE =
  /(^|_)(token|secret|password|passwd|pwd|private_key|privkey|api_?key|salt|hash|otp|nonce|credential)s?(_|$)/i

export function looksSecret(key: string): boolean {
  return SECRET_NAME_RE.test(key)
}

/**
 * Directus ALIASES on `members` — not columns. A `fields: ['*']` read returns
 * the o2m ones alongside real columns, and until 2026-08-06 they landed in the
 * amber "Unmapped columns" group reading as undescribed columns that an admin
 * might reasonably conclude were dead and try to drop.
 *
 * ⚠ They are the opposite of dead. `member_teams` IS the club roster (1313 rows
 * on prod — every player↔team assignment); `game_guests` holds the called-up
 * players. Dropping either empties a core feature. `spielplaner_assignments` is
 * legitimately empty (Spielplaner scope is club-wide unless narrowed), which is
 * exactly what made it look disposable.
 *
 * Dropped from the record entirely rather than shown read-only: this form
 * PATCHes `members`, and an o2m alias in a PATCH body is a RELATIONAL write —
 * Directus would try to reconcile the junction from whatever it found — never a
 * field edit. Roster editing has its own surface in ExplorerDetail.
 *
 * `grp_*` are Directus admin-app field groups (`alias,no-data,group`); they
 * carry no value and never reach the record, but the prefix rule keeps a new one
 * from ever surfacing as a phantom column.
 *
 * ⚠ Add any new relational alias here. The current set:
 *   select field, special from directus_fields
 *    where collection='members' and special ~ 'o2m|m2m|m2a';
 */
const MEMBER_RELATION_ALIASES: ReadonlySet<string> = new Set([
  'member_teams',
  'game_guests',
  'spielplaner_assignments',
])

/** True for a key that is a Directus alias rather than a `members` column. */
export function isRelationAlias(key: string): boolean {
  return MEMBER_RELATION_ALIASES.has(key) || key.startsWith('grp_')
}

/**
 * Fallback for a column that exists on the record but not in MEMBER_FIELDS —
 * a migration landed before this file caught up. Never returns undefined: it
 * synthesises a `system`-group def so the column is still visible (there is no
 * anonymous "Other" bucket to lose it in), and marks it read-only, because the
 * app has no idea what type it is and a blind PATCH of an unknown column is
 * how you write a string into a jsonb.
 */
export function getFieldDef(key: string): MemberFieldDef {
  const known = MEMBER_FIELD_BY_KEY[key]
  if (known) return known

  const cached = UNMAPPED_CACHE.get(key)
  if (cached) return cached

  if (import.meta.env.DEV) {
    console.warn(
      `[memberFieldSchema] Unmapped members column "${key}" — add it to memberFieldSchema.ts (see the completeness test).`,
    )
  }
  const secret = looksSecret(key)
  const synthesised: MemberFieldDef = {
    key,
    group: 'system',
    // Sorted after every declared system field; ties broken by key in
    // buildMemberFieldSections, so several unmapped columns stay stable.
    order: 1000,
    label: humanize(key),
    help: secret
      ? 'Unmapped column with a credential-shaped name — treated as a secret until it is described in memberFieldSchema.ts'
      : 'Unmapped column — add it to memberFieldSchema.ts',
    kind: secret ? 'readonlyMasked' : 'text',
    readOnly: true,
    provenance:
      'This column is not described in memberFieldSchema.ts, so the app does not know its type or who writes it. Add it there before editing it here.',
    sportGate: null,
    sensitive: secret,
  }
  UNMAPPED_CACHE.set(key, synthesised)
  return synthesised
}

/**
 * Final read-only verdict for one field.
 *  - def.readOnly   → true always
 *  - def.dangerZone → true always (the danger zone is its only editing surface)
 *  - def.sensitive  → true always (the value is not even in memory)
 *  - def.privileged → true unless ctx.isGlobalAdmin
 */
export function isFieldReadOnly(
  def: MemberFieldDef,
  ctx: { isGlobalAdmin: boolean },
): boolean {
  if (def.readOnly || def.dangerZone || def.sensitive) return true
  if (def.privileged) return !ctx.isGlobalAdmin
  return false
}

/**
 * Strip every `sensitive` key from a fetched record BEFORE it reaches React
 * state, so the value cannot leak into the DOM, a devtools dump, or a PATCH.
 * The key is kept (so the field still renders and still counts as "present"),
 * but its value becomes the boolean "was it set".
 */
export function sanitizeRecord(
  raw: Record<string, unknown>,
): { record: Record<string, unknown>; present: Record<string, boolean> } {
  const record: Record<string, unknown> = {}
  const present: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(raw)) {
    // Relations are not fields. Dropped here, at the single entry point, so an
    // alias cannot reach `draft`, `dirtyKeys`, the render plan, or a PATCH body.
    if (isRelationAlias(key)) continue
    // Declared sensitive, OR an undescribed column whose NAME reads like key
    // material. The second half is what makes this deny-by-default: a token
    // column added by a migration this file has not caught up with is masked on
    // the way in, not rendered raw in the "Unmapped columns" group.
    if (SENSITIVE_KEYS.has(key) || (!MEMBER_FIELD_BY_KEY[key] && looksSecret(key))) {
      const wasSet = value !== null && value !== undefined && value !== ''
      record[key] = wasSet
      present[key] = wasSet
    } else {
      record[key] = value
    }
  }
  return { record, present }
}

// ─────────────────────────────────────────────────────────────────────────────
// Render plan
// ─────────────────────────────────────────────────────────────────────────────

export interface MemberFieldSectionEntry {
  subsection: MemberFieldSubsection | null
  fields: MemberFieldDef[]
  /** true ⇒ this subsection is hidden because the member is not in that sport. */
  hiddenBySport: boolean
}

export interface MemberFieldSection {
  group: MemberFieldGroup
  entries: MemberFieldSectionEntry[]
  /** Sum of fields across visible entries — the count chip in the header. */
  visibleCount: number
  /** True when at least one entry is hiddenBySport ⇒ render the reveal toggle. */
  hasHiddenSport: boolean
  /** Fields this section dropped because they hold no value. */
  hiddenEmptyCount: number
  /** Fields this section dropped because they are `technical`. */
  hiddenTechnicalCount: number
}

const EMPTY_KEY_SET: ReadonlySet<string> = new Set<string>()

/** Why a field is not rendered, or null when it is. */
export type FieldFilterReason = 'technical' | 'empty' | null

export interface FieldFilterOpts {
  /** Default true. False drops every `technical` field. */
  showTechnical?: boolean
  /** Hide fields whose value is empty. Needs `isEmpty`; ignored without it. */
  hideEmpty?: boolean
  /** "Does this key hold no value" — owned by the caller, which has the record. */
  isEmpty?: (key: string) => boolean
  /** Never filtered out, whatever the flags say (used for dirty keys). */
  alwaysShow?: ReadonlySet<string>
}

/**
 * The single filter predicate, shared by the render plan and by whatever counts
 * the toggles ("Show empty fields (54)"). One function so the number on the
 * button can never disagree with the number of cards revealing it produces.
 *
 * `technical` wins over `empty` when a field is both, which is what keeps the
 * two counts disjoint.
 */
export function fieldFilterReason(def: MemberFieldDef, opts: FieldFilterOpts): FieldFilterReason {
  if ((opts.alwaysShow ?? EMPTY_KEY_SET).has(def.key)) return null
  if (def.technical && opts.showTechnical === false) return 'technical'
  if (opts.hideEmpty && opts.isEmpty?.(def.key)) return 'empty'
  return null
}

const GROUP_BY_ID: Readonly<Record<MemberFieldGroupId, MemberFieldGroup>> =
  Object.fromEntries(MEMBER_FIELD_GROUPS.map((g) => [g.id, g])) as Record<MemberFieldGroupId, MemberFieldGroup>

const GROUPS_IN_ORDER: readonly MemberFieldGroup[] =
  [...MEMBER_FIELD_GROUPS].sort((a, b) => a.order - b.order)

/**
 * Build the ordered render plan.
 *
 * `presentKeys` is Object.keys(record) plus TEAMS_VIRTUAL_KEY. Fields whose key
 * is not present are dropped — a policy may withhold a column, and rendering an
 * empty card for something the viewer cannot read is a lie. Columns present on
 * the record but missing from the schema are NOT dropped: they land in `system`
 * via getFieldDef() with an "Unmapped column" note.
 *
 * `revealedSports` are the gates the admin has explicitly un-hidden with the
 * group-header toggle; a gate in that set counts as visible.
 *
 * ⚠ Hiding is VISUAL ONLY. Hidden entries are still returned (with their
 * fields, flagged `hiddenBySport`) so the caller keeps hidden keys in `draft`
 * and in `dirtyKeys` — nothing here removes or nulls a value. The same holds for
 * the two noise filters below, which drop fields from the RENDER PLAN only:
 * `dirtyKeys` is computed from the record, never from what came back here.
 *
 * `hideEmpty` + `isEmpty` drop the cards with no value, and `showTechnical:
 * false` drops the machine-owned ones (see `MemberFieldDef.technical`). Both
 * default to off so an unparameterised call still renders every present key —
 * the completeness test depends on that. `alwaysShow` is the escape hatch the
 * caller uses for keys with unsaved edits, so a filter can never swallow a
 * pending change.
 *
 * A group is dropped only when it holds NO present fields at all. A group whose
 * fields are all hidden by sport is kept: dropping it would remove the very
 * toggle that reveals them. A group left empty by the noise filters IS dropped —
 * its toggle lives in the page header, not in the group.
 */
export function buildMemberFieldSections(opts: FieldFilterOpts & {
  presentKeys: Iterable<string>
  sport: MemberSport
  revealedSports: ReadonlySet<'volleyball' | 'basketball'>
}): MemberFieldSection[] {
  const present = new Set(opts.presentKeys)
  const filterOpts: FieldFilterOpts = {
    showTechnical: opts.showTechnical,
    hideEmpty: opts.hideEmpty,
    isEmpty: opts.isEmpty,
    alwaysShow: opts.alwaysShow,
  }

  // Resolve every present key to a def (synthesising unmapped ones), then bucket
  // by group + subsection.
  const byGroup = new Map<MemberFieldGroupId, Map<MemberFieldSubsectionId | '', MemberFieldDef[]>>()
  for (const key of present) {
    // sanitizeRecord already drops these; repeated here because this function is
    // also reachable with a raw key list, and an alias must never render.
    if (isRelationAlias(key)) continue
    const def = getFieldDef(key)
    let subs = byGroup.get(def.group)
    if (!subs) {
      subs = new Map()
      byGroup.set(def.group, subs)
    }
    const bucket = def.subsection ?? ''
    const list = subs.get(bucket)
    if (list) list.push(def)
    else subs.set(bucket, [def])
  }

  const sections: MemberFieldSection[] = []

  for (const group of GROUPS_IN_ORDER) {
    const subs = byGroup.get(group.id)
    if (!subs) continue

    // Declared subsections first, in declared order; anything else (a group
    // with no subsections) under the null entry.
    const declared: MemberFieldSubsection[] = group.subsections ?? []
    const entries: MemberFieldSectionEntry[] = []

    let hiddenEmptyCount = 0
    let hiddenTechnicalCount = 0

    const pushEntry = (subsection: MemberFieldSubsection | null, all: MemberFieldDef[]) => {
      if (all.length === 0) return
      const fields = all.filter((def) => {
        const reason = fieldFilterReason(def, filterOpts)
        if (reason === 'technical') hiddenTechnicalCount++
        else if (reason === 'empty') hiddenEmptyCount++
        return reason === null
      })
      if (fields.length === 0) return
      fields.sort((a, b) => (a.order - b.order) || a.key.localeCompare(b.key))
      const gate = subsection?.sportGate ?? null
      const hiddenBySport =
        gate !== null && !sportCovers(opts.sport, gate) && !opts.revealedSports.has(gate)
      entries.push({ subsection, fields, hiddenBySport })
    }

    // The un-subsectioned bucket always renders first (assoc_common is declared
    // with an empty label and sits directly under the group description).
    pushEntry(null, subs.get('') ?? [])
    for (const subsection of declared) {
      pushEntry(subsection, subs.get(subsection.id) ?? [])
    }

    if (entries.length === 0) continue

    const visibleCount = entries.reduce((n, e) => n + (e.hiddenBySport ? 0 : e.fields.length), 0)
    sections.push({
      group,
      entries,
      visibleCount,
      hasHiddenSport: entries.some((e) => e.hiddenBySport),
      hiddenEmptyCount,
      hiddenTechnicalCount,
    })
  }

  return sections
}

/** Exported for tests / callers that need the group metadata by id. */
export function getFieldGroup(id: MemberFieldGroupId): MemberFieldGroup {
  return GROUP_BY_ID[id]
}
