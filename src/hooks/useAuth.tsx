import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react'
import { readMe } from '@directus/sdk'
import { toast } from 'sonner'
import { client, login as apiLogin, logout as apiLogout, refreshAuth, isAuthenticated, setCurrentMemberId, setImpersonating, fetchItems, fetchAllItems, kscwApi } from '../lib/api'
import { queryClient } from '../lib/query'
import { setSentryUser, captureAuthError, captureApiError, addBreadcrumb } from '../lib/sentry'
import i18n from '../i18n'
import { backendLangToI18n } from '../utils/languageMap'
import { getCurrentSeason } from '../utils/dateHelpers'
import { LICENCE_TYPES } from '../types'
import type { Member, Team, LicenceType } from '../types'

// ── Types ───────────────────────────────────────────────────────────

type MemberUser = Member & { id: string }

/** Base roles carried on `members.role` — typed off the Member enum so a renamed
 *  role fails at compile time instead of silently never matching. */
type BaseRole = Member['role'][number]
const BASE_ROLES: readonly BaseRole[] = ['vorstand', 'admin', 'vb_admin', 'bb_admin', 'superuser', 'finance']
const isBaseRole = (r: string): r is BaseRole => (BASE_ROLES as readonly string[]).includes(r)
const isLicenceFlag = (r: string): r is LicenceType => (LICENCE_TYPES as readonly string[]).includes(r)

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

const AuthContext = createContext<AuthContextValue | null>(null)

// Persists a read-only "View as" target across reloads (session-scoped).
const IMPERSONATE_KEY = 'wiedisync-impersonate'

