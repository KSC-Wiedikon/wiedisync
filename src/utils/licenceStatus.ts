// src/utils/licenceStatus.ts
//
// THE licence-status module (frontend). One place that knows the five states,
// their order, their i18n keys and their colours, so the Data Explorer, the
// profile card, the /admin/anmeldungen buttons and the notification panel
// cannot disagree about what "finalized" looks like.
//
// The states (migration 301), in workflow order:
//
//   none          no licence needed / none held           manual
//   to_be_ordered somebody has to order one               manual
//   ordered       ordered with the federation             manual
//   finalized     paperwork done, awaiting confirmation   manual
//   licenced      CONFIRMED by the Swiss Volley / Basketplan sync
//
// Only the last one is machine-asserted. The sweep behind it
// (POST /kscw/admin/licence-status/sync) promotes ONLY — it never demotes — so
// a hand-set status is never overwritten by a register having a bad day. The
// one thing that moves a status backwards is the 1 June season rollover.
//
// ⚠ SIBLINGS. The same five codes exist in three other places and all four must
// change together:
//   directus/scripts/301-member-licence-status.sql   (CHECK constraint + the
//                                                     Directus dropdown choices)
//   kscw-endpoints/src/licence-status.js             (LICENCE_STATUSES)
//   src/modules/admin/components/memberFieldOptions.ts (the explorer's editor)
// A code added to one and not the others saves fine and then renders as a blank
// badge, which is exactly the failure memberFieldOptions.ts was written to stop.

import { currentSeasonShort } from './season'

export type LicenceStatus = 'none' | 'to_be_ordered' | 'ordered' | 'finalized' | 'licenced'

/** Canonical order — single source of truth for UI iteration. */
export const LICENCE_STATUSES: readonly LicenceStatus[] = [
  'none', 'to_be_ordered', 'ordered', 'finalized', 'licenced',
] as const

export function isLicenceStatus(value: unknown): value is LicenceStatus {
  return typeof value === 'string' && (LICENCE_STATUSES as readonly string[]).includes(value)
}

/**
 * i18n key for a state's label, e.g. t('licenceStatus_ordered').
 *
 * They live in the `common` namespace because three unrelated surfaces need the
 * same five words — the profile card (`auth`), the registrations page (`admin`)
 * and the notification bell (`notifications`) — and a label duplicated across
 * three namespaces in five locales is fifteen chances to drift.
 */
export function licenceStatusKey(status: LicenceStatus): string {
  return `licenceStatus_${status}`
}

/**
 * Badge classes per state. Deliberately NOT a red/green pass-fail scale: four
 * of the five are ordinary points on a workflow, and painting "To be ordered"
 * red would read as a problem with the member rather than a task for the club.
 * Grey → amber → blue → indigo → green is progress, and only the confirmed end
 * of it is green.
 */
export const LICENCE_STATUS_BADGE: Record<LicenceStatus, string> = {
  none:
    'bg-gray-100 text-gray-700 dark:bg-gray-700/50 dark:text-gray-300',
  to_be_ordered:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  ordered:
    'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  finalized:
    'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  licenced:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
}

/**
 * What a member's stored status actually MEANS today.
 *
 * A status is only ever an answer about one season. The nightly sweep resets a
 * stale stamp back to `none`, but between the 1 June rollover and the next
 * sweep — and on any row a raw-SQL path created without a stamp — the column
 * still holds last season's answer. Reading it raw in that window is how a
 * green "Licenced" badge outlives the licence it describes, so every display
 * surface goes through here instead.
 *
 * `stale` is surfaced rather than swallowed: the profile card and the explorer
 * both want to say "not yet answered for 2026/27", which is a different and
 * more honest statement than "no licence".
 */
export function effectiveLicenceStatus(
  member: { licence_status?: string | null; licence_status_season?: string | null } | null | undefined,
  now: Date = new Date(),
): { status: LicenceStatus; stale: boolean } {
  const raw = member?.licence_status
  const status = isLicenceStatus(raw) ? raw : 'none'
  const season = member?.licence_status_season ?? null
  const stale = season !== currentSeasonShort(now)
  return { status: stale ? 'none' : status, stale }
}
