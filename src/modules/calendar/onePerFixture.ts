/**
 * A derby is one fixture stored as two `games` rows, one per KSCW team, under the
 * same `game_id`. A calendar scoped to one team only ever meets one of them; the
 * club-wide calendar meets both, and would draw the same game twice.
 *
 * Keeps one row per fixture: the viewer's own side if there is one, otherwise the
 * home side. A row without a `game_id` is never merged.
 */
export function onePerFixture<T extends { game_id?: string | null; type?: string }>(
  games: T[],
  isOwn: (game: T) => boolean,
): T[] {
  const rank = (game: T) => (isOwn(game) ? 2 : 0) + (game.type === 'home' ? 1 : 0)
  const best = new Map<string, T>()
  for (const game of games) {
    if (!game.game_id) continue
    const current = best.get(game.game_id)
    if (!current || rank(game) > rank(current)) best.set(game.game_id, game)
  }
  return games.filter((game) => !game.game_id || best.get(game.game_id) === game)
}
