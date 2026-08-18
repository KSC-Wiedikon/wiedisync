/**
 * Shared shapes for the `/admin/transfers` module.
 *
 * Type-only by design: no React, no i18n, no runtime values. Every component,
 * hook and pure util under `transfers/` reads its shapes from here, so the four
 * separate authorities this page renders — `members.in_vis`,
 * `members.licence_validated`, `members.transfer_status` and the `vis_transfers`
 * row — can never be re-declared differently in two files.
 */

import type { RowState } from './utils/rowState'

/** Re-exported so a component needs ONE import for every shape on this page. */
export type { RowState }

/**
 * Stored status (migration 320's CHECK). NULL is not "nothing to do" — it is
 * "nobody has decided", and the page then DERIVES the answer (see
 * `derivedStatusSource`). A stored value is a decision a person made and
 * outranks that derivation in both directions:
 *
 *   'not_needed' — ruled out by hand. The way to clear somebody off the worklist
 *                  WITHOUT falsifying `federation_of_origin`, which is the
 *                  member's own answer about their history and not a checkbox
 *                  for silencing a task list.
 *   'pending'    — being chased, even where the derivation says otherwise.
 *   'done'       — the certificate landed.
 */
export type TransferStatus = 'pending' | 'done' | 'not_needed'

/** One member as this page reads them — the explicit `MEMBER_FIELDS` list, no
 *  more. A column that is not in that list simply arrives `undefined`. */
export interface TransferMember {
  id: string
  first_name?: string
  last_name?: string
  nickname?: string | null
  email?: string | null
  birthdate?: string | null
  license_nr?: string | null
  licence_category?: string | null
  nationalitaet_codes?: string | null
  federation_of_origin?: string | null
  kscw_membership_active?: boolean
  /** Mirrored onto `members` by vm-sync-check.mjs; `sv_vm_check` stays the source
   *  of truth. Null/undefined = Volleymanager knows no licence for this person. */
  licence_validated?: boolean | null
  transfer_status?: TransferStatus | null
  transfer_done_at?: string | null
  transfer_done_by_name?: string | null
  transfer_note?: string | null
  /**
   * Presence in the FIVB VIS player index of the member's federation of origin,
   * written by `vis-player-check.mjs` (migration 240).
   *
   *  - `true`      — found; a transfer can be requested for them.
   *  - `false`     — NOT found. ⚠ Evidence, not proof, and the UI must never say
   *                  otherwise: the check matches on a normalised name, and
   *                  `federation_of_origin` was SEEDED from nationality for most
   *                  members (migration 239). So a `false` far more often means
   *                  the seeded origin was wrong — the person was never licensed
   *                  in their passport country at all — than that a federation
   *                  has failed to enter them. Read as "no evidence they were
   *                  ever licensed there". For a CH-origin member it blocks
   *                  nothing at all — no international transfer applies — so it
   *                  is worded differently there (`trSwissInVisNoHint`).
   *  - null/undef. — never checked. CH-origin members USED to be skipped by
   *                  design; they are checked against Swiss Volley's own VIS
   *                  index (fed 189/SUI) since the Swiss group was introduced,
   *                  so a Swiss row reading "not checked" just means the monthly
   *                  job has not run since.
   */
  in_vis?: boolean | null
  /** FIVB VIS player number, present when `in_vis` is true. The only stable
   *  identifier VIS exposes for a person, and the value to paste into its search.
   *  ⚠ Typed `number | string` because that is what it IS at runtime — same
   *  `stringifyIds` reason spelled out in the ⚠⚠ block on `VisTransfer` below.
   *  Read it through `normaliseVisPlayerNo()`, never compare it bare. */
  vis_player_no?: number | string | null
  in_vis_checked_at?: string | null
  /** Hand-set VIS player number (migration 312), for the people name matching
   *  cannot reach — a married name, a transliteration, a spelling VIS alone
   *  knows. The checker READS this column and never writes it.
   *  ⚠ Same `number | string` runtime shape as `vis_player_no`, and this one has
   *  already bitten: `linkVisPlayer`'s no-op guard compared it to a `Number()`
   *  result bare, so re-saving an unchanged link always wrote — replacing the
   *  sweep's green "VIS: MUELLER, Anna" confirmation with the amber
   *  "unconfirmed" warning while toasting success. Go through
   *  `normaliseVisPlayerNo()`. */
  vis_player_no_manual?: number | string | null
  /** VIS's own spelling of `vis_player_no_manual`, written by the checker.
   *  Empty AFTER a check means that number is not in the member's federation
   *  index — so the link is unconfirmed and deliberately asserts nothing:
   *  `in_vis` stays whatever name matching concluded. */
  vis_manual_vis_name?: string | null
}

