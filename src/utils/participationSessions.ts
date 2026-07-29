import type { Participation } from '../types'

/**
 * Which participation row(s) a single roster-modal edit writes to.
 *
 * Per-day / per-session events store ONE row per (member, session) — the
 * `session_id` is part of the row's identity, backed by migration 246's partial
 * uniques. So a roster edit is never "the member's row for this event": it is
 * the row for the day being edited, or every day at once on the Overall tab.
 *
 * `row: null` means nothing exists yet for that day → the caller must CREATE
 * with `sessionId` attached. Omitting it writes a session-less row that no
 * per-day view can see (they all key off `session_id`), which reads as "the
 * RSVP never saved" and then 400s on the next attempt.
 */
export interface SessionTarget {
  /** Session this target writes to; null for whole-event / non-session activities. */
  sessionId: string | null
  row: Participation | null
}

export interface SessionTargetOptions {
  /** True on the Overall tab of a session event — one edit fans out to every day. */
  isOverall: boolean
  /** Session tab currently open, or null (Overall tab / non-session activity). */
  activeSessionId: string | null
  /** All sessions of the event. Only consulted when `isOverall`. */
  sessions?: Array<{ id: string }>
}

const sameSession = (p: Participation, sessionId: string) => String(p.session_id ?? '') === String(sessionId)

/**
 * Resolve the targets for `memberId`.
 *
 * Off the Overall tab this is exactly one target — scoped to `activeSessionId`
 * when a day tab is open. That scoping matters: the roster's club-wide fetch is
 * NOT session-filtered, so an unscoped lookup would hand back another day's row
 * and the edit would silently land on the wrong day.
 */
export function resolveSessionTargets(
  memberId: string,
  participations: Participation[],
  { isOverall, activeSessionId, sessions }: SessionTargetOptions,
): SessionTarget[] {
  if (!isOverall) {
    return [{
      sessionId: activeSessionId,
      row: participations.find(p =>
        p.member === memberId
        && (!activeSessionId || sameSession(p, activeSessionId))) ?? null,
    }]
  }
  return (sessions ?? []).map(s => ({
    sessionId: String(s.id),
    row: participations.find(p => p.member === memberId && sameSession(p, s.id)) ?? null,
  }))
}

/**
 * Targets whose status actually has to change — empty means the edit is a
 * no-op. On the Overall tab a PARTIAL match still writes, so days that disagree
 * are brought in line with the pick.
 */
export function statusWrites(targets: SessionTarget[], newStatus: string): SessionTarget[] {
  return targets.filter(({ row }) => newStatus !== (row?.status ?? ''))
}

/**
 * Targets whose note has to change.
 *
 * A no-op when a row is already explicitly empty and the user typed empty, or
 * when the typed value matches byte-for-byte. We DO write when the saved note
 * is null/undefined and the user explicitly typed empty — that stores `''`, so
 * the display stops falling back to the absence reason. A target with no row is
 * created only if something was actually typed: empty input on a never-RSVPed
 * player has nothing to clear.
 */
export function noteWrites(targets: SessionTarget[], trimmedNote: string): SessionTarget[] {
  return targets.filter(({ row }) => {
    if (!row) return trimmedNote !== ''
    const saved = row.note ?? null
    if (trimmedNote === '' && saved === '') return false
    if (trimmedNote !== '' && trimmedNote === saved) return false
    return true
  })
}

/**
 * The value every target shares, or `''` when they disagree — what the edit
 * controls prefill with. Mixed days must NOT prefill: for the status dropdown
 * it would pretend one day speaks for all, and for the note box a value only
 * one day carries would get copied onto every day on blur.
 */
export function uniformValue(targets: SessionTarget[], key: 'status' | 'note'): string {
  const first = targets[0]?.row?.[key] ?? ''
  return targets.every(({ row }) => (row?.[key] ?? '') === first) ? first : ''
}

/** True only when EVERY target is already confirmed (suppresses the late-signin prompt). */
export function allConfirmed(targets: SessionTarget[]): boolean {
  return targets.length > 0 && targets.every(({ row }) => row?.status === 'confirmed')
}
