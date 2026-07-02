import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import type { RefereeExpense, Game, Team, Member, BaseRecord } from '../../types'
import { useCollection } from '../../lib/query'
import TeamChip from '../../components/TeamChip'
import { teamNameToColorKey } from '../../utils/teamColors'
import { formatDate } from '../../utils/dateHelpers'
import { toCSV } from './utils/exportResults'
import { asObj } from '../../utils/relations'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { useReportPageLoading } from '../../hooks/usePageReady'

type ExpandedExpense = RefereeExpense & {
  game: (Game & BaseRecord) | string
  team: (Team & BaseRecord) | string
  paid_by_member: (Member & BaseRecord) | string
}

export default function RefereeExpensesPage() {
  const { t } = useTranslation('admin')
  const [teamFilter, setTeamFilter] = useState('')
  const [seasonFilter, setSeasonFilter] = useState('')

  // Fetch all volleyball teams for filter dropdown
  const { data: vbTeamsRaw } = useCollection<Team & BaseRecord>('teams', {
    filter: { _and: [{ sport: { _eq: 'volleyball' } }, { active: { _eq: true } }] },
    sort: ['name'],
    all: true,
  })
  const vbTeams = vbTeamsRaw ?? []

  // Build filter
  const filter = useMemo((): Record<string, unknown> => {
    const conditions: Record<string, unknown>[] = []
    if (teamFilter) conditions.push({ team: { _eq: teamFilter } })
    if (seasonFilter) conditions.push({ game: { season: { _eq: seasonFilter } } })
    if (conditions.length === 0) return {}
    return conditions.length === 1 ? conditions[0] : { _and: conditions }
  }, [teamFilter, seasonFilter])

  // Fetch expenses
  const { data: expensesRaw, isLoading } = useCollection<ExpandedExpense>('referee_expenses', {
    filter,
    sort: ['-date_created'],
    fields: ['*', 'game.*', 'team.*', 'paid_by_member.*'],
    all: true,
  })
  const expenses = expensesRaw ?? []

  // Report to the app boot gate — see usePageReady.tsx
  useReportPageLoading(isLoading)

  // Extract unique seasons from game data
  const seasons = useMemo(() => {
    const s = new Set<string>()
    expenses.forEach((e) => {
      const game = asObj<Game & BaseRecord>(e.game)
      if (game?.season) s.add(game.season)
    })
    return Array.from(s).sort().reverse()
  }, [expenses])

  const exportCsv = () => {
    const header = ['Date', 'Home Team', 'Away Team', 'League', 'KSCW Team', 'Paid By', 'Amount (CHF)', 'Notes']
    const rows = expenses.map((e) => {
      const game = asObj<Game & BaseRecord>(e.game)
      const paidByMember = asObj<Member & BaseRecord>(e.paid_by_member)
      const paidBy = paidByMember
        ? `${paidByMember.first_name} ${paidByMember.last_name}`
        : e.paid_by_other || ''
      const teamObj = asObj<Team & BaseRecord>(e.team)
      return [
        game?.date ? formatDate(game.date) : '',
        game?.home_team || '',
        game?.away_team || '',
        game?.league || '',
        teamObj?.name || '',
        paidBy,
        e.amount ? e.amount.toFixed(2) : '',
        e.notes || '',
      ]
    })
    // Shared RFC 4180 encoder \u2014 also neutralises spreadsheet formula injection
    // (notes / team names are user-controllable).
    const csv = toCSV(header, rows)
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `referee-expenses${seasonFilter ? `-${seasonFilter}` : ''}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('refereeExpensesTitle')}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('refereeExpensesDescription')}</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          className="rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="">{t('refereeExpensesAllTeams')}</option>
          {vbTeams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>

        <select
          value={seasonFilter}
          onChange={(e) => setSeasonFilter(e.target.value)}
          className="rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="">{t('refereeExpensesAllSeasons')}</option>
          {seasons.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <button
          onClick={exportCsv}
          disabled={expenses.length === 0}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <Download className="h-4 w-4" />
          {t('refereeExpensesExport')}
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">…</div>
      ) : expenses.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">{t('refereeExpensesNoRecords')}</div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <Table>
            <TableHeader>
              <TableRow className="border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('refereeExpensesDate')}</TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('refereeExpensesGame')}</TableHead>
                <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('refereeExpensesTeam')}</TableHead>
                <TableHead className="hidden md:table-cell text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('refereeExpensesPaidBy')}</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('refereeExpensesAmount')}</TableHead>
                <TableHead className="hidden lg:table-cell text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('refereeExpensesNotes')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map((expense) => {
                const game = asObj<Game & BaseRecord>(expense.game)
                const team = asObj<Team & BaseRecord>(expense.team)
                const teamKey = team?.name && team?.sport
                  ? teamNameToColorKey(team.name, team.sport)
                  : team?.name || ''
                const paidByMember = asObj<Member & BaseRecord>(expense.paid_by_member)
                const paidBy = paidByMember
                  ? `${paidByMember.first_name} ${paidByMember.last_name}`
                  : expense.paid_by_other || '–'

                return (
                  <TableRow key={expense.id} className="border-gray-200 dark:border-gray-700">
                    <TableCell className="text-gray-900 dark:text-gray-100">
                      {game?.date ? formatDate(game.date) : '–'}
                    </TableCell>
                    <TableCell className="whitespace-normal text-gray-700 dark:text-gray-300">
                      <span className="block sm:inline">{game ? `${game.home_team} vs ${game.away_team}` : '–'}</span>
                      <span className="block sm:hidden text-xs text-gray-500 mt-0.5">{paidBy}</span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {teamKey && <TeamChip team={teamKey} size="xs" />}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-gray-900 dark:text-gray-100">{paidBy}</TableCell>
                    <TableCell className="text-right text-gray-900 dark:text-gray-100">
                      {expense.amount > 0 ? `CHF ${expense.amount.toFixed(2)}` : '–'}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell whitespace-normal text-gray-500 dark:text-gray-400">{expense.notes || '–'}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
