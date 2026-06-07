import { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo, type ReactNode } from 'react'
import { readMe } from '@directus/sdk'
import { client, login as apiLogin, logout as apiLogout, refreshAuth, isAuthenticated, setCurrentMemberId, API_URL, fetchItems, fetchAllItems } from '../lib/api'
import { queryClient } from '../lib/query'
import { setSentryUser, captureAuthError, captureApiError, addBreadcrumb } from '../lib/sentry'
import i18n from '../i18n'
import { backendLangToI18n } from '../utils/languageMap'
import { getCurrentSeason } from '../utils/dateHelpers'
import type { Member, Team } from '../types'

// ── Types ───────────────────────────────────────────────────────────

type MemberUser = Member & { id: string }

export interface AuthContextValue {
  user: MemberUser | null
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
  getGuestLevel: (teamId: string) => number
  isGuestIn: (teamId: string) => boolean
  isLoading: boolean
  login: (email: string, password: string, turnstileToken?: string) => Promise<void>
  loginWithOAuth: (provider: string) => Promise<void>
  logout: () => void
  /** Re-derive team context (member/coach team ids etc.) after a membership
   *  change — e.g. leaving a team — without a full page reload. */
  refreshTeamContext: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// ── Provider ────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MemberUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Capture whether a token existed at mount time (synchronous, before effects).
  // Stored in a ref so it never changes — used to gate the app during session restore.
  const hadTokenRef = useRef(isAuthenticated())

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
      const [coachRows, trRows, memberTeams, allTeams, captainTeams, spielplanerRows] = await Promise.all([
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

      const teamMap = new Map(allTeams.map(t => [String(t.id), t]))
      // Skip rows with null team FKs — they shouldn't exist, but if a coach/TR/member_teams row
      // is partially populated, `String(null)` = "null" pollutes _in arrays and trips Directus'
      // `Invalid numeric value` on integer-typed kscw_team filters.
      const coachTeamIdsRaw = coachRows.map(r => r.teams_id).filter((id): id is number => id != null)
      const trTeamIdsRaw = trRows.map(r => r.teams_id).filter((id): id is number => id != null)
      const memberTeamIdsRaw = memberTeams.map(mt => mt.team).filter((id): id is number => id != null)
      const captainTeamIdsRaw = captainTeams.map(t => t.id).filter((id): id is number => id != null)
      const coachIdSet = new Set([...coachTeamIdsRaw.map(String), ...trTeamIdsRaw.map(String)])

      setCoachTeamIds([...coachIdSet])
      setCoachTeamNames([...coachIdSet].map(id => teamMap.get(id)?.name).filter((n): n is string => !!n))
      setTeamResponsibleIds(trTeamIdsRaw.map(String))
      setCaptainTeamIds(captainTeamIdsRaw.map(String))
      setSpielplanerTeamIds(
        spielplanerRows.map(r => r.kscw_team).filter((id): id is number => id != null).map(String),
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
    if (!isAuthenticated()) { setIsLoading(false); return }
    ;(async () => {
      try {
        await refreshAuth()
        const member = await fetchMember()
        if (member) {
          setUser(member)
          setIsSpielplaner(!!member.is_spielplaner)
          setCurrentMemberId(member.id)
          addBreadcrumb('auth.init', { memberId: member.id })
          setSentryUser({ id: member.id, displayName: [member.first_name, member.last_name].filter(Boolean).join(' ').trim() || undefined })
          await loadTeamContext(member.id)
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

  // Sync i18n
  useEffect(() => {
    if (user?.language) {
      const lang = backendLangToI18n(user.language)
      if (i18n.language !== lang) { i18n.changeLanguage(lang); localStorage.setItem('wiedisync-lang', lang) }
    }
  }, [user?.language])

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
      setUser(member)
      setIsSpielplaner(!!member.is_spielplaner)
      setCurrentMemberId(member.id)
      addBreadcrumb('auth.login_success', { memberId: member.id })
      setSentryUser({ id: member.id, displayName: [member.first_name, member.last_name].filter(Boolean).join(' ').trim() || undefined })
      await loadTeamContext(member.id)
    }
  }, [fetchMember, loadTeamContext])

  const loginWithOAuth = useCallback(async (provider: string) => {
    // Issue a freshness sentinel so the callback can reject token params that
    // weren't preceded by an active OAuth attempt (CSRF: tricked-callback URL).
    // The nonce is embedded into the redirect URL we hand to Directus; if
    // Directus preserves our query string when it appends `?access_token=...`,
    // the callback can bind the nonce. (If it strips, the TTL still narrows
    // the window — documented residual gap in SECURITY.md.)
    const nonce = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : String(Date.now()) + ':' + Math.random().toString(36).slice(2)
    try {
      sessionStorage.setItem('oauth_pending', JSON.stringify({ nonce, ts: Date.now(), provider }))
    } catch { /* storage unavailable — degrade open */ }
    const callbackUrl = `${window.location.origin}/auth/callback?state=${encodeURIComponent(nonce)}`
    window.location.href = `${API_URL}/auth/login/${provider}?redirect=${encodeURIComponent(callbackUrl)}`
  }, [])

  const logout = useCallback(() => {
    apiLogout()
    setCurrentMemberId(null)
    setSentryUser(null)
    setUser(null)
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

  // ── Derived ─────────────────────────────────────────────────────

  const roles = user?.role ?? []
  const isSuperAdmin = roles.includes('superuser')
  const isGlobalAdmin = roles.includes('admin') || isSuperAdmin
  const isVbAdmin = roles.includes('vb_admin')
  const isBbAdmin = roles.includes('bb_admin')
  const isAdmin = isGlobalAdmin || isVbAdmin || isBbAdmin
  const isApproved = user?.coach_approved_team === true || isAdmin || memberTeamIds.length > 0 || coachTeamIds.length > 0
  const isProfileComplete = !!user?.language && !!user?.first_name
  const isVorstand = roles.includes('vorstand') || isGlobalAdmin
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
    if (['vorstand', 'admin', 'vb_admin', 'bb_admin', 'superuser'].includes(role)) {
      return (user.role ?? []).includes(role as any)
    }
    if (role === 'coach') return coachTeamIds.length > 0
    if (role === 'team_responsible') return teamResponsibleIds.length > 0
    if (role === 'captain') return captainTeamIds.length > 0
    if (['scorer_vb', 'referee_vb', 'otr1_bb', 'otr2_bb', 'otn_bb', 'referee_bb'].includes(role)) {
      // Migration 067: licences are now per-flag booleans on the user record.
      return (user as any)[role] === true
    }
    if (role === 'is_spielplaner') return isSpielplaner
    return false
  }, [user, coachTeamIds, teamResponsibleIds, captainTeamIds, isSpielplaner])

  const value = useMemo<AuthContextValue>(() => ({
    user, isSuperAdmin, isAdmin, isGlobalAdmin, isVbAdmin, isBbAdmin,
    hasAdminAccessToSport, hasAdminAccessToTeam, isApproved, isProfileComplete,
    isCoach, isCoachOf, canParticipateIn, isStaffOnly, coachTeamIds, coachTeamNames,
    teamResponsibleIds, captainTeamIds, spielplanerTeamIds, is_spielplaner: isSpielplaner, matchesRole,
    memberTeamIds, memberTeamNames, teamsLoading, memberSports, primarySport,
    canViewTeam, isVorstand, getGuestLevel, isGuestIn, isLoading, login, loginWithOAuth, logout,
    refreshTeamContext,
  }), [
    user, isSuperAdmin, isAdmin, isGlobalAdmin, isVbAdmin, isBbAdmin,
    hasAdminAccessToSport, hasAdminAccessToTeam, isApproved, isProfileComplete,
    isCoach, isCoachOf, canParticipateIn, isStaffOnly, coachTeamIds, coachTeamNames,
    teamResponsibleIds, captainTeamIds, spielplanerTeamIds, isSpielplaner, matchesRole,
    memberTeamIds, memberTeamNames, teamsLoading, memberSports, primarySport,
    canViewTeam, isVorstand, getGuestLevel, isGuestIn, isLoading, login, loginWithOAuth, logout,
    refreshTeamContext,
  ])

  // Block the entire app while restoring a previous session so no route
  // (including public pages like HomePage) flashes unauthenticated content.
  if (isLoading && hadTokenRef.current) {
    return (
      <AuthContext.Provider value={value}>
        <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
          <img
            src="/wiedisync_logo.svg"
            alt="Loading…"
            className="h-24 w-24 animate-spin"
            style={{ animationDuration: '2s' }}
          />
        </div>
      </AuthContext.Provider>
    )
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
