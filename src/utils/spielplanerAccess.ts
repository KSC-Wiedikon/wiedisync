/**
 * Spielplanung access rule (pure, no React).
 *
 * Lives apart from `components/SpielplanerOrAdminRoute.tsx` so that file only
 * exports the route component — react-refresh/only-export-components (Fast
 * Refresh) requires a module to export either components or non-components, not
 * both.
 */

export interface SpielplanerAccess {
  isAdmin: boolean
  is_spielplaner: boolean
  spielplanerTeamIds: string[]
  /** v1 read-only planner access: coaches/TRs may VIEW their teams' schedule
   *  (mutations stay spielplaner/admin-only — see editableTeamIds). */
  coachTeamIds: string[]
  teamResponsibleIds: string[]
}

export function canAccessSpielplanung(auth: SpielplanerAccess): boolean {
  return (
    auth.isAdmin ||
    auth.is_spielplaner ||
    auth.spielplanerTeamIds.length > 0 ||
    auth.coachTeamIds.length > 0 ||
    auth.teamResponsibleIds.length > 0
  )
}
