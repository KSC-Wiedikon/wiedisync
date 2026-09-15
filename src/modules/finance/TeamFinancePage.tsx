import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { Users, Gavel, HandCoins, Receipt } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import EmptyState from '../../components/EmptyState'
import { useAuth } from '../../hooks/useAuth'
import { useAdminMode } from '../../hooks/useAdminMode'
import { useTeams } from '../../hooks/useTeams'
import { useTeamFinance, formatChf, toNum } from '../../hooks/useFinance'
import { useReportPageLoading } from '../../hooks/usePageReady'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import { currentSeasonShort, seasonStartYear } from '../../utils/season'
import type { Team } from '../../types'
import type { RefereeExpenseLine, TeamFinanceEntry } from './types'
import InvoiceTable from './InvoiceTable'
import { RefereeStatusPill } from './MyRefereeExpensesCard'

const selectCls = 'min-h-[44px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
const labelCls = 'block text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'
const tileCls = 'rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800'
const tileLabelCls = 'text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'
const sectionTitleCls = 'text-sm font-semibold text-gray-900 dark:text-gray-100'
const tableWrapCls = 'rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
const thCls = 'text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400'
const noticeCls = 'rounded-lg border border-dashed border-gray-300 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400'
const errNoticeCls = 'rounded-lg border border-dashed border-red-300 py-10 text-center text-sm text-red-600 dark:border-red-800 dark:text-red-400'
const netCls = (n: number) => (n >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')

/** Current season + the previous one — the two the club still looks at. */
function seasonOptions(): string[] {
  const y = seasonStartYear()
  return [currentSeasonShort(), `${y - 1}/${String(y).slice(2)}`]
}

/** The entries table mixes the Teamkasse bookings with the referee fees, newest first. */
type LedgerRow =
  | { key: string; kind: 'entry'; date: string | null; entry: TeamFinanceEntry }
  | { key: string; kind: 'referee'; date: string | null; ref: RefereeExpenseLine }

/**
 * Team finance — read-only for every roster member: the season's Teamkasse
 * entries, the team's bills (payable only for a lead / finance) and the referee
 * fees paid at home games. Referee fees are club-reimbursed and shown as a
 * subtotal that never enters the team's net.
 */
export default function TeamFinancePage() {
  const { t } = useTranslation('finance')
  const [params, setParams] = useSearchParams()
  const { memberTeamIds, coachTeamIds, captainTeamIds, canAccessFinance, teamsLoading } = useAuth()
  const { effectiveIsAdmin } = useAdminMode()
  const { data: teamsRaw, isLoading: teamsQueryLoading } = useTeams('all')

  // Finance / admin (in admin mode) may open any active team; everyone else
  // only the teams they are on or lead. The endpoint re-checks server-side.
  const seesAll = canAccessFinance || effectiveIsAdmin
  const myTeamIds = useMemo(
    () => new Set([...memberTeamIds, ...coachTeamIds, ...captainTeamIds].map(String)),
    [memberTeamIds, coachTeamIds, captainTeamIds],
  )
  const teams = useMemo(
    () => ((teamsRaw ?? []) as Team[]).filter((tm) => seesAll || myTeamIds.has(String(tm.id))),
    [teamsRaw, seesAll, myTeamIds],
  )

  const seasons = useMemo(() => seasonOptions(), [])
  const seasonParam = params.get('season')
  const season = seasonParam && seasons.includes(seasonParam) ? seasonParam : seasons[0]
  const teamParam = params.get('team')
  const teamId = teamParam && teams.some((tm) => String(tm.id) === teamParam)
    ? teamParam
    : (teams[0] ? String(teams[0].id) : null)

  function setParam(key: 'team' | 'season', value: string) {
    const next = new URLSearchParams(params)
    next.set(key, value)
    setParams(next, { replace: true })
  }

  const { data, isLoading, isError, isPlaceholderData, refetch } = useTeamFinance(teamId, season)

  // Report to the app boot gate — see usePageReady.tsx
  useReportPageLoading(teamsLoading || teamsQueryLoading || isLoading)

  const rows = useMemo<LedgerRow[]>(() => {
    if (!data) return []
    const list: LedgerRow[] = [
      ...data.entries.map((e) => ({ key: `e${e.id}`, kind: 'entry' as const, date: e.entry_date, entry: e })),
      ...data.referee_expenses.map((r) => ({ key: `r${r.id}`, kind: 'referee' as const, date: r.game?.date ?? r.date_created, ref: r })),
    ]
    // ISO dates sort lexicographically; undated rows sink to the bottom.
    return list.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  }, [data])

  const kindLabel = (k: TeamFinanceEntry['kind']) =>
    ({ sponsoring: t('teamKindSponsoring'), income: t('teamKindIncome'), expense: t('teamKindExpense') }[k] ?? k)

  const noTeams = !teamsLoading && !teamsQueryLoading && teams.length === 0

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-gray-100">
          <Users className="h-5 w-5 text-brand-600 dark:text-brand-400" />
          {t('teamFinanceTitle')}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('teamFinanceSubtitle')}</p>
      </div>

      {noTeams ? (
        <EmptyState icon={<Users className="h-10 w-10" />} title={t('teamFinanceNoTeams')} />
      ) : (
        <>
          {/* Team + season pickers */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="tf-team" className={labelCls}>{t('teamFinanceTeam')}</label>
              <select id="tf-team" value={teamId ?? ''} onChange={(e) => setParam('team', e.target.value)} className={`mt-1 ${selectCls}`}>
                {teams.map((tm) => <option key={tm.id} value={String(tm.id)}>{tm.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="tf-season" className={labelCls}>{t('teamFinanceSeason')}</label>
              <select id="tf-season" value={season} onChange={(e) => setParam('season', e.target.value)} className={`mt-1 ${selectCls}`}>
                {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {isError ? (
            <p className={errNoticeCls}>{t('common:error')}</p>
          ) : !data ? (
            <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">…</div>
          ) : (
            // Previous team/season stays on screen while the new one loads
            // (placeholderData: keepPreviousData) — dim it so it never reads as final.
            <div className={`space-y-6 transition-opacity ${isPlaceholderData ? 'opacity-50' : ''}`} aria-busy={isPlaceholderData}>
              {data.fiscal_year == null && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
                  {t('teamFinanceNoFiscalYear')}
                </p>
              )}

              {/* Totals */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className={tileCls}>
                  <div className={tileLabelCls}>{t('teamFinanceNet')}</div>
                  <div className={`mt-1.5 text-2xl font-bold tabular-nums ${netCls(toNum(data.totals.net))}`}>{formatChf(data.totals.net)}</div>
                  <div className="mt-1 space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                    <div className="flex justify-between gap-2 tabular-nums"><span>{t('teamFinanceIncome')}</span><span className="text-green-600 dark:text-green-400">{formatChf(data.totals.income)}</span></div>
                    <div className="flex justify-between gap-2 tabular-nums"><span>{t('teamFinanceExpense')}</span><span className="text-red-600 dark:text-red-400">{formatChf(data.totals.expense)}</span></div>
                  </div>
                </div>
                <div className={tileCls}>
                  <div className={tileLabelCls}>{t('teamFinanceOpenBills')}</div>
                  <div className={`mt-1.5 text-2xl font-bold tabular-nums ${toNum(data.totals.invoice_open) > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>
                    {formatChf(data.totals.invoice_open)}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <Receipt className="h-3.5 w-3.5" /> {formatChf(data.totals.invoice_total)}
                  </div>
                </div>
                <div className={tileCls}>
                  <div className={tileLabelCls}>{t('teamFinanceRefereeTotal')}</div>
                  <div className="mt-1.5 text-2xl font-bold tabular-nums text-gray-500 dark:text-gray-400">{formatChf(data.totals.referee_total)}</div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <HandCoins className="h-3.5 w-3.5" /> {t('myRefereeSubtitle')}
                  </div>
                </div>
                <Link to="/fines?scope=team" className={`${tileCls} block transition-colors hover:border-brand-300 dark:hover:border-brand-700`}>
                  <div className={tileLabelCls}>{t('teamFinanceOpenFines')}</div>
                  <div className={`mt-1.5 text-2xl font-bold tabular-nums ${toNum(data.totals.team_fines_open) > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-gray-900 dark:text-gray-100'}`}>
                    {formatChf(data.totals.team_fines_open)}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-brand-700 dark:text-brand-300">
                    <Gavel className="h-3.5 w-3.5" /> {t('teamFinanceFinesLink')} →
                  </div>
                </Link>
              </div>

              {/* Team bills */}
              <section className="space-y-2">
                <h2 className={sectionTitleCls}>{t('teamFinanceBillsTitle')}</h2>
                {data.invoices.length === 0 ? (
                  <p className={noticeCls}>{t('teamFinanceNoBills')}</p>
                ) : (
                  <div className={tableWrapCls}>
                    <InvoiceTable invoices={data.invoices} canPay={data.can_pay} onPaid={refetch} />
                  </div>
                )}
              </section>

              {/* Entries + referee fees */}
              <section className="space-y-2">
                <h2 className={sectionTitleCls}>{t('teamFinanceEntriesTitle')}</h2>
                {rows.length === 0 ? (
                  <p className={noticeCls}>{t('teamFinanceNoEntries')}</p>
                ) : (
                  <div className={tableWrapCls}>
                    <Table>
                      <TableHeader>
                        <TableRow className="border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                          <TableHead className={thCls}>{t('colDate')}</TableHead>
                          <TableHead className={thCls}>{t('teamFinanceEntriesTitle')}</TableHead>
                          <TableHead className={`text-right ${thCls}`}>{t('colAmount')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((row) => (
                          <TableRow key={row.key} className="min-h-[44px] border-gray-200 dark:border-gray-700">
                            <TableCell className="whitespace-nowrap align-top text-xs text-gray-500 dark:text-gray-400">
                              {row.date ? formatDateCompactZurich(row.date) : '–'}
                            </TableCell>
                            {row.kind === 'entry' ? (
                              <>
                                <TableCell className="whitespace-normal break-words text-gray-900 dark:text-gray-100">
                                  {kindLabel(row.entry.kind)}
                                  {row.entry.label ? ` · ${row.entry.label}` : ''}
                                  {row.entry.sponsor ? ` · ${row.entry.sponsor}` : ''}
                                </TableCell>
                                <TableCell className={`text-right align-top tabular-nums ${row.entry.kind === 'expense' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                                  {row.entry.kind === 'expense' ? '−' : '+'}{formatChf(toNum(row.entry.amount))}
                                </TableCell>
                              </>
                            ) : (
                              <>
                                <TableCell className="whitespace-normal break-words text-gray-700 dark:text-gray-300">
                                  <span className="text-gray-500 dark:text-gray-400">{t('teamKindReferee')}</span>
                                  {row.ref.game && ` · ${row.ref.game.home_team ?? '?'} – ${row.ref.game.away_team ?? '?'}`}
                                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                                    {row.ref.paid_by && <span>{t('refereePaidBy', { name: row.ref.paid_by })}</span>}
                                    <RefereeStatusPill row={row.ref} />
                                  </span>
                                </TableCell>
                                {/* Club-reimbursed — shown for the record, NOT part of the team's net. */}
                                <TableCell className="text-right align-top tabular-nums text-gray-400 dark:text-gray-500">
                                  {formatChf(toNum(row.ref.amount))}
                                </TableCell>
                              </>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('teamFinanceRecordHint')}{' '}
                  <Link to="/games" className="font-medium text-brand-700 hover:underline dark:text-brand-300">{t('nav:games')} →</Link>
                </p>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  )
}
