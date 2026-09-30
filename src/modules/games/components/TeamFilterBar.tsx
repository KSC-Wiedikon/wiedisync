import { useTranslation } from 'react-i18next'
import TeamMultiSelect from '../../../components/TeamMultiSelect'
import type { SportView } from '../../../hooks/useSportPreference'

/** An active `teams` row — the filter's options come from the DB, not from the
 *  hardcoded `teamColors` keys (those are `BB-`-prefixed shortcodes that never
 *  equal a real name like "Rhinos D3" or "HU23-1", which left non-admins with an
 *  empty drop-down). */
export interface TeamFilterTeam {
  name: string
  sport?: 'volleyball' | 'basketball' | null
}

interface TeamFilterBarProps {
  teams: readonly TeamFilterTeam[]
  selected: string[]
  onChange: (selected: string[]) => void
  multiSelect?: boolean
  showAll?: boolean
  sport?: SportView
  /** When set, only show these team names (non-admin mode) */
  limitToTeams?: string[]
  /** Enforce radio behaviour: selecting a team replaces the array instead of toggling. */
  singleSelect?: boolean
}

export default function TeamFilterBar({
  teams,
  selected,
  onChange,
  sport = 'all',
  limitToTeams,
  singleSelect = false,
}: TeamFilterBarProps) {
  const { t } = useTranslation('common')

  // Filter team chips by sport (and optionally by user's teams)
  const visibleTeams = teams.filter((team) => {
    if (limitToTeams && !limitToTeams.includes(team.name)) return false
    if (sport === 'all') return true
    return sport === 'vb' ? team.sport === 'volleyball' : team.sport === 'basketball'
  })

  const showGroups = sport === 'all'

  // Volleyball first, then basketball (grouped by sport — team names alone
  // don't say which: "D3" is volleyball, "Rhinos D3" basketball).
  const sportRank = (s: TeamFilterTeam['sport']) => (s === 'volleyball' ? 0 : s === 'basketball' ? 1 : 2)
  const options = [...visibleTeams]
    .sort((a, b) => sportRank(a.sport) - sportRank(b.sport) || a.name.localeCompare(b.name, 'de-CH', { numeric: true }))
    .map((team) => ({
      value: team.name,
      label: team.name,
      // teamColors keys basketball under a `BB-` prefix; getTeamColor resolves
      // long BB names ("Herren 1 H1") from there.
      colorKey: team.sport === 'basketball' ? `BB-${team.name}` : team.name,
      group: showGroups
        ? (team.sport === 'volleyball' ? t('volleyball') : t('basketball'))
        : undefined,
    }))

  // In single-select mode, collapse the next array to a single membership:
  // pick the newest addition (or fall back to the last entry / empty).
  function handleChange(next: string[]) {
    if (!singleSelect) {
      onChange(next)
      return
    }
    if (next.length === 0) {
      onChange([])
      return
    }
    const previous = new Set(selected)
    const added = next.find((v) => !previous.has(v))
    onChange([added ?? next[next.length - 1]!])
  }

  return (
    <div className="max-w-sm">
      <TeamMultiSelect
        options={options}
        selected={selected}
        onChange={handleChange}
        placeholder={t('allTeams')}
      />
    </div>
  )
}
