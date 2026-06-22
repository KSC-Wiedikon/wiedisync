import { useTranslation } from 'react-i18next'
import Modal from '@/components/Modal'
import { Switch } from '@/components/ui/switch'
import CategoryMultiSelect from '../../components/CategoryMultiSelect'
import TeamMultiSelect from '../../components/TeamMultiSelect'
import { useTeams } from '../../hooks/useTeams'
import { teamNameToColorKey } from '../../utils/teamColors'
import type { CalendarFilterState, SourceFilter } from '../../types/calendar'

interface CalendarFiltersProps {
  open: boolean
  onClose: () => void
  filters: CalendarFilterState
  onChange: (filters: CalendarFilterState) => void
  allowedSources?: SourceFilter[]
  userTeamIds?: string[]
  isAdmin?: boolean
}

export default function CalendarFilters({ open, onClose, filters, onChange, allowedSources, userTeamIds, isAdmin }: CalendarFiltersProps) {
  const { t } = useTranslation('calendar')
  const { t: tc } = useTranslation('common')

  const allSourceOptions = [
    { value: 'game-home', label: t('gameTypeHome'), color: { bg: '#4A55A2', text: '#ffffff', border: '#3b4590' }, group: t('filterGroupGames') },
    { value: 'game-away', label: t('gameTypeAway'), color: { bg: '#FFC832', text: '#78350f', border: '#e6b42d' }, group: t('filterGroupGames') },
    { value: 'scorer-duty', label: t('sourceScorerDuty'), color: { bg: '#6366f1', text: '#ffffff', border: '#4f46e5' }, group: t('filterGroupGames') },
    { value: 'training', label: t('sourceTrainings'), color: { bg: '#16a34a', text: '#ffffff', border: '#15803d' }, group: t('filterGroupActivities') },
    { value: 'event', label: t('sourceEvents'), color: { bg: '#7e22ce', text: '#ffffff', border: '#6b21a8' }, group: t('filterGroupActivities') },
    { value: 'hall', label: t('sourceHallHW'), color: { bg: '#0891b2', text: '#ffffff', border: '#0e7490' }, group: t('filterGroupVenue') },
    { value: 'closure', label: t('sourceClosures'), color: { bg: '#dc2626', text: '#ffffff', border: '#b91c1c' }, group: t('filterGroupVenue') },
    { value: 'absence', label: t('sourceAbsences'), color: { bg: '#374151', text: '#ffffff', border: '#1f2937' }, group: t('filterGroupOther') },
  ]
  const sourceOptions = allowedSources
    ? allSourceOptions.filter((o) => allowedSources.includes(o.value as SourceFilter))
    : allSourceOptions
  const { data: teams } = useTeams()
  const visibleTeams = isAdmin ? teams : teams.filter((t) => userTeamIds?.includes(t.id))

  const hasVB = visibleTeams.some((t) => t.sport === 'volleyball')
  const hasBB = visibleTeams.some((t) => t.sport === 'basketball')
  const showGroups = hasVB && hasBB

  const teamOptions = visibleTeams
    .filter((team) => team.sport === 'volleyball' || team.sport === 'basketball')
    .map((team) => {
      const colorKey = teamNameToColorKey(team.name, team.sport)
      const sportLabel = team.sport === 'volleyball' ? tc('volleyball') : tc('basketball')
      const label = showGroups
        ? (team.sport === 'volleyball' ? `VB-${team.name}` : `BB-${team.name}`)
        : team.name
      return { value: team.id, label, colorKey, group: showGroups ? sportLabel : undefined }
    })

  return (
    <Modal open={open} onClose={onClose} title={t('filterTitle')} size="sm">
      <div className="min-h-[14rem] space-y-5">
        {/* Source type dropdown */}
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('filterCategories')}
          </label>
          <CategoryMultiSelect
            options={sourceOptions}
            selected={filters.sources}
            onChange={(sources) => onChange({ ...filters, sources: sources as SourceFilter[] })}
            placeholder={tc('all')}
            inline
          />
        </div>

        {/* Team filter */}
        {teamOptions.length > 0 && (
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {tc('team')}
            </label>
            <TeamMultiSelect
              options={teamOptions}
              selected={filters.selectedTeamIds}
              onChange={(ids) => onChange({ ...filters, selectedTeamIds: ids })}
              placeholder={tc('allTeams')}
            />
          </div>
        )}

        {/* Show unavailabilities + non-blocking absences (hidden by default) */}
        {filters.sources.includes('absence') && (
          <div className="flex items-start gap-2">
            <Switch
              id="cal-show-hidden-absences"
              checked={filters.showHiddenAbsences === true}
              onCheckedChange={(checked) => onChange({ ...filters, showHiddenAbsences: checked })}
            />
            <label htmlFor="cal-show-hidden-absences" className="cursor-pointer">
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('showHiddenAbsences')}
              </span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                {t('showHiddenAbsencesHint')}
              </span>
            </label>
          </div>
        )}
      </div>
    </Modal>
  )
}

/** Count active filters (deselected sources + selected teams) */
export function getActiveFilterCount(
  filters: CalendarFilterState,
  totalSources: number,
): number {
  let count = 0
  if (filters.sources.length < totalSources) count += 1
  if (filters.selectedTeamIds.length > 0) count += 1
  return count
}
