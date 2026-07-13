/**
 * Duty-assignment status helpers (pure, no React).
 *
 * Live apart from `ScorerRow.tsx` so that file only exports components —
 * react-refresh/only-export-components (Fast Refresh) requires a module to
 * export either components or non-components, not both.
 */

import type { Game } from '../../../types'

// ── VB helpers ──

export function isVbSeparateMode(game: Game): boolean {
  return !!(game.scorer_duty_team || game.scorer_member || game.scoreboard_duty_team || game.scoreboard_member)
}

export function isVbCombinedMode(game: Game): boolean {
  return !!(game.scorer_scoreboard_duty_team || game.scorer_scoreboard_member)
}

// HU20 home games: scorer + referee (instead of Täfeler). Detected from the
// referee columns; the admin-assign page writes referee_duty_team for HU20.
export function isVbRefereeMode(game: Game): boolean {
  return !!(game.referee_duty_team || game.referee_member)
}

export function hasAnyVbAssignment(game: Game): boolean {
  return !!(game.scorer_member || game.scoreboard_member || game.scorer_scoreboard_member || game.referee_member)
}

function isVbFullyAssigned(game: Game): boolean {
  if (isVbCombinedMode(game)) return !!game.scorer_scoreboard_member
  // Referee mode (HU20): referee only, no scorer/Täfeler. Check before separate.
  if (isVbRefereeMode(game)) return !!game.referee_member
  if (isVbSeparateMode(game)) return !!(game.scorer_member && game.scoreboard_member)
  return false
}

// ── BB helpers ──

export function hasAnyBbAssignment(game: Game): boolean {
  return !!(game.bb_scorer_member || game.bb_timekeeper_member || game.bb_24s_official)
}

function isBbFullyAssigned(game: Game): boolean {
  return !!(game.bb_scorer_member && game.bb_timekeeper_member)
}

// ── Generic helpers ──

export function hasAnyAssignment(game: Game): boolean {
  return hasAnyVbAssignment(game) || hasAnyBbAssignment(game)
}

export function isFullyAssigned(game: Game, sport: 'volleyball' | 'basketball'): boolean {
  return sport === 'basketball' ? isBbFullyAssigned(game) : isVbFullyAssigned(game)
}
