import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ViewToggle from '../../components/ViewToggle'
import SpielplanungFilters from './SpielplanungFilters'
import CalendarView from './CalendarView'
import WeekView from './WeekView'
import ListView from './ListView'
import GameDetailDrawer from './GameDetailDrawer'
import ManualGameModal from './ManualGameModal'
import ImportPanel from './ImportPanel'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import { FileSpreadsheet, ChevronDown } from 'lucide-react'
import { useSpielplanungData } from './hooks/useSpielplanungData'
import { useAvailableSeasons } from './hooks/useAvailableSeasons'
import { checkConflicts } from './utils/gameConflicts'
import { toast } from 'sonner'
import { useTeams } from '../../hooks/useTeams'
import { useTeamAbsences } from '../../hooks/useTeamAbsences'
import { useAuth } from '../../hooks/useAuth'
import { useMutation } from '../../hooks/useMutation'
import { buildAbsencesByDate, type AbsentMember } from './utils/absencesByDate'
import { useCrossTeamConflicts } from './hooks/useCrossTeamConflicts'
import { asObj } from '../../utils/relations'
import { startOfMonth, getSeasonYear } from '../../utils/dateUtils'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { useReportPageLoading } from '../../hooks/usePageReady'
import LoadingSpinner from '../../components/LoadingSpinner'
import type { ViewMode, SpielplanungFilterState } from '../../types/calendar'
import type { Game } from '../../types'
import { TourPageButton } from '../guide/TourPageButton'

function getInitialMonth(): Date {
  const now = new Date()
  const m = now.getMonth()
  if (m >= 8 || m <= 4) return startOfMonth(now)
  return new Date(now.getFullYear(), 8, 1)
}

