import type { Game } from '../../types'

export type CupKind = 'gold' | 'silver' | null

export function detectCupMatch(league: string | null | undefined): CupKind {
  const l = (league ?? '').toLowerCase()
  if (l.includes('swiss volley cup') || l.includes('mobiliar volley cup') || l.includes('schweizer cup')) return 'gold'
  if (l.includes('züri cup') || l.includes('zueri cup') || l.includes('zuri cup')) return 'silver'
  return null
}

export function opponentName(game: Pick<Game, 'type' | 'home_team' | 'away_team'>): string {
  return game.type === 'home' ? game.away_team : game.home_team
}
