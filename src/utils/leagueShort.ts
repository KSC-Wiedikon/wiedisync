import { detectCupMatch } from '../modules/spielplanung/gameChipUtils'

/**
 * Shortens Swiss Volley league names for compact display.
 *
 * Examples:
 *   "Herren 2. Liga"              → "2LM"
 *   "Frauen 3. Liga Gruppe B"     → "3LD - B"
 *   "Herren 4. Liga Gruppe A"     → "4LM - A"
 *   "Frauen 5. Liga Gruppe B"     → "5LD - B"
 *   "Frauen U23 1. Liga"          → "U23D 1L"
 *   "Frauen U23 2. Liga"          → "U23D 2L"
 *   "Männer U23 Gruppe A"         → "U23M - A"
 *   "SM Quali U23"                → "SM Quali U23"
 */
export function leagueShort(league: string): string {
  if (!league) return ''

  // Detect gender: M = Herren/Männer, D = Frauen/Damen
  let gender = ''
  if (/Herren|Männer/i.test(league)) gender = 'M'
  else if (/Frauen|Damen/i.test(league)) gender = 'D'

  // Detect group suffix: "Gruppe A" → "- A"
  const groupMatch = league.match(/Gruppe\s+(\S+)/i)
  const group = groupMatch ? ` - ${groupMatch[1]}` : ''

  // U23 pattern
  if (/U23/i.test(league)) {
    const ligaMatch = league.match(/(\d+)\.\s*Liga/i)
    const ligaSuffix = ligaMatch ? ` ${ligaMatch[1]}L` : ''
    return `U23${gender}${ligaSuffix}${group}`
  }

  // Standard league: "N. Liga" → "NL"
  const ligaMatch = league.match(/(\d+)\.\s*Liga/i)
  if (ligaMatch) {
    return `${ligaMatch[1]}L${gender}${group}`
  }

  // Fallback: strip em-dash separators for compact display
  return league.replace(/\s*—\s*/g, '\n')
}

/**
 * Tighter label for the activity-row date rail (one fixed narrow width):
 * the team name beside it already says the gender, so it is left out.
 *
 *   "Männer 3. Liga Gruppe A"                 → "3L"
 *   "Frauen U23 1. Liga"                      → "U23 1L"
 *   "Männer U23 1. Stärkeklasse"              → "U23 1SK"
 *   "Männer U20"                              → "U20"
 *   "Mobiliar Volley Cup — Runde 1, Spiel 28" → "SV Cup"
 *   "Züri Cup — Runde 3, Spiel 1"             → "Züri Cup"
 *   "1LRAF" / "HU18A"                         → unchanged (already codes)
 */
export function leagueRailLabel(league: string | null | undefined): string {
  if (!league) return ''
  const cup = detectCupMatch(league)
  if (cup === 'gold') return 'SV Cup'
  if (cup === 'silver') return 'Züri Cup'

  const youth = league.match(/\bU\d{2}\b/i)?.[0].toUpperCase()
  const level = league.match(/(\d+)\.\s*(Liga|Stärkeklasse)/i)
  if (level) {
    const tier = `${level[1]}${/liga/i.test(level[2]) ? 'L' : 'SK'}`
    return youth ? `${youth} ${tier}` : tier
  }
  return league.replace(/^(Herren|Männer|Frauen|Damen)\s+/i, '').replace(/\s*—.*$/, '').trim()
}

/**
 * The federation's match number for the rail ("#406803"), from games.game_id:
 * `vb_406803` → "406803", `bb_26-04956` → "26-04956". Manual games and
 * Basketplan tournament days carry an internal key, not a number — none.
 */
export function gameNumberLabel(gameId: string | null | undefined): string {
  const m = gameId?.match(/^(?:vb|bb)_(.+)$/)
  return m ? m[1] : ''
}
