/**
 * Auth context + the `useAuth` hook (imported ~100 places).
 *
 * The provider COMPONENT lives in `hooks/AuthProvider.tsx` — a module may export
 * either React components or non-components, not both (react-refresh /
 * Fast Refresh). This file therefore exports only the context, the types and the
 * hook.
 */

import { createContext, useContext } from 'react'
import type { Member } from '../types'

// ── Types ───────────────────────────────────────────────────────────

export type MemberUser = Member & { id: string }

export interface AuthContextValue {
  user: MemberUser | null
  /** A superadmin is currently viewing the app as another member (read-only). */
  isImpersonating: boolean
  /** The real logged-in superadmin may start a read-only "View as" session. */
  canImpersonate: boolean
  /** The actual logged-in member — unchanged while impersonating. */
  realUser: MemberUser | null
  /** Start a read-only "View as <member>" session (superadmin only). */
  startImpersonation: (memberId: string) => Promise<void>
  /** Exit the read-only "View as" session and restore the real identity. */
  stopImpersonation: () => Promise<void>
  isSuperAdmin: boolean
  isAdmin: boolean
  isGlobalAdmin: boolean
  isVbAdmin: boolean
  isBbAdmin: boolean
  hasAdminAccessToSport: (sport: 'volleyball' | 'basketball') => boolean
  hasAdminAccessToTeam: (teamId: string) => boolean
  isApproved: boolean
  isProfileComplete: boolean
  isCoach: boolean
  isCoachOf: (teamId: string) => boolean
  canParticipateIn: (teamId: string) => boolean
  isStaffOnly: (teamId: string) => boolean
  /** Staff-only across a multi-team activity — see AuthProvider. */
  isStaffOnlyForTeams: (teamIds: string[]) => boolean
  coachTeamIds: string[]
  coachTeamNames: string[]
  teamResponsibleIds: string[]
  captainTeamIds: string[]
  spielplanerTeamIds: string[]
  is_spielplaner: boolean
  matchesRole: (role: string) => boolean
  memberTeamIds: string[]
  memberTeamNames: string[]
  teamsLoading: boolean
  memberSports: Set<'volleyball' | 'basketball'>
  primarySport: 'volleyball' | 'basketball' | 'both'
  canViewTeam: (teamId: string) => boolean
  isVorstand: boolean
  /** Member has the orthogonal 'finance' role (treasurer / finance team). */
  isFinance: boolean
  /** May open the club-finance dashboard — board OR finance role. */
  canAccessFinance: boolean
  getGuestLevel: (teamId: string) => number
  isGuestIn: (teamId: string) => boolean
  isLoading: boolean
  login: (email: string, password: string, turnstileToken?: string) => Promise<void>
  logout: () => void
  /** Re-derive team context (member/coach team ids etc.) after a membership
   *  change — e.g. leaving a team — without a full page reload. */
  refreshTeamContext: () => Promise<void>
  /** Re-fetch the current member record (e.g. after a profile edit / new
   *  photo) so the UI updates without a full page reload. */
  refreshUser: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