/**
 * A national federation as VIS publishes it (migration 241, 69 rows). `iso` is
 * the ISO alpha-2 that matches `members.federation_of_origin`; the FIVB `code`
 * is IOC-style and NOT derivable from it (DE→GER, NL→NED), which is why the
 * table stores both.
 */
export interface VisFederation {
  /** ⚠ `number | string` for the same `stringifyIds` reason documented on
   *  `VisTransfer` below. */
  vis_no: number | string
  iso: string
  code?: string | null
  name: string
  email?: string | null
  website?: string | null
}

/**
 * One international transfer as FIVB VIS holds it (migration 237), mirrored
 * nightly by `vis-transfer-sync.mjs`.
 *
 * This is the AUTHORITATIVE answer to the question the whole page is about, and
 * it is deliberately a different fact from the three already on screen:
 * `in_vis` is presence in a federation's player index, `licence_validated` is
 * Swiss Volley's downstream confirmation, and `transfer_status` is what the club
 * decided. Only this one is FIVB saying whether the ITC exists.
 *
 * ⚠⚠ Since 2026-08-18 the same sync WRITES `members.transfer_status` from these
 * rows, so the two columns normally agree and a divergence is worth looking at:
 * either the nightly run has not caught up, or a person overruled it since.
 */
/* ⚠⚠ The numeric fields are typed `number | string` because that is what they
 * ACTUALLY are at runtime: `fetchItems` pipes every result through
 * `stringifyIds` (src/lib/api.ts), which turns every integer field into a string
 * unless its name is in `KEEP_AS_NUMBER` — an FK-flattening convenience that
 * does not know these columns. So `percent_complete === 100` is false for a
 * completed transfer, and `'60' > '100'` is TRUE, which picks the LEAST advanced
 * row. Both were live bugs caught by rendering the page against fixtures.
 * Coerce with `Number()` at every use; the type is deliberately awkward so the
 * next reader cannot skip it. */
export interface VisTransfer {
  vis_no: number | string
  season_no: number | string
  no_by_season?: number | string | null
  status_code?: number | string | null
  status_label?: string | null
  percent_complete?: number | string | null
  is_player_blocked?: boolean | null
  start_on?: string | null
  end_on?: string | null
  player_no?: number | string | null
  player_first_name?: string | null
  player_last_name?: string | null
  deleted_at?: string | null
}

/** One `sv_vm_check` row — Swiss Volley's Volleymanager register as we last
 *  scraped it. The cross-CHECK behind the licence column, never a replacement
 *  for it. */
export interface VmRow {
  id: string
  association_id?: number | string | null
  email?: string | null
  licence_validated?: boolean | null
  licence_validation_date?: string | null
  /** German country name — the person's CITIZENSHIP as Volleymanager records it. */
  nationality?: string | null
  /**
   * IOC alpha-3 PLAYING nationality of the licence. 'SUI' on a foreign citizen
   * means Swiss Volley already counts them as Swiss for eligibility — it does
   * NOT mean Swiss citizenship, and neither column is a federation of origin
   * (Volleymanager stores none; its `federation` column is the REGIONAL
   * association of the current licence club). Shown for comparison only, never
   * fed back into `federation_of_origin`.
   */
  nationality_code?: string | null
}

/** Where a `vis_transfers` row sits, derived from its status code and percentage
 *  by `visTransferState()` — never read off `status_label`. */
export type VisTransferState = 'complete' | 'in_progress' | 'dead'

/** Validation state shown per row. `unknown` = Volleymanager has no licence for
 *  this person at all, which is NOT the same as an explicit "not validated". */
export type ValidationState = 'validated' | 'not_validated' | 'unknown'

/**
 * What a rendered group of members is, which decides every column and control
 * in it. One value per cohort — see `columnsForMode()` in `./utils/tableMode`
 * for the full mapping.
 */
export type TableMode = 'needs' | 'clarify' | 'swiss' | 'notNeeded'

/** How the worklist splits into groups. `'none'` renders one flat table with no
 *  federation header at all. */
export type GroupBy = 'federation' | 'state' | 'none'

/** The tab strip. Every cohort stays reachable and counted — nothing is dropped,
 *  only moved behind a tab. */
export type CohortTab = 'worklist' | 'clarify' | 'notNeeded' | 'swiss' | 'diagnostics'

/** One rendered group of members: a federation, a derived state, or the single
 *  synthetic group `groupBy: 'none'` produces. */
export interface TransferGroup {
  key: string
  label: string
  rows: TransferMember[]
}

/**
 * `GET /kscw/admin/vis-player-check`. `result` is the LAST finished run in this
 * container's lifetime, so it is null on a cold start even when `last` (the
 * `sync_runs` heartbeat) has a date — the two answer different questions and
 * only `result` carries the per-run tallies.
 */
export interface VisCheckStatus {
  running: boolean
  startedAt: string | null
  configured: boolean
  result: { ok: boolean; checked?: number; inVis?: number; notFound?: number; error?: string } | null
}

