import { useTranslation } from 'react-i18next'
import ViewToggle from '../../components/ViewToggle'
import FilterChips from '../../components/FilterChips'
import { useTeams } from '../../hooks/useTeams'
import { Switch } from '@/components/ui/switch'
import type { SpielplanungFilterState, SportFilter, GameTypeFilter } from '../../types/calendar'

interface SpielplanungFiltersProps {
  filters: SpielplanungFilterState
  onChange: (filters: SpielplanungFilterState) => void
}

export default function SpielplanungFilters({ filters, onChange }: SpielplanungFiltersProps) {
  const { t } = useTranslation('spielplanung')

  const sportOptions = [
    { value: 'all', label: t('filterAll') },
    { value: 'volleyball', label: t('filterVolleyball') },
    { value: 'basketball', label: t('filterBasketball') },
  ]

  const typeOptions = [
    { value: 'all', label: t('filterAll') },
    { value: 'home', label: t('filterHome') },
    { value: 'away', label: t('filterAway') },
  ]
  const sportForTeams = filters.sport === 'all' ? undefined : filters.sport
  const { data: teams } = useTeams(sportForTeams ?? 'all')

  const teamChipOptions = teams.map((t) => ({
    value: t.id,
    label: t.name,
  }))

  function handleSportChange(value: string) {
    onChange({
      ...filters,
      sport: value as SportFilter,
      selectedTeamIds: [],
    })
  }

  function handleTeamChange(selected: string[]) {
    onChange({ ...filters, selectedTeamIds: selected })
  }

  function handleTypeChange(value: string) {
    onChange({ ...filters, gameType: value as GameTypeFilter })
  }


  return (
    <div className="flex flex-wrap items-center gap-4">
      <ViewToggle options={sportOptions} value={filters.sport} onChange={handleSportChange} />

      {teamChipOptions.length > 0 && (
        <FilterChips
          options={teamChipOptions}
          selected={filters.selectedTeamIds}
          onChange={handleTeamChange}
        />
      )}

      <ViewToggle options={typeOptions} value={filters.gameType} onChange={handleTypeChange} />

      <div data-tour="absence-overlay" className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
        <Switch checked={filters.showAbsences} onCheckedChange={(checked) => onChange({ ...filters, showAbsences: checked })} />
        {t('showAbsences')}
      </div>

      <div
        className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400"
        title={filters.selectedTeamIds.length === 0 ? t('crossTeamNeedsTeam') : undefined}
      >
        <Switch
          checked={filters.showCrossTeam}
          disabled={filters.selectedTeamIds.length === 0}
          onCheckedChange={(checked) => onChange({ ...filters, showCrossTeam: checked })}
        />
        {t('showCrossTeam')}
      </div>
    </div>
  )
}
