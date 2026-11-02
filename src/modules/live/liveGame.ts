// Pure halves of useLiveReferees — which fixture a live board shows. Kept out of the
// hook so vitest's node environment can test them without the API client.

export interface LiveGameCandidate {
  id: number | string
  home_team: string | null
  away_team: string | null
  referees_json?: Array<{ name?: string | null }> | string | null
}

/** "KSC WIEDIKON D1" ≡ "KSC Wiedikon D1", "Rämi" ≡ "Rami" — board names are typed by hand. */
export function normaliseTeamName(name: string | null | undefined): string {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * The game whose two teams are the board's two teams, in either order (the board's
 * left side is not always the home team). Null unless exactly one game matches —
 * a guess between two fixtures would put the wrong referees on the page.
 */
export function matchGameByTeams<T extends LiveGameCandidate>(games: readonly T[], teamA: string, teamB: string): T | null {
  const a = normaliseTeamName(teamA)
  const b = normaliseTeamName(teamB)
  if (!a || !b) return null
  const hits = games.filter((g) => {
    const h = normaliseTeamName(g.home_team)
    const w = normaliseTeamName(g.away_team)
    return (h === a && w === b) || (h === b && w === a)
  })
  return hits.length === 1 ? hits[0] : null
}

/** `referees_json` ({name, id}[], filled by the Swiss Volley sync) → the names, in order. */
export function refereeNames(raw: LiveGameCandidate['referees_json']): string[] {
  let list: unknown = raw
  if (typeof list === 'string') {
    try { list = JSON.parse(list) } catch { return [] }
  }
  if (!Array.isArray(list)) return []
  return list
    .map((r) => (r && typeof r === 'object' ? String((r as { name?: unknown }).name ?? '').trim() : ''))
    .filter(Boolean)
}