/**
 * Which way our `federation_of_origin` and Volleymanager's playing nationality
 * disagree.
 *
 *   'vmSaysForeign' — we record CH (or 'NONE') and Swiss Volley records a foreign
 *                     federation. The DANGEROUS direction: nobody is chasing a
 *                     transfer that may be required.
 *   'bothForeign'   — two different foreign federations.
 *   'vmSaysSwiss'   — we record a foreign federation and Swiss Volley licences
 *                     them as Swiss.
 */
export type FooConflictKind = 'vmSaysSwiss' | 'vmSaysForeign' | 'bothForeign'

/** One reported disagreement. ⚠ Never auto-applied — the disagreement IS the
 *  evidence that one of the two registers needs fixing, and which one is a human
 *  question with two different remedies. */
export interface FooConflict {
  m: TransferMember
  ourIso: string
  vmIso: string
  vmCode: string
  kind: FooConflictKind
}

/**
 * The volleyball cohorts. `u20` is a COUNT, not a list: those members are exempt
 * by the team they play in (`NO_TRANSFER_VB_TEAM_NAMES`), so there is no
 * per-member state to keep and nothing to work.
 *
 * `notNeeded` is a LIST for the opposite reason: these are members the federation
 * column puts squarely on the worklist and an override takes off it, so they are
 * the only cohort whose membership is a judgement rather than a fact. Members the
 * federation column ALREADY settled ('NONE') stay in the bare `settled` tally:
 * nothing was overridden for them.
 */
export interface TransferCohorts {
  needs: TransferMember[]
  clarify: TransferMember[]
  swiss: TransferMember[]
  notNeeded: TransferMember[]
  settled: number
  u20: number
}

/**
 * Members who WOULD be on a worklist but are not shown. The three reasons are
 * counted SEPARATELY because they mean different things: "on no team" is a data
 * gap to fix (give them a team and they reappear), "guest only" is the correct
 * answer (no licence, so no transfer), and "basketball" is a whole sport this
 * page does not cover — see `SPORT`.
 */
export interface HiddenCounts {
  noTeam: number
  guestOnly: number
  basketball: number
}

/** The three-way VIS presence split over a set of rows. `unchecked` is its own
 *  figure and never folded into `notFound` — "never looked" and "looked and did
 *  not find" are different facts. */
export interface VisPresenceCounts {
  inVis: number
  notFound: number
  unchecked: number
}

/** Which columns a `TableMode` renders. The single source both `TransferGroupTable`
 *  and `TransferRow` read, so their column counts can never diverge. */
export interface TableColumns {
  licence: boolean
  vis: boolean
  status: boolean
  note: boolean
  collapsible: boolean
}

/**
 * Everything a row needs DERIVED once at the page level and passed down, so no
 * view re-derives a cohort or a state for itself.
 *
 * ⚠ `stateOf` is a derived LABEL over the four authorities and must never be
 * treated as a merge of them: conflating `in_vis` / `licence_validated` /
 * `transfer_status` / `vis_transfers` lets a stale toggle hide an incomplete
 * transfer, so all four stay separately rendered in Evidence and the row detail.
 */
export interface TransferDerivations {
  visTransferOf: (m: TransferMember) => VisTransfer | null
  validationOf: (m: TransferMember) => ValidationState
  vmRowOf: (m: TransferMember) => VmRow | null
  vmSaysSwiss: (m: TransferMember) => boolean
  stateOf: (m: TransferMember) => RowState
  disputedOf: (m: TransferMember) => boolean
  teamNamesOf: (memberId: string) => string[] | undefined
  isUnrostered: (memberId: string) => boolean
  federationByIso: ReadonlyMap<string, VisFederation>
}

/**
 * Every write and every piece of open/closed state a row can touch, owned by the
 * page.
 *
 * ⚠ `noteDrafts` lives here rather than in row state: a controlled input whose
 * value is written back into the row that renders it is the render-phase setState
 * that produces React #301. It is a page-level Map and is never cleared.
 *
 * ⚠ `canRunVisCheck` is deliberately narrower than page read access — a
 * basketball admin can read this page but the VIS endpoint 403s them — so it is
 * passed down here and never re-derived from a generic `isAdmin`.
 */
export interface TransferRowActions {
  savingId: string | null
  canRunVisCheck: boolean
  noteDrafts: ReadonlyMap<string, string>
  openRows: ReadonlySet<string>
  onToggleRow: (memberId: string, open: boolean) => void
  onNoteDraftChange: (memberId: string, value: string) => void
  onSetStatus: (m: TransferMember, next: TransferStatus | null) => void
  onSaveNote: (m: TransferMember, value: string) => void
  onLinkVisPlayer: (m: TransferMember) => void
}
