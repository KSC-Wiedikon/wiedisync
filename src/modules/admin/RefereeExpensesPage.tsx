import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { saveFile } from '@/utils/saveFile'
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
import { toNum, formatChf } from '../../hooks/useFinance'

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
      // CSV export → keep the LEGAL name (not the nickname), consistent with the
      // exports-stay-legal rule for reimbursement/financial records.
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
        toNum(e.amount) ? toNum(e.amount).toFixed(2) : '',
        e.notes || '',
      ]
    })
    // Shared RFC 4180 encoder \u2014 also neutralises spreadsheet formula injection
    // (notes / team names are user-controllable).
    const csv = toCSV(header, rows)
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    saveFile(blob, `referee-expenses${seasonFilter ? `-${seasonFilter}` : ''}.csv`)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{t('refereeExpensesTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('refereeExpensesDescription')}</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          className="h-11 rounded-lg border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 dark:bg-gray-800"
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
          className="h-11 rounded-lg border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 dark:bg-gray-800"
        >
          <option value="">{t('refereeExpensesAllSeasons')}</option>
          {seasons.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <Button variant="outline"
          onClick={exportCsv}
          disabled={expenses.length === 0}
          className="ml-auto"
        >
          <Download className="h-4 w-4" />
          {t('refereeExpensesExport')}
        </Button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">…</div>
      ) : expenses.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">{t('refereeExpensesNoRecords')}</div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-hairline bg-card shadow-card">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead>{t('refereeExpensesDate')}</TableHead>
                <TableHead>{t('refereeExpensesGame')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('refereeExpensesTeam')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('refereeExpensesPaidBy')}</TableHead>
                <TableHead className="text-right">{t('refereeExpensesAmount')}</TableHead>
                <TableHead className="hidden lg:table-cell">{t('refereeExpensesNotes')}</TableHead>
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
                  ? `${paidByMember.nickname || paidByMember.first_name} ${paidByMember.last_name}`
                  : expense.paid_by_other || '–'

                return (
                  <TableRow key={expense.id} className="border-border">
                    <TableCell className="text-foreground">
                      {game?.date ? formatDate(game.date) : '–'}
                    </TableCell>
                    <TableCell className="whitespace-normal text-foreground/85">
                      <span className="block sm:inline">{game ? `${game.home_team} vs ${game.away_team}` : '–'}</span>
                      <span className="block sm:hidden text-xs text-muted-foreground mt-0.5">{paidBy}</span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {teamKey && <TeamChip team={teamKey} size="xs" />}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-foreground">{paidBy}</TableCell>
                    <TableCell className="text-right tabular-nums text-foreground">
                      {toNum(expense.amount) > 0 ? formatChf(expense.amount) : '–'}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell whitespace-normal text-muted-foreground">{expense.notes || '–'}</TableCell>
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
