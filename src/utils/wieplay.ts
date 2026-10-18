/**
 * WiePlay, the club's video analysis app (repo KSC-Wiedikon/wieplay, PLAN §4.4): a game card
 * links to WiePlay's page for the game (`/games/<id>`), which opens its video.
 */

/**
 * Does this game card get a "Video" link? Only for a team that uses WiePlay
 * (`teams.wieplay_enabled`, set by WiePlay's hourly sync), for a viewer WiePlay would show the
 * video to as far as Wiedisync knows (on the team, or an admin of it), and only once the game
 * is played or played today: videos exist after a game. Not for a cancelled or postponed game.
 */
export function showsWieplayLink(
  game: { date?: string | null; status?: string | null },
  { teamUsesWieplay, viewerOnTeam, today }: { teamUsesWieplay: boolean; viewerOnTeam: boolean; today: string },
): boolean {
  if (!teamUsesWieplay || !viewerOnTeam) return false
  if (game.status === 'cancelled' || game.status === 'postponed') return false
  const day = (game.date ?? '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today
}
