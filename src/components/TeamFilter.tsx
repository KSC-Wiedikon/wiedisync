import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useCollection } from '../lib/query'
import TeamMultiSelect from './TeamMultiSelect'
import { teamNameToColorKey } from '../utils/teamColors'
import type { Team } from '../types'

interface TeamFilterProps {
  selected: string | null
  onChange: (teamId: string | null) => void
  /** When set, only show these team IDs (non-admin mode) */
  limitToTeamIds?: string[]
  /** Group teams by sport (VB/BB) — typically for admin view */
  groupBySport?: boolean
}

/** Single-team filter rendered as a dropdown. Wraps TeamMultiSelect and caps
 *  the selection at one team so existing single-select callers keep their
 *  string-or-null contract. */
export default function TeamFilter({ selected, onChange, limitToTeamIds, groupBySport }: TeamFilterProps) {
  const { t } = useTranslation('common')
  const { data: allTeamsRaw } = useCollection<Team>('teams', { filter: { active: { _eq: true } }, sort: ['name'], limit: 50 })
  const allTeams = allTeamsRaw ?? []

  const teams = useMemo(() => {
    if (!limitToTeamIds || limitToTeamIds.length === 0) return allTeams
    const idSet = new Set(limitToTeamIds)
    return allTeams.filter((tm) => idSet.has(tm.id))
  }, [allTeams, limitToTeamIds])

  const options = useMemo(() => {
    const hasVB = teams.some((tm) => tm.sport === 'volleyball')
    const hasBB = teams.some((tm) => tm.sport === 'basketball')
    const showGroups = !!groupBySport && hasVB && hasBB
    return teams
      .filter((tm) => tm.sport === 'volleyball' || tm.sport === 'basketball')
      .map((tm) => ({
        value: tm.id,
        label: showGroups
          ? (tm.sport === 'volleyball' ? `VB-${tm.name}` : `BB-${tm.name}`)
          : tm.name,
        colorKey: teamNameToColorKey(tm.name, tm.sport),
        group: showGroups
          ? (tm.sport === 'volleyball' ? t('volleyball') : t('basketball'))
          : undefined,
      }))
  }, [teams, groupBySport, t])

  function handleChange(next: string[]) {
    if (next.length === 0) {
      onChange(null)
      return
    }
    // Cap to single selection: prefer the newest addition.
    const previous = selected ? new Set([selected]) : new Set<string>()
    const added = next.find((v) => !previous.has(v))
    onChange(added ?? next[next.length - 1]!)
  }

  return (
    <TeamMultiSelect
      options={options}
      selected={selected ? [selected] : []}
      onChange={handleChange}
      placeholder={t('allTeams')}
    />
  )
}
