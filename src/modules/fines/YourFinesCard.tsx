import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Gavel } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useCollection } from '../../lib/query'
import { useFines, formatFineAmount } from '../../hooks/useFines'
import type { Team } from '../../types'

/**
 * Home-page card: everything the member currently owes in fines — their own
 * open fines PLUS the open TEAM fines (member IS NULL, migration 350) of the
 * teams they're on. Renders nothing when there's nothing open (mirrors
 * YourDuesCard) so it never clutters a clean dashboard.
 *
 * The two are summed and shown SEPARATELY on purpose: a team fine is owed by
 * the Teamkasse and must never read as the member's personal balance — but
 * until it appeared here nobody on the team ever learned about it.
 */
export default function YourFinesCard() {
  const { t } = useTranslation('fines')
  const { user, memberTeamIds, coachTeamIds } = useAuth()
  const userId = user?.id

  // Roster teams + coached/TR teams: a staff-only coach has no member_teams row
  // yet is exactly who settles a Teamkasse fine.
  const teamIds = useMemo(
    () => [...new Set([...memberTeamIds, ...coachTeamIds])],
    [memberTeamIds, coachTeamIds],
  )

  const finesFilter = useMemo<Record<string, unknown> | null>(() => {
    const branches: Record<string, unknown>[] = []
    if (userId) branches.push({ member: { _eq: userId } })
    if (teamIds.length) branches.push({ _and: [{ member: { _null: true } }, { team: { _in: teamIds } }] })
    if (branches.length === 0) return null
    return { _and: [{ status: { _eq: 'open' } }, branches.length === 1 ? branches[0] : { _or: branches }] }
  }, [userId, teamIds])

  const { data: finesRaw } = useFines({
    filter: finesFilter ?? undefined,
    enabled: finesFilter != null,
    fields: ['id', 'member', 'team', 'amount', 'currency', 'status'],
  })
  const fines = useMemo(() => finesRaw ?? [], [finesRaw])

  // `amount` arrives as a string (fetchItems stringifies numbers) — always Number().
  const stats = useMemo(() => {
    const mine = fines.filter((f) => f.member != null)
    const team = fines.filter((f) => f.member == null)
    const perTeam = new Map<string, number>()
    for (const f of team) {
      const key = String(f.team)
      perTeam.set(key, (perTeam.get(key) ?? 0) + (Number(f.amount) || 0))
    }
    return {
      count: fines.length,
      mineTotal: mine.reduce((acc, f) => acc + (Number(f.amount) || 0), 0),
      mineCount: mine.length,
      perTeam,
      total: fines.reduce((acc, f) => acc + (Number(f.amount) || 0), 0),
    }
  }, [fines])

  // Team names — only fetched when a team fine actually exists, so the common
  // case costs the home page zero extra requests.
  const teamFineTeamIds = useMemo(() => [...stats.perTeam.keys()], [stats.perTeam])
  const { data: teamsRaw } = useCollection<Team>('teams', {
    filter: teamFineTeamIds.length ? { id: { _in: teamFineTeamIds } } : undefined,
    fields: ['id', 'name'],
    enabled: teamFineTeamIds.length > 0,
    all: true,
  })
  const teamNames = useMemo(
    () => new Map((teamsRaw ?? []).map((tm) => [String(tm.id), String(tm.name)])),
    [teamsRaw],
  )

  if (stats.count === 0) return null

  return (
    <div className="mb-6 lg:flex lg:flex-col lg:items-center">
      <Link
        to="/fines"
        className="block w-full rounded-xl border border-amber-200 bg-amber-50/60 p-4 transition-colors hover:border-amber-300 lg:max-w-2xl dark:border-amber-800/50 dark:bg-amber-900/20 dark:hover:border-amber-700"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-100">
            <Gavel className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            {t('homeCardTitle')}
          </div>
          <span className="text-xs text-amber-700 dark:text-amber-400">{t('dashboardViewAll')} →</span>
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <div className="text-2xl font-bold tabular-nums text-amber-900 dark:text-amber-100">
            {formatFineAmount(stats.total)}
          </div>
          <div className="text-xs text-amber-700/80 dark:text-amber-300/80">
            {t('outstandingCount', { count: stats.count })}
          </div>
        </div>
        <div className="mt-2 space-y-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
          {stats.mineCount > 0 && (
            <div>{t('homeCardMine', { amount: formatFineAmount(stats.mineTotal), count: stats.mineCount })}</div>
          )}
          {teamFineTeamIds.map((id) => (
            <div key={id}>
              {t('homeCardTeamOwes', {
                team: teamNames.get(id) ?? `#${id}`,
                amount: formatFineAmount(stats.perTeam.get(id) ?? 0),
              })}
            </div>
          ))}
        </div>
      </Link>
    </div>
  )
}
