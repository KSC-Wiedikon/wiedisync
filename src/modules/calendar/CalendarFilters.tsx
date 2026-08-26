import { useTranslation } from 'react-i18next'
import Modal from '@/components/Modal'
import { Switch } from '@/components/ui/switch'
import CategoryMultiSelect from '../../components/CategoryMultiSelect'
import TeamMultiSelect from '../../components/TeamMultiSelect'
import { useTeams } from '../../hooks/useTeams'
import { teamNameToColorKey } from '../../utils/teamColors'
import { sourceColors } from './entryStyle'
import type { CalendarFilterState, SourceFilter } from '../../types/calendar'

interface CalendarFiltersProps {
  open: boolean
  onClose: () => void
  filters: CalendarFilterState
  onChange: (filters: CalendarFilterState) => void
  allowedSources?: SourceFilter[]
  userTeamIds?: string[]
  isAdmin?: boolean
  /**
   * Whether to offer the team picker. False on a calendar whose team is fixed by
   * the page it sits on — there the scope is imposed, not chosen. Belt-and-braces:
   * with neither `userTeamIds` nor `isAdmin` the option list is already empty, but
   * saying it explicitly stops a future default from growing a picker there.
   */
  showTeamFilter?: boolean
}

export default function CalendarFilters({ open, onClose, filters, onChange, allowedSources, userTeamIds, isAdmin, showTeamFilter }: CalendarFiltersProps) {
  const { t } = useTranslation('calendar')
  const { t: tc } = useTranslation('common')

  const allSourceOptions = [
    { value: 'game-home', label: t('gameTypeHome'), color: sourceColors['game-home'], group: t('filterGroupGames') },
    { value: 'game-away', label: t('gameTypeAway'), color: sourceColors['game-away'], group: t('filterGroupGames') },
    { value: 'scorer-duty', label: t('sourceScorerDuty'), color: sourceColors['scorer-duty'], group: t('filterGroupGames') },
    { value: 'training', label: t('sourceTrainings'), color: sourceColors.training, group: t('filterGroupActivities') },
    { value: 'event', label: t('sourceEvents'), color: sourceColors.event, group: t('filterGroupActivities') },
    { value: 'hall', label: t('sourceHallHW'), color: sourceColors.hall, group: t('filterGroupVenue') },
    { value: 'closure', label: t('sourceClosures'), color: sourceColors.closure, group: t('filterGroupVenue') },
    { value: 'absence', label: t('sourceAbsences'), color: sourceColors.absence, group: t('filterGroupOther') },
    { value: 'birthday', label: t('sourceBirthdays'), color: sourceColors.birthday, group: t('filterGroupOther') },
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
        {showTeamFilter !== false && teamOptions.length > 0 && (
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
