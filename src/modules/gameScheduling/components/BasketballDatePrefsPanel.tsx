import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Badge } from '../../../components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { formatDateZurich } from '../../../utils/dateHelpers'
import type { BbDatePrefGroup } from '../hooks/useBasketballDatePrefs'

/**
 * What the opponent clubs said suits them — the planner's read of the portal answers.
 *
 * ⚠ Nothing here is a booking. A row means "these clubs could come that day"; the planner still
 * places the game, which is what claims the floor (migrations 278 + 295). The panel therefore
 * has no action buttons: deciding happens in the planner, not in a list of preferences.
 *
 * A <Table> because each row is a record you scan and compare (CLAUDE.md "Lists → tables").
 * Grouped by (team, date) rather than listed per club, because the planner's question is "who
 * can come on this day?" — a flat list would make them do that join by eye.
 */

interface Props {
  groups: BbDatePrefGroup[]
  clubsAnswered: number
  isLoading: boolean
  error: Error | null
}

export default function BasketballDatePrefsPanel({ groups, clubsAnswered, isLoading, error }: Props) {
  const { t } = useTranslation('basketballScheduling')
  const [teamFilter, setTeamFilter] = useState<string>('')

  const teams = useMemo(() => {
    const byId = new Map<number, string>()
    for (const g of groups) byId.set(g.kscw_team, g.kscw_team_name)
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [groups])

  const rows = useMemo(
    () => (teamFilter ? groups.filter((g) => String(g.kscw_team) === teamFilter) : groups),
    [groups, teamFilter],
  )

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('datePrefsTitle')}</h2>
          <p className="mt-1 max-w-3xl text-xs text-gray-500 dark:text-gray-400">{t('datePrefsHint')}</p>
        </div>
        {teams.length > 1 && (
          // `dark:bg-gray-800` is mandatory — an <option> inherits the select's background
          // and would render white in dark mode (CLAUDE.md).
          <select
            aria-label={t('dashTeam')}
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="min-h-11 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">{t('datePrefsAllTeams')}</option>
            {teams.map(([id, name]) => (
              <option key={id} value={String(id)}>{name}</option>
            ))}
          </select>
        )}
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-gray-400">
          <Loader2 className="mx-auto h-4 w-4 animate-spin" aria-hidden />
        </div>
      ) : error ? (
        <p className="py-6 text-center text-sm text-rose-600 dark:text-rose-400">{error.message}</p>
      ) : groups.length === 0 ? (
        // Distinguishes "nobody has replied yet" from "something is broken" — before the links
        // go out this is the expected state, not a fault.
        <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">{t('datePrefsEmpty')}</p>
      ) : (
        <>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            {t('datePrefsAnswered', { count: clubsAnswered })}
          </p>
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colDate')}</TableHead>
                  <TableHead>{t('dashTeam')}</TableHead>
                  <TableHead>{t('datePrefsColClubs')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('noteLabel')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((g) => (
                  <TableRow key={`${g.kscw_team}|${g.date}`} className="min-h-[44px]">
                    <TableCell className="whitespace-normal break-words font-medium tabular-nums">
                      {formatDateZurich(g.date)}
                    </TableCell>
                    <TableCell className="whitespace-normal break-words">{g.kscw_team_name}</TableCell>
                    <TableCell className="whitespace-normal break-words">
                      <span className="flex flex-wrap items-center gap-1">
                        {g.clubs.map((c) => (
                          <Badge key={c.id} variant="secondary" title={c.responder_name || undefined}>
                            {c.club_name}
                          </Badge>
                        ))}
                      </span>
                    </TableCell>
                    <TableCell className="hidden whitespace-normal break-words text-xs text-gray-500 lg:table-cell dark:text-gray-400">
                      {g.clubs.map((c) => c.note).filter(Boolean).join(' · ')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
