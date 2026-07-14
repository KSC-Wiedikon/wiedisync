import type { Game, Hall, Team } from '../../../types'
import { getBlockWindow, blocksOverlap } from './gameBlock'
import { hallsIntersect } from '../../../utils/gameHalls'

export interface ConflictMessage {
  kind: 'same_team_same_day' | 'hall_overlap' | 'same_team_within_two_days' | 'club_blocked'
  /** i18n key suffix under spielplanung:conflict.*. */
  messageKey: string
  /** Conflicting existing game's id — useful for linking back. `club_blocked` has
   *  no counterpart game, so it carries the sentinel 'club-block'. */
  conflictingId: string | number
  /** Optional context values for i18n interpolation. */
  context?: Record<string, string | number>
}

export interface ConflictCheckResult {
  errors: ConflictMessage[]
  warnings: ConflictMessage[]
}

interface Candidate {
  /** Set when editing an existing row — excluded from collision check. */
  editingId?: string | number
  kscw_team: string | number
  hall?: string | number | null
  additional_halls?: string[] | null
  date: string // YYYY-MM-DD
  time: string // HH:MM
  type: 'home' | 'away'
}

function daysBetween(d1: string, d2: string): number {
  const t1 = new Date(d1 + 'T00:00:00').getTime()
  const t2 = new Date(d2 + 'T00:00:00').getTime()
  const diff = Math.abs(t1 - t2) / 86_400_000
  return Math.round(diff)
}

function sameTeam(candidate: Candidate, game: Pick<Game, 'kscw_team'>): boolean {
  // kscw_team may arrive as integer, string, or expanded object — normalise.
  const extract = (v: unknown): string => {
    if (v == null) return ''
    if (typeof v === 'object' && 'id' in (v as Record<string, unknown>)) {
      return String((v as { id: unknown }).id)
    }
    return String(v)
  }
  return extract(candidate.kscw_team) === extract(game.kscw_team)
}

/**
 * Check a candidate manual game against the relevant window of existing games.
 *
 * Rules:
 *   - ERROR `same_team_same_day`: another game for the same kscw_team on the same date
 *   - ERROR `hall_overlap`: another home game whose hall set intersects the
 *     candidate's, with an overlapping 2h45min window (when the candidate is
 *     also a home game — away games have no hall). Handles multi-hall combos
 *     like basketball A+B via `additional_halls`.
 *   - WARNING `same_team_within_two_days`: another game for the same kscw_team on
 *     date ±1 or ±2 (excludes the ±0 case already covered by the same-day error)
 *
 * `allGames` should be pre-scoped by the caller to a ±3 day window around
 * candidate.date to keep the payload small.
 */
export function checkConflicts(
  candidate: Candidate,
  allGames: Game[],
  ctx?: { teams?: Team[]; halls?: Hall[] },
): ConflictCheckResult {
  const errors: ConflictMessage[] = []
  const warnings: ConflictMessage[] = []

  let candidateBlock: ReturnType<typeof getBlockWindow> | null = null
  try {
    candidateBlock = getBlockWindow(candidate.time)
  } catch {
    // Unparseable time → leave candidateBlock null; the hall-overlap check is skipped.
  }

  for (const game of allGames) {
    if (candidate.editingId != null && String(game.id) === String(candidate.editingId)) continue

    // Same team, same day → ERROR
    if (sameTeam(candidate, game) && game.date === candidate.date) {
      errors.push({
        kind: 'same_team_same_day',
        messageKey: 'sameTeamSameDay',
        conflictingId: game.id,
        context: {
          time: game.time ?? '',
          opponent:
            (game.type === 'home' ? game.away_team : game.home_team) ?? '',
        },
      })
    }

    // Hall overlap (home only, any shared hall, same day, overlapping window) → ERROR
    if (
      candidate.type === 'home' &&
      game.type === 'home' &&
      hallsIntersect(candidate, game, ctx) &&
      game.date === candidate.date &&
      candidateBlock &&
      game.time
    ) {
      try {
        const otherBlock = getBlockWindow(game.time)
        if (blocksOverlap(candidateBlock, otherBlock)) {
          errors.push({
            kind: 'hall_overlap',
            messageKey: 'hallOverlap',
            conflictingId: game.id,
            context: {
              time: game.time ?? '',
              endTime: otherBlock.end,
            },
          })
        }
      } catch {
        // ignore unparseable times in existing rows
      }
    }

    // Same team within ±2 days (excluding same day) → WARNING
    if (sameTeam(candidate, game) && game.date !== candidate.date) {
      const diff = daysBetween(candidate.date, game.date)
      if (diff === 1 || diff === 2) {
        warnings.push({
          kind: 'same_team_within_two_days',
          messageKey: 'sameTeamWithinTwoDays',
          conflictingId: game.id,
          context: {
            daysDelta: diff,
            time: game.time ?? '',
            date: game.date,
          },
        })
      }
    }
  }

  return { errors, warnings }
}