// ── Provider ────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  // `realUser` is the actual logged-in member; `impersonatedMember` is set only
  // while a superadmin is viewing the app "as" someone else (read-only). The
  // whole app derives identity from `user` = the effective (impersonated ??
  // real) member, so every screen renders exactly what that member would see.
  const [realUser, setRealUser] = useState<MemberUser | null>(null)
  const [impersonatedMember, setImpersonatedMember] = useState<MemberUser | null>(null)
  const user = impersonatedMember ?? realUser
  // True only while a session restore is actually running. With no auth-hint
  // cookie there is nothing to restore (the init effect below bails out), so it
  // starts false rather than flipping to false from inside that effect — every
  // consumer already gates on `isAuthenticated()` / `user`, so the value seen is
  // the same, just one render earlier.
  const [isLoading, setIsLoading] = useState(() => isAuthenticated())

  const [coachTeamIds, setCoachTeamIds] = useState<string[]>([])
  const [coachTeamNames, setCoachTeamNames] = useState<string[]>([])
  const [memberTeamIds, setMemberTeamIds] = useState<string[]>([])
  const [memberTeamNames, setMemberTeamNames] = useState<string[]>([])
  const [memberSports, setMemberSports] = useState<Set<'volleyball' | 'basketball'>>(new Set())
  const [teamSportById, setTeamSportById] = useState<Record<string, 'volleyball' | 'basketball'>>({})
  const [guestLevelByTeam, setGuestLevelByTeam] = useState<Record<string, number>>({})
  const [teamResponsibleIds, setTeamResponsibleIds] = useState<string[]>([])
  const [captainTeamIds, setCaptainTeamIds] = useState<string[]>([])
  const [spielplanerTeamIds, setSpielplanerTeamIds] = useState<string[]>([])
  const [isSpielplaner, setIsSpielplaner] = useState(false)
  const [teamsReady, setTeamsReady] = useState(false)
  const teamsLoading = !!user && !teamsReady

  // ── Fetch current member from Directus user ─────────────────────

  const fetchMember = useCallback(async (): Promise<MemberUser | null> => {
    try {
      const me = await client.request(readMe({ fields: ['id'] }))
      if (!me?.id) return null
      const members = await fetchItems<MemberUser>('members', {
        filter: { user: { _eq: me.id } },
        limit: 1,
      })
      return members[0] ?? null
    } catch {
      return null
    }
  }, [])

  // ── Load team context (single parallel fetch) ───────────────────

  const loadTeamContext = useCallback(async (memberId: string | number) => {
    try {
      // allSettled (not all): one failing query must NOT zero every role/team.
      // A rejected query degrades only its own dimension to [] and is logged;
      // the others still populate (previously a single transient failure made
      // the user look like they had no teams/roles at all).
      const settled = await Promise.allSettled([
        fetchAllItems<{ teams_id: number }>('teams_coaches', {
          filter: { members_id: { _eq: memberId } },
          fields: ['teams_id'],
        }),
        fetchAllItems<{ teams_id: number }>('teams_responsibles', {
          filter: { members_id: { _eq: memberId } },
          fields: ['teams_id'],
        }),
        fetchAllItems<{ team: number; guest_level: number }>('member_teams', {
          filter: { member: { _eq: memberId }, season: { _eq: getCurrentSeason() } },
          fields: ['team', 'guest_level'],
        }),
        fetchAllItems<Pick<Team, 'id' | 'name' | 'sport'>>('teams', {
          filter: { active: { _eq: true } },
          fields: ['id', 'name', 'sport'],
        }),
        // Captain is M2O on teams — filter teams where captain = this member
        fetchAllItems<{ id: number }>('teams', {
          filter: { captain: { _eq: memberId }, active: { _eq: true } },
          fields: ['id'],
        }),
        fetchAllItems<{ kscw_team: number }>('spielplaner_assignments', {
          filter: { member: { _eq: memberId } },
          fields: ['kscw_team'],
        }),
      ])
      const pick = <T,>(i: number, collection: string): T[] => {
        const r = settled[i]
        if (r.status === 'fulfilled') return r.value as T[]
        captureApiError(r.reason, { operation: 'loadTeamContext', collection })
        return []
      }
      const coachRows = pick<{ teams_id: number }>(0, 'teams_coaches')
      const trRows = pick<{ teams_id: number }>(1, 'teams_responsibles')
      const memberTeams = pick<{ team: number; guest_level: number }>(2, 'member_teams')
      const allTeams = pick<Pick<Team, 'id' | 'name' | 'sport'>>(3, 'teams')
      const captainTeams = pick<{ id: number }>(4, 'teams (captain)')
      const spielplanerRows = pick<{ kscw_team: number }>(5, 'spielplaner_assignments')

      const teamMap = new Map(allTeams.map(t => [String(t.id), t]))
      // Skip rows with null team FKs — they shouldn't exist, but if a coach/TR/member_teams row
      // is partially populated, `String(null)` = "null" pollutes _in arrays and trips Directus'
      // `Invalid numeric value` on integer-typed kscw_team filters.
      const coachTeamIdsRaw = coachRows.map(r => r.teams_id).filter((id): id is number => id != null)
      const trTeamIdsRaw = trRows.map(r => r.teams_id).filter((id): id is number => id != null)
      const memberTeamIdsRaw = memberTeams.map(mt => mt.team).filter((id): id is number => id != null)
      const captainTeamIdsRaw = captainTeams.map(t => t.id).filter((id): id is number => id != null)
      const coachIdSet = new Set([...coachTeamIdsRaw.map(String), ...trTeamIdsRaw.map(String)])

      // Intersect coach/TR/spielplaner ids with the ACTIVE team map. The
      // member_teams + captain queries already scope to current season / active,
      // but teams_coaches / teams_responsibles / spielplaner_assignments have no
      // season column and are CLONED (not moved) on rollover — so after an
      // archive/rollover these junctions still point at the archived team.
      // teamMap holds only active teams; dropping ids not in it keeps these
      // lists consistent with captain/member handling and stops stale archived
      // ids leaking into every coach-scoped view (TrainingsPage auto-select,
      // GamesPage dashboard, HomePage filters).
      const activeCoachIds = [...coachIdSet].filter(id => teamMap.has(id))
      setCoachTeamIds(activeCoachIds)
      setCoachTeamNames(activeCoachIds.map(id => teamMap.get(id)?.name).filter((n): n is string => !!n))
      setTeamResponsibleIds(trTeamIdsRaw.map(String).filter(id => teamMap.has(id)))
      setCaptainTeamIds(captainTeamIdsRaw.map(String))
      setSpielplanerTeamIds(
        spielplanerRows.map(r => r.kscw_team).filter((id): id is number => id != null).map(String).filter(id => teamMap.has(id)),
      )
      setMemberTeamIds(memberTeamIdsRaw.map(String))
      setMemberTeamNames(memberTeamIdsRaw.map(id => teamMap.get(String(id))?.name).filter((n): n is string => !!n))

      const sports = new Set<'volleyball' | 'basketball'>()
      for (const mt of memberTeams) {
        if (mt.team == null) continue
        const s = teamMap.get(String(mt.team))?.sport
        if (s === 'volleyball' || s === 'basketball') sports.add(s)
      }
      setMemberSports(sports)

      const glMap: Record<string, number> = {}
      for (const mt of memberTeams) {
        if (mt.team == null) continue
        glMap[String(mt.team)] = mt.guest_level ?? 0
      }
      setGuestLevelByTeam(glMap)

      const sportById: Record<string, 'volleyball' | 'basketball'> = {}
      for (const t of allTeams) {
        if (t.sport === 'volleyball' || t.sport === 'basketball') sportById[String(t.id)] = t.sport
      }
      setTeamSportById(sportById)
      setTeamsReady(true)
    } catch (err) {
      captureApiError(err, { operation: 'loadTeamContext', collection: 'member_teams' })
      setTeamsReady(true)
    }
  }, [])

  // ── Init ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isAuthenticated()) return
    ;(async () => {
      try {
        await refreshAuth()
        const member = await fetchMember()
        if (member) {
          setRealUser(member)
          setIsSpielplaner(!!member.is_spielplaner)
          setCurrentMemberId(member.id)
          addBreadcrumb('auth.init', { memberId: member.id })
          setSentryUser({ id: member.id, displayName: [member.first_name, member.last_name].filter(Boolean).join(' ').trim() || undefined })
          await loadTeamContext(member.id)
          // Restore a read-only "View as" session across reloads (superadmin only).
          const impId = sessionStorage.getItem(IMPERSONATE_KEY)
          if (impId && Array.isArray(member.role) && member.role.includes('superuser') && String(impId) !== String(member.id)) {
            try {
              const [target] = await fetchItems<MemberUser>('members', { filter: { id: { _eq: impId } }, limit: 1 })
              if (target) {
                setImpersonating(true)
                setImpersonatedMember(target)
                setCurrentMemberId(target.id)
                setTeamsReady(false)
                await loadTeamContext(target.id)
              } else {
                sessionStorage.removeItem(IMPERSONATE_KEY)
              }
            } catch { sessionStorage.removeItem(IMPERSONATE_KEY) }
          }
        } else {
          // Token refreshed but no linked member — clear auth
          await apiLogout()
        }
      } catch (err) {
        captureAuthError(err, { action: 'session_restore' })
        // Refresh failed — token is stale/invalid, clear everything
        await apiLogout()
        // Force reload to clear SDK internal state
        window.location.reload()
        return
      } finally {
        setIsLoading(false)
      }
    })()
  }, [fetchMember, loadTeamContext])

  // Sync i18n to the REAL operator's language — a superadmin viewing "as" a
  // member keeps their own UI language rather than being flipped to the
  // impersonated member's (which could trap them in a language they don't read).
  useEffect(() => {
    if (realUser?.language) {
      const lang = backendLangToI18n(realUser.language)
      if (i18n.language !== lang) { i18n.changeLanguage(lang); localStorage.setItem('wiedisync-lang', lang) }
    }
  }, [realUser?.language])

  // Enrich Sentry user context once user + teams are fully loaded
  useEffect(() => {
    if (!user || !teamsReady) return
    setSentryUser({
      id: user.id,
      displayName: [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || undefined,
      roles: Array.isArray(user.role) ? user.role : [],
      memberTeamIds,
      coachTeamIds,
      primarySport: memberSports.size === 1 ? [...memberSports][0] : 'both',
      isAdmin: Array.isArray(user.role) && (
        user.role.includes('admin') || user.role.includes('superuser') ||
        user.role.includes('vb_admin') || user.role.includes('bb_admin')
      ),
    })
  }, [user, teamsReady, memberTeamIds, coachTeamIds, memberSports])

  // ── Actions ─────────────────────────────────────────────────────

  const login = useCallback(async (email: string, password: string) => {
    addBreadcrumb('auth.login_attempt')
    await apiLogin(email, password)
    const member = await fetchMember()
    if (member) {
      setRealUser(member)
      setIsSpielplaner(!!member.is_spielplaner)
      setCurrentMemberId(member.id)
      addBreadcrumb('auth.login_success', { memberId: member.id })
      setSentryUser({ id: member.id, displayName: [member.first_name, member.last_name].filter(Boolean).join(' ').trim() || undefined })
      await loadTeamContext(member.id)
    }
  }, [fetchMember, loadTeamContext])

  const logout = useCallback(() => {
    apiLogout()
    setImpersonating(false)
    setImpersonatedMember(null)
    sessionStorage.removeItem(IMPERSONATE_KEY)
    setCurrentMemberId(null)
    setSentryUser(null)
    setRealUser(null)
    setCoachTeamIds([]); setCoachTeamNames([])
    setTeamResponsibleIds([]); setCaptainTeamIds([])
    setSpielplanerTeamIds([])
    setIsSpielplaner(false)
    setMemberTeamIds([]); setMemberTeamNames([])
    setMemberSports(new Set()); setGuestLevelByTeam({}); setTeamSportById({})
    setTeamsReady(false)
    queryClient.clear()
  }, [])

  const refreshTeamContext = useCallback(async () => {
    if (user?.id) await loadTeamContext(user.id)
  }, [user, loadTeamContext])

  const refreshUser = useCallback(async () => {
    const member = await fetchMember()
    if (member) setRealUser(member)
  }, [fetchMember])

  // ── Read-only impersonation ("View as member", superadmin only) ──
  const startImpersonation = useCallback(async (memberId: string) => {
    if (!(realUser?.role ?? []).includes('superuser')) return
    if (String(realUser?.id) === String(memberId)) return // no self-impersonation
    let target: MemberUser | null
    try {
      const rows = await fetchItems<MemberUser>('members', { filter: { id: { _eq: memberId } }, limit: 1 })
      target = rows[0] ?? null
    } catch { target = null }
    if (!target) { toast.error(i18n.t('common:error')); return }
    // Audit BEFORE flipping the read-only flag (this POST is a legitimate write).
    try {
      await kscwApi('/admin/impersonate', {
        method: 'POST',
        body: { action: 'start', target: target.id, target_name: [target.first_name, target.last_name].filter(Boolean).join(' ').trim() },
      })
    } catch { /* audit is best-effort — never block the view */ }
    setImpersonating(true)
    setImpersonatedMember(target)
    setCurrentMemberId(target.id)
    sessionStorage.setItem(IMPERSONATE_KEY, String(target.id))
    addBreadcrumb('auth.impersonate_start', { target: target.id })
    setTeamsReady(false)
    await loadTeamContext(target.id)
  }, [realUser, loadTeamContext])

  const stopImpersonation = useCallback(async () => {
    const target = impersonatedMember
    setImpersonating(false)
    setImpersonatedMember(null)
    sessionStorage.removeItem(IMPERSONATE_KEY)
    addBreadcrumb('auth.impersonate_stop', target ? { target: target.id } : {})
    if (realUser?.id) {
      setCurrentMemberId(realUser.id)
      setTeamsReady(false)
      await loadTeamContext(realUser.id)
    }
    if (target) {
      try { await kscwApi('/admin/impersonate', { method: 'POST', body: { action: 'stop', target: target.id } }) } catch { /* best-effort */ }
    }
  }, [impersonatedMember, realUser, loadTeamContext])

  // ── Derived ─────────────────────────────────────────────────────

  const roles = user?.role ?? []
  const isImpersonating = !!impersonatedMember
  // Gate the "View as" trigger on the REAL operator's role, so it stays correct
  // regardless of who is being impersonated.
  const canImpersonate = (realUser?.role ?? []).includes('superuser')
  const isSuperAdmin = roles.includes('superuser')
  const isGlobalAdmin = roles.includes('admin') || isSuperAdmin
  const isVbAdmin = roles.includes('vb_admin')
  const isBbAdmin = roles.includes('bb_admin')
  const isAdmin = isGlobalAdmin || isVbAdmin || isBbAdmin
  const isApproved = user?.coach_approved_team === true || isAdmin || memberTeamIds.length > 0 || coachTeamIds.length > 0
  const isProfileComplete = !!user?.language && !!user?.first_name
  const isVorstand = roles.includes('vorstand') || isGlobalAdmin
  // 'finance' is an orthogonal role (treasurer / finance team). Global admins
  // implicitly have it; the finance dashboard opens for board OR finance.
  const isFinance = roles.includes('finance') || isGlobalAdmin
  const canAccessFinance = isVorstand || isFinance
  const isCoach = coachTeamIds.length > 0 || isGlobalAdmin
  const primarySport: 'volleyball' | 'basketball' | 'both' =
    memberSports.size === 1 ? [...memberSports][0] : 'both'

  const hasAdminAccessToSport = useCallback(
    (sport: 'volleyball' | 'basketball') => isGlobalAdmin || (sport === 'volleyball' ? isVbAdmin : isBbAdmin),
    [isGlobalAdmin, isVbAdmin, isBbAdmin],
  )
  const hasAdminAccessToTeam = useCallback(
    (teamId: string) => {
      const sport = teamSportById[teamId]
      return !sport ? isGlobalAdmin : hasAdminAccessToSport(sport)
    },
    [teamSportById, isGlobalAdmin, hasAdminAccessToSport],
  )
  const isCoachOf = useCallback(
    (teamId: string) => hasAdminAccessToTeam(teamId) || coachTeamIds.includes(teamId),
    [hasAdminAccessToTeam, coachTeamIds],
  )
  const canParticipateIn = useCallback(
    (teamId: string) => memberTeamIds.includes(teamId) || coachTeamIds.includes(teamId),
    [memberTeamIds, coachTeamIds],
  )
  const isStaffOnly = useCallback(
    (teamId: string) => teamsReady && coachTeamIds.includes(teamId) && !memberTeamIds.includes(teamId),
    [coachTeamIds, memberTeamIds, teamsReady],
  )
  const canViewTeam = useCallback(
    (teamId: string) => hasAdminAccessToTeam(teamId) || coachTeamIds.includes(teamId) || memberTeamIds.includes(teamId),
    [hasAdminAccessToTeam, coachTeamIds, memberTeamIds],
  )
  const getGuestLevel = useCallback((teamId: string) => guestLevelByTeam[teamId] ?? 0, [guestLevelByTeam])
  const isGuestIn = useCallback((teamId: string) => getGuestLevel(teamId) > 0, [getGuestLevel])

  const matchesRole = useCallback((role: string): boolean => {
    if (!user) return false
    if (isBaseRole(role)) {
      return (user.role ?? []).includes(role)
    }
    if (role === 'coach') return coachTeamIds.length > 0
    if (role === 'team_responsible') return teamResponsibleIds.length > 0
    if (role === 'captain') return captainTeamIds.length > 0
    if (isLicenceFlag(role)) {
      // Migration 067: licences are now per-flag booleans on the user record.
      return user[role] === true
    }
    if (role === 'is_spielplaner') return isSpielplaner
    return false
  }, [user, coachTeamIds, teamResponsibleIds, captainTeamIds, isSpielplaner])

  const value = useMemo<AuthContextValue>(() => ({
    user, isImpersonating, canImpersonate, realUser, startImpersonation, stopImpersonation,
    isSuperAdmin, isAdmin, isGlobalAdmin, isVbAdmin, isBbAdmin,
    hasAdminAccessToSport, hasAdminAccessToTeam, isApproved, isProfileComplete,
    isCoach, isCoachOf, canParticipateIn, isStaffOnly, coachTeamIds, coachTeamNames,
    teamResponsibleIds, captainTeamIds, spielplanerTeamIds, is_spielplaner: isSpielplaner, matchesRole,
    memberTeamIds, memberTeamNames, teamsLoading, memberSports, primarySport,
    canViewTeam, isVorstand, isFinance, canAccessFinance, getGuestLevel, isGuestIn, isLoading, login, logout,
    refreshTeamContext, refreshUser,
  }), [
    user, isImpersonating, canImpersonate, realUser, startImpersonation, stopImpersonation,
    isSuperAdmin, isAdmin, isGlobalAdmin, isVbAdmin, isBbAdmin,
    hasAdminAccessToSport, hasAdminAccessToTeam, isApproved, isProfileComplete,
    isCoach, isCoachOf, canParticipateIn, isStaffOnly, coachTeamIds, coachTeamNames,
    teamResponsibleIds, captainTeamIds, spielplanerTeamIds, isSpielplaner, matchesRole,
    memberTeamIds, memberTeamNames, teamsLoading, memberSports, primarySport,
    canViewTeam, isVorstand, isFinance, canAccessFinance, getGuestLevel, isGuestIn, isLoading, login, logout,
    refreshTeamContext, refreshUser,
  ])

  // The boot spinner now lives in a single <BootOverlay/> (rendered once at the
  // top of the app) that masks the whole app during session restore AND page
  // load — one continuous spinner instead of this block + Layout's separate one.
  // BootOverlay's authBooting (isAuthenticated() && isLoading) covers the restore
  // window, and Layout/AuthRoute gate their content on the same auth state, so
  // nothing unauthenticated flashes underneath the overlay.
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
