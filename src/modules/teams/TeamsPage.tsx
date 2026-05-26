import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Users, Plus } from 'lucide-react'
import { useCollection } from '../../lib/query'
import { useAuth } from '../../hooks/useAuth'
import { useAdminMode } from '../../hooks/useAdminMode'
import EmptyState from '../../components/EmptyState'
import { Button } from '../../components/ui/button'
import TeamRequestModal from '../auth/TeamRequestModal'
import TeamCard from './TeamCard'
import type { Team, MemberTeam } from '../../types'
import LoadingSpinner from '../../components/LoadingSpinner'
import { getCurrentSeason } from '../../utils/dateHelpers'
import { relId } from '../../utils/relations'

export default function TeamsPage() {
  const { t } = useTranslation('teams')
  const { canViewTeam, memberTeamIds, coachTeamIds } = useAuth()
  const { effectiveIsAdmin, effectiveIsVorstand } = useAdminMode()
  const [joinOpen, setJoinOpen] = useState(false)
  const currentTeamIds = useMemo(
    () => Array.from(new Set([...memberTeamIds, ...coachTeamIds])),
    [memberTeamIds, coachTeamIds],
  )
  const { data: teamsRaw, isLoading } = useCollection<Team>('teams', {
    filter: { active: { _eq: true } },
    sort: ['name'],
    limit: 50,
  })
  const teams = teamsRaw ?? []
  const season = getCurrentSeason()
  const { data: memberTeamsRaw } = useCollection<MemberTeam>('member_teams', {
    filter: { season: { _eq: season } },
    all: true,
  })
  const memberTeams = memberTeamsRaw ?? []

  const hasElevatedAccess = effectiveIsAdmin || effectiveIsVorstand
  const effectiveCanViewTeam = (teamId: string) =>
    (effectiveIsAdmin || effectiveIsVorstand) ? canViewTeam(teamId) : (memberTeamIds.includes(teamId) || coachTeamIds.includes(teamId))
  const visibleTeams = teams.filter((team) => effectiveCanViewTeam(team.id))

  const { playersByTeam, guestsByTeam } = useMemo(() => {
    const players: Record<string, number> = {}
    const guests: Record<string, number> = {}
    for (const mt of memberTeams) {
      const id = relId(mt.team)
      if (mt.guest_level > 0) guests[id] = (guests[id] ?? 0) + 1
      else players[id] = (players[id] ?? 0) + 1
    }
    return { playersByTeam: players, guestsByTeam: guests }
  }, [memberTeams])

  const { vbTeams, bbTeams } = useMemo(() => {
    // Women first, then men, then mixed
    const genderGroup = (name: string): number => {
      // Volleyball: D1, DU23 etc. Basketball: "Lions D1", "Rhinos D3", "Damen D-Classics", DU18
      if (/^D\d|^DU\d|Lions|Rhinos|Damen/i.test(name)) return 0
      if (/^MU?\d/i.test(name)) return 2
      return 1 // H1, HU23, Herren, Legends, H-Classics etc.
    }
    // Within gender: main teams (1,2,3…), specials (Legends/Classics), then youth (U-teams descending)
    const teamOrder = (name: string): number => {
      // VB: H1, D2 etc. BB: "Herren 1 H1" → extract trailing number
      const mainMatch = name.match(/[HD](\d+)$/)
      if (mainMatch) return parseInt(mainMatch[1], 10)
      // Sub-brands: "Lions D1" → D1, "Rhinos D3" → D3
      const subMatch = name.match(/[HD](\d+)/)
      if (subMatch && /Lions|Rhinos/i.test(name)) return parseInt(subMatch[1], 10)
      // Legends, Classics → after main teams, before youth
      if (/Legends|Classics/i.test(name)) return 5
      // Youth: U23, U20 etc. — higher age first
      const uMatch = name.match(/U(\d+)/)
      if (uMatch) return 100 - parseInt(uMatch[1], 10)
      return 200
    }
    const sortTeams = (a: Team, b: Team) => {
      const ga = genderGroup(a.name), gb = genderGroup(b.name)
      if (ga !== gb) return ga - gb
      return teamOrder(a.name) - teamOrder(b.name)
    }
    const nonClassics = visibleTeams.filter((t) => !/Classics/i.test(t.name))
    const vb = nonClassics.filter((t) => t.sport === 'volleyball').sort(sortTeams)
    const bb = nonClassics.filter((t) => t.sport === 'basketball').sort(sortTeams)
    return { vbTeams: vb, bbTeams: bb }
  }, [visibleTeams])

  if (isLoading) {
    return <LoadingSpinner />
  }

  if (visibleTeams.length === 0) {
    return (
      <>
        <EmptyState
          icon={<Users className="h-10 w-10" />}
          title={hasElevatedAccess ? t('noTeams') : t('noTeamMembership')}
          description={hasElevatedAccess ? t('noTeamsDescription') : t('noTeamMembershipDescription')}
          action={
            !hasElevatedAccess ? (
              <Button onClick={() => setJoinOpen(true)}>
                <Plus className="h-4 w-4" />
                {t('joinAnotherTeam')}
              </Button>
            ) : undefined
          }
        />
        <TeamRequestModal
          open={joinOpen}
          onClose={() => setJoinOpen(false)}
          onComplete={() => setJoinOpen(false)}
          currentTeamIds={currentTeamIds}
        />
      </>
    )
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl dark:text-gray-100">{t('title')}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('subtitleSeason', { season })}</p>
        </div>
        {!hasElevatedAccess && (
          <Button variant="outline" size="sm" onClick={() => setJoinOpen(true)} className="shrink-0">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{t('joinAnotherTeam')}</span>
          </Button>
        )}
      </div>

      {vbTeams.length > 0 && (
        <>
          {bbTeams.length > 0 && (
            <h2 className="mt-6 text-lg font-semibold text-gray-900 dark:text-gray-100">Volleyball</h2>
          )}
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {vbTeams.map((team) => (
              <TeamCard key={team.id} team={team} playerCount={playersByTeam[team.id] ?? 0} guestCount={guestsByTeam[team.id] ?? 0} />
            ))}
          </div>
        </>
      )}

      {bbTeams.length > 0 && (
        <>
          <h2 className="mt-8 text-lg font-semibold text-gray-900 dark:text-gray-100">Basketball</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {bbTeams.map((team) => (
              <TeamCard key={team.id} team={team} playerCount={playersByTeam[team.id] ?? 0} guestCount={guestsByTeam[team.id] ?? 0} />
            ))}
          </div>
        </>
      )}

      <TeamRequestModal
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        onComplete={() => setJoinOpen(false)}
        currentTeamIds={currentTeamIds}
      />
    </div>
  )
}
