import type { Game, Team } from '../../../types'
import { asObj } from '../../../utils/relations'
import { formatDate, parseDate } from '../../../utils/dateUtils'
import { formatTime } from '../../../utils/dateHelpers'

function hallLine(game: Game): string {
  const hall = asObj<{ name: string; address?: string; city?: string }>(game.hall)
  if (hall) {
    const parts = [hall.name, hall.address, hall.city].filter(Boolean)
    return parts.join(', ')
  }
  const away = game.away_hall_json
  if (away) {
    const parts = [away.name, away.address, away.city].filter(Boolean)
    return parts.join(', ')
  }
  return ''
}

export function formatSvrzClipboard(game: Game): string {
  const team = asObj<Team>(game.kscw_team)
  // Pinned to English (language-independent): this is a functional clipboard
  // string pasted alongside English "Home:/Away:/vs" labels, not a UI label, so
  // it must not follow the viewer's locale (formatDate localizes by default).
  const date = formatDate(parseDate(game.date), 'EEE, d MMM yyyy', 'en')
  const time = game.time ? formatTime(game.time) : ''
  const kscwTeamName = team?.name ?? ''
  const opponent = game.type === 'home' ? game.away_team : game.home_team
  const vs = game.type === 'home' ? `${kscwTeamName} vs ${opponent}` : `${opponent} vs ${kscwTeamName}`
  const hall = hallLine(game)
  const league = [game.league, game.round].filter(Boolean).join(' · ')

  return [
    `${date}${time ? ` · ${time}` : ''}`,
    `${game.type === 'home' ? 'Home' : 'Away'}: ${vs}`,
    hall || null,
    league || null,
  ]
    .filter(Boolean)
    .join('\n')
}