export default function SpielplanungPage() {
  const { t } = useTranslation('spielplanung')
  const isMobile = useIsMobile()
  const [viewMode, setViewMode] = useState<ViewMode>(() => isMobile ? 'list-date' : 'calendar')
  const [filters, setFilters] = useState<SpielplanungFilterState>({
    sport: 'all',
    selectedTeamIds: [],
    gameType: 'all',
    showAbsences: false,
    showCrossTeam: false,
  })
  const [month, setMonth] = useState<Date>(getInitialMonth)
  const [weekAnchor, setWeekAnchor] = useState<Date>(() => new Date())
  const [selectedGame, setSelectedGame] = useState<Game | null>(null)
  const [createFor, setCreateFor] = useState<Date | null>(null)
  const [editingGame, setEditingGame] = useState<Game | null>(null)

  const { isAdmin, is_spielplaner, spielplanerTeamIds } = useAuth()
  const { remove: deleteGame, update: updateGame } = useMutation('games')

  const seasonYear = getSeasonYear(month)
  const seasonStart = `${seasonYear}-09-01`
  const seasonEnd = `${seasonYear + 1}-05-31`

  const { games, entries, closedDates, isLoading: dataLoading, error } = useSpielplanungData({
    filters,
    seasonStart,
    seasonEnd,
  })

  const { data: teams, isLoading: teamsLoading } = useTeams()
  const { seasons, isLoading: seasonsLoading } = useAvailableSeasons()

  // Wait for ALL primary data before rendering the views: games/closures, the
  // team list (feeds the list views + edit-permission map), and the season list
  // (feeds the season dropdown). Avoids a pop-in where the calendar renders
  // before teams/seasons resolve.
  const isLoading = dataLoading || teamsLoading || seasonsLoading

  // Report to the app boot gate — see usePageReady.tsx
  useReportPageLoading(isLoading)

  const editableTeamIds = useMemo(() => {
    if (isAdmin || is_spielplaner) return (teams ?? []).map((t) => String(t.id))
    return spielplanerTeamIds
  }, [isAdmin, is_spielplaner, spielplanerTeamIds, teams])

  const canCreateManualGames = editableTeamIds.length > 0

  // ── Absence overlay ──────────────────────────────────────────────────
  // Scope absences to whatever the calendar is currently showing: the picked
  // teams, else all teams of the picked sport, else every team. Only fetch when
  // the toggle is on (the hook no-ops on an empty id list).
  const absenceTeamIds = useMemo(() => {
    if (!filters.showAbsences) return []
    if (filters.selectedTeamIds.length > 0) return filters.selectedTeamIds
    const pool = teams ?? []
    const scoped = filters.sport === 'all' ? pool : pool.filter((t) => t.sport === filters.sport)
    return scoped.map((t) => String(t.id))
  }, [filters.showAbsences, filters.selectedTeamIds, filters.sport, teams])

  const { absences, memberTeams } = useTeamAbsences(absenceTeamIds, seasonStart, seasonEnd)

  const absencesByDate = useMemo(
    () =>
      filters.showAbsences
        ? buildAbsencesByDate(absences, memberTeams, seasonStart, seasonEnd)
        : new Map<string, AbsentMember[]>(),
    [filters.showAbsences, absences, memberTeams, seasonStart, seasonEnd],
  )

  // ── Cross-team overlay ───────────────────────────────────────────────
  // Days a roster-sharing team plays (those block this team's home slots).
  // Scoped to the picked team(s) — cross-team is inherently per-team, so it needs
  // at least one selected; the hook no-ops on an empty id list.
  const crossTeamTeamIds = useMemo(
    () => (filters.showCrossTeam ? filters.selectedTeamIds : []),
    [filters.showCrossTeam, filters.selectedTeamIds],
  )
  const { byDate: crossTeamByDate } = useCrossTeamConflicts(crossTeamTeamIds)

  function canEditGame(game: Game | null): boolean {
    if (!game) return false
    if (game.source !== 'manual') return false
    const teamRel = asObj<{ id: number | string }>(game.kscw_team)
    const tid = String(teamRel?.id ?? game.kscw_team ?? '')
    return isAdmin || is_spielplaner || spielplanerTeamIds.includes(tid)
  }

  const currentSeasonLabel = `${seasonYear}/${seasonYear + 1}`

  // Merge the current season into the dropdown so we always have at least one option,
  // even before the games collection resolves.
  const seasonOptions = useMemo(() => {
    const set = new Set<string>([currentSeasonLabel, ...seasons])
    return [...set].sort().reverse()
  }, [seasons, currentSeasonLabel])

  async function handleWeekMove(move: { gameId: string | number; newDate: string; newTime: string }) {
    const game = games.find((g) => String(g.id) === String(move.gameId))
    if (!game) return
    if (game.source !== 'manual') return
    if (!canEditGame(game)) return

    const teamRel = asObj<{ id: number | string }>(game.kscw_team)
    const teamId = String(teamRel?.id ?? game.kscw_team ?? '')
    const hallRel = asObj<{ id: number | string }>(game.hall)
    const hallId = hallRel?.id != null ? String(hallRel.id) : (game.hall as unknown as string) ?? null

    const { errors, warnings } = checkConflicts(
      {
        editingId: game.id,
        kscw_team: teamId,
        hall: hallId,
        date: move.newDate,
        time: move.newTime,
        type: game.type as 'home' | 'away',
      },
      games,
    )

    if (errors.length > 0) {
      const msg = t(`manualGame.conflict.${errors[0].messageKey}`, errors[0].context)
      toast.error(msg)
      return
    }

    try {
      await updateGame(game.id, { date: move.newDate, time: move.newTime })
      if (warnings.length > 0) {
        const msg = t(`manualGame.conflict.${warnings[0].messageKey}`, warnings[0].context)
        toast.warning(msg)
      } else {
        toast.success(t('weekMoveSuccess'))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(t('weekMoveFailed', { message }))
    }
  }

  function handleSeasonChange(nextSeason: string) {
    // Season format: 'YYYY/YYYY'. Set month to Sep of the start year.
    const startYear = parseInt(nextSeason.split('/')[0] ?? '', 10)
    if (Number.isFinite(startYear)) {
      setMonth(new Date(startYear, 8, 1))
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900 sm:text-2xl dark:text-gray-100">{t('title')}</h1>
            <TourPageButton />
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('subtitleSeason', { season: `${seasonYear}/${(seasonYear + 1).toString().slice(2)}` })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={currentSeasonLabel} onValueChange={handleSeasonChange}>
            <SelectTrigger aria-label={t('seasonPicker')} className="h-9 w-[132px] rounded-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {seasonOptions.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div data-tour="view-toggle"><ViewToggle
            options={[
              { value: 'calendar', label: t('viewCalendar') },
              ...(isMobile ? [] : [{ value: 'week', label: t('viewWeek') }]),
              { value: 'list-date', label: t('viewByDate') },
              { value: 'list-team', label: t('viewByTeam') },
            ]}
            value={viewMode}
            onChange={(v) => setViewMode(v as ViewMode)}
          /></div>
        </div>
      </div>

      {/* Filters */}
      <div data-tour="spielplanung-filters">
        <SpielplanungFilters filters={filters} onChange={setFilters} />
      </div>

      {/* Bulk import (only when the caller can create manual games) */}
      {canCreateManualGames && (
        <Collapsible>
          <CollapsibleTrigger className="group inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700">
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
            {t('import.title')}
            <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <ImportPanel editableTeamIds={editableTeamIds} />
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Loading / Error */}
      {isLoading && <LoadingSpinner />}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {t('common:errorLoading')} {error.message}
        </div>
      )}

      {/* Views */}
      {!isLoading && !error && (
        <>
          {viewMode === 'calendar' && (
            <CalendarView
              entries={entries}
              closedDates={closedDates}
              month={month}
              onMonthChange={setMonth}
              onGameClick={setSelectedGame}
              onEmptyDayClick={canCreateManualGames ? setCreateFor : undefined}
              absencesByDate={absencesByDate}
              crossTeamByDate={crossTeamByDate}
            />
          )}
          {viewMode === 'week' && (
            <WeekView
              entries={entries}
              weekStart={weekAnchor}
              onWeekChange={setWeekAnchor}
              onGameClick={setSelectedGame}
              canEdit={canEditGame}
              onMove={handleWeekMove}
              absencesByDate={absencesByDate}
              crossTeamByDate={crossTeamByDate}
            />
          )}
          {viewMode === 'list-date' && (
            <ListView games={games} mode="date" teams={teams} />
          )}
          {viewMode === 'list-team' && (
            <ListView games={games} mode="team" teams={teams} />
          )}
        </>
      )}

      <GameDetailDrawer
        game={selectedGame}
        onClose={() => setSelectedGame(null)}
        canEdit={canEditGame(selectedGame)}
        onEdit={(g) => {
          setEditingGame(g)
          setSelectedGame(null)
        }}
        onDelete={async (g) => {
          await deleteGame(g.id)
        }}
      />

      <ManualGameModal
        open={!!createFor || !!editingGame}
        onClose={() => {
          setCreateFor(null)
          setEditingGame(null)
        }}
        initialDate={createFor}
        editingGame={editingGame}
        editableTeamIds={editableTeamIds}
        initialSport={filters.sport}
        initialGameType={filters.gameType}
        initialSelectedTeamIds={filters.selectedTeamIds}
      />
    </div>
  )
}
