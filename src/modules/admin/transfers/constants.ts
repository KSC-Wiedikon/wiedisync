/**
 * Constants for the `/admin/transfers` module.
 *
 * No React, no i18n, no derived values — the fixed facts the page is built on,
 * kept in one place so a number that MIRRORS something outside this repo has
 * exactly one home to change.
 */

import type { Team } from '../../../types'

/**
 * VOLLEYBALL ONLY — the page had a sport toggle and no longer does.
 *
 * Everything this page is made of belongs to FIVB's apparatus: the VIS player
 * index, the VIS federation directory, the prepared letters, and the Swiss
 * Volley licence cross-check. A FIBA transfer runs federation to federation
 * through Swiss Basketball and is not worked from here, so a basketball tab
 * could only ever show a worklist nobody works, addressed to the wrong
 * governing body. Basketball players are COUNTED in the diagnostics
 * (`trHiddenBasketball`) rather than dropped in silence.
 */
export const SPORT: Team['sport'] = 'volleyball'

/**
 * Volleyball teams whose players need no international transfer, by exact team
 * name. Swiss Volley's U20 championship sits outside the ITC regime, so a
 * member who plays only there is on nobody's worklist.
 *
 * ⚠ The exemption is per TEAM, not per person: an HU20 player who also plays
 * 2. Liga still needs the transfer for that licence. So it only fires when
 * EVERY volleyball team the member plays for is on this list.
 *
 * ⚠ Exact names, deliberately not a `U\d+` pattern — U23 is NOT exempt. MiniVB
 * would be, but it has no roster at all; add it here if the programme returns.
 */
export const NO_TRANSFER_VB_TEAM_NAMES: ReadonlySet<string> = new Set(['DU20', 'HU20'])

/** The `members` columns this page reads. Kept explicit rather than `*` so the
 *  page never pulls IBAN / AHV / address PII it has no use for.
 *  ⚠ The four `transfer_*` columns land with migration 234 — deploy the schema
 *  BEFORE this frontend on any environment that lacks them, or Directus rejects
 *  the whole field list (CLAUDE.md → "deploy schema FIRST").
 *  ⚠ `licence_validation_date` is NOT a `members` column (it exists only on
 *  `sv_vm_check`); asking for it here would 400 the query. */
export const MEMBER_FIELDS: string[] = [
  'id', 'first_name', 'last_name', 'nickname', 'email', 'birthdate',
  'license_nr', 'licence_category', 'nationalitaet_codes', 'federation_of_origin',
  'kscw_membership_active', 'licence_validated',
  'transfer_status', 'transfer_done_at', 'transfer_done_by_name', 'transfer_note',
  // VIS presence (migration 240). Same deploy-order caveat as the transfer_*
  // block above: this list is explicit, so a column that is not named here
  // simply arrives `undefined` — which would make every member read as
  // "not checked" with no error anywhere to explain it.
  'in_vis', 'vis_player_no', 'in_vis_checked_at',
  // Hand-set link + the confirmation the sweep writes back (migration 312).
  'vis_player_no_manual', 'vis_manual_vis_name',
]

/**
 * The VIS transfers app. There is NO per-player URL — VIS routes everything
 * through an in-app search — so this is deliberately the plain entry point and
 * the player number is offered as a copyable value next to it. Inventing a
 * `?playerNo=` style link would produce a dead end that looks authoritative.
 */
export const VIS_TRANSFERS_URL = 'https://app.fivb.com/volley/transfers/'

/**
 * ⚠⚠ MIRRORS `directus/scripts/vis-transfer-sync.mjs` (`DEAD_STATUS_CODES` /
 * `ENDED_STATUS_CODES` / `visStateOf`). The script decides what to WRITE and
 * this decides what to SHOW — if they drift, the page contradicts the column it
 * is rendering. Change both in the same commit.
 *
 * "Complete" is 100% OR an ended code, not "ended" alone: an ITC finishes its
 * tasks weeks before VIS moves the row to 200, which only happens once the
 * season starts.
 */
export const VIS_DEAD_STATUS: ReadonlySet<number> = new Set([239, 240, 255])
export const VIS_ENDED_STATUS: ReadonlySet<number> = new Set([200, 210, 215, 220])

/** VIS status code → i18n key for the phase name. Same codes as the sync's
 *  STATUS_LABEL, but the visible text is translated rather than stored. */
export const VIS_PHASE_KEY: Record<number, string> = {
  10: 'trVisPhaseDraft', 12: 'trVisPhaseDraft',
  20: 'trVisPhaseSubmitted',
  100: 'trVisPhaseInProgress', 130: 'trVisPhaseInProgress',
  200: 'trVisPhaseEnded', 210: 'trVisPhaseEnded', 215: 'trVisPhaseEnded', 220: 'trVisPhaseEnded',
}

/**
 * VIS stores federation names in ALL CAPS ("GERMAN VOLLEYBALL FEDERATION").
 * Acceptable as a table label, but it shouts in a letter we send to that
 * federation — so it is title-cased for display, lowercasing the connectors
 * title case would otherwise capitalise ("FEDERACIÓN ESPAÑOLA DE VOLEIBOL" →
 * "Federación Española de Voleibol"). A name VIS already stores mixed-case
 * ("Nederlandse Volleybalbond (Nevobo)") is trusted exactly as it is.
 *
 * ⚠ Deliberately NO "short tokens are acronyms" rule. It is the obvious guess
 * and it is wrong for this data: across all 69 rows the directory holds long-
 * form names only, so every short token is either a connector or a real word —
 * "VOLLEYBALL NEW ZEALAND INC." and "SRI LANKA …" would come out as "NEW" and
 * "SRI". Federations that genuinely spell themselves in capitals go in
 * FED_KEEP_UPPER by name.
 *
 * ⚠ Their ONE consumer is `prettyFederationName()` in `./utils/federationText`.
 * Do not copy either set anywhere else — two lists of connectors drift.
 */
export const FED_KEEP_UPPER: ReadonlySet<string> = new Set([
  'FIVB', 'FIBA', 'CEV', 'NORCECA', 'CAVB', 'CSV', 'AVC',
])
export const FED_LOWER: ReadonlySet<string> = new Set([
  'DE', 'DI', 'DA', 'DEL', 'DES', 'DU', 'LA', 'LE', 'EL', 'OF', 'AND', 'Y', 'E', 'IL',
  'VAN', 'DER', 'DEN', 'DELLA',
])

/** Subject line for the prepared request. English, for the same reason the body is. */
export const VIS_REQUEST_SUBJECT =
  'International transfer to Swiss Volley — request to register KSC Wiedikon players in VIS'

/**
 * Some mail clients silently TRUNCATE an over-long `mailto:` — which would send
 * a letter missing its last players while looking complete. Past this length the
 * body is dropped from the link (recipient + subject only) and the admin pastes
 * the copied text in; 1800 sits under the ~2048 Windows hands to a mail client.
 * For scale: 5 players prefill comfortably, 16 do not.
 */
export const MAILTO_MAX = 1800
