import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { Users, Gavel, HandCoins, Receipt, Pencil, Plus, ChevronDown } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import EmptyState from '../../components/EmptyState'
import { TeamPickerSingle, type TeamPickerOption } from '../../components/ui/TeamPicker'
import RefereeExpenseSection from '../games/components/RefereeExpenseSection'
import { useAuth } from '../../hooks/useAuth'
import { useAdminMode } from '../../hooks/useAdminMode'
import { useTeams } from '../../hooks/useTeams'
import { useTeamFinance, formatChf, toNum } from '../../hooks/useFinance'
import { useReportPageLoading } from '../../hooks/usePageReady'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import { currentSeasonShort, seasonStartYear } from '../../utils/season'
import type { Team } from '../../types'
import type { RefereeExpenseLine, TeamFinanceEntry, TeamHomeGame } from './types'
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
  const { memberTeamIds, coachTeamIds, captainTeamIds, teamsLoading } = useAuth()
  const { effectiveIsAdmin, effectiveIsVorstand } = useAdminMode()
  const { data: teamsRaw, isLoading: teamsQueryLoading } = useTeams('all')

  // Every active team ONLY in admin mode (admin / Vorstand with the toggle on —
  // CLAUDE.md: admin power applies only in admin mode). Off, or for the finance
  // role and everyone else: the teams you are on or lead. The endpoint
  // re-checks server-side; the treasurer's club-wide view is /admin/finance.
  const seesAll = effectiveIsAdmin || effectiveIsVorstand
  const myTeamIds = useMemo(
    () => new Set([...memberTeamIds, ...coachTeamIds, ...captainTeamIds].map(String)),
    [memberTeamIds, coachTeamIds, captainTeamIds],
  )
  const teams = useMemo(
    () => ((teamsRaw ?? []) as Team[]).filter((tm) => seesAll || myTeamIds.has(String(tm.id))),
    [teamsRaw, seesAll, myTeamIds],
  )

  const teamOptions = useMemo<TeamPickerOption[]>(
    () => teams.map((tm) => ({
      id: String(tm.id),
      label: tm.name,
      sport: tm.sport === 'volleyball' || tm.sport === 'basketball' ? tm.sport : null,
      active: tm.active !== false,
    })),
    [teams],
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
  // Referee-fee recorder: the game whose row is expanded. The expanded row
  // hosts the game modal's own editor (single writer); its onSaved refetches
  // so the fee shows up in the table + tiles without a reload.
  const [openGameId, setOpenGameId] = useState<number | null>(null)
  const toggleGame = (g: TeamHomeGame) => setOpenGameId((cur) => (cur === g.id ? null : g.id))

  // Report to the app boot gate — see usePageReady.tsx
  useReportPageLoading(teamsLoading || teamsQueryLoading || isLoading)

  // Fee per game id — the recorder table looks its row up by game.
  const refByGame = useMemo(() => {
    const map = new Map<string, RefereeExpenseLine>()
    for (const r of data?.referee_expenses ?? []) if (r.game) map.set(String(r.game.id), r)
    return map
  }, [data])

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
              <span className={labelCls}>{t('teamFinanceTeam')}</span>
              {/* Sport-grouped (Volleyball / Basketball + VB/BB badge) — the club-wide
                  list in admin mode holds both sports and team names alone don't say
                  which ('Herren 2 H3' is basketball). CLAUDE.md → team pickers. */}
              <TeamPickerSingle
                value={teamId}
                onChange={(id) => { if (id) setParam('team', id) }}
                teams={teamOptions}
                allowEmpty={false}
                className="mt-1 bg-white dark:bg-gray-800"
              />
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
                    <div className="flex flex-wrap justify-between gap-x-2 tabular-nums"><span>{t('teamFinanceIncome')}</span><span className="whitespace-nowrap text-green-600 dark:text-green-400">{formatChf(data.totals.income)}</span></div>
                    <div className="flex flex-wrap justify-between gap-x-2 tabular-nums"><span>{t('teamFinanceExpense')}</span><span className="whitespace-nowrap text-red-600 dark:text-red-400">{formatChf(data.totals.expense)}</span></div>
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

              {/* Referee fees per home game — one row per game, record/edit in place */}
              {data.home_games.length > 0 && (
                <section className="space-y-2">
                  <h2 className={sectionTitleCls}>{t('teamFinanceRefereeTitle')}</h2>
                  <div className={tableWrapCls}>
                    <Table>
                      <TableHeader>
                        <TableRow className="border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                          <TableHead className={thCls}>{t('colDate')}</TableHead>
                          <TableHead className={thCls}>{t('colGame')}</TableHead>
                          <TableHead className={`text-right ${thCls}`}>{t('colAmount')}</TableHead>
                          {data.can_record_referee && <TableHead className={thCls}><span className="sr-only">{t('refereeRecord')}</span></TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.home_games.map((g) => {
                          const fee = refByGame.get(String(g.id))
                          const editable = data.can_record_referee && !(fee?.payout && fee.payout_status !== 'cancelled')
                          const expanded = openGameId === g.id
                          return (
                            <Fragment key={g.id}>
                            <TableRow
                              className={`min-h-[44px] border-gray-200 dark:border-gray-700 ${editable ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40' : ''}`}
                              onClick={editable ? () => toggleGame(g) : undefined}
                            >
                              <TableCell className="whitespace-nowrap align-top text-xs text-gray-500 dark:text-gray-400">
                                {g.date ? formatDateCompactZurich(g.date) : '–'}
                              </TableCell>
                              <TableCell className="whitespace-normal break-words text-gray-900 dark:text-gray-100">
                                {g.home_team ?? '?'} – {g.away_team ?? '?'}
                                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                                  {fee ? (
                                    <>
                                      {fee.paid_by && <span>{t('refereePaidBy', { name: fee.paid_by })}</span>}
                                      <RefereeStatusPill row={fee} />
                                    </>
                                  ) : (
                                    <span className="text-amber-700 dark:text-amber-300">{t('refereeNotRecorded')}</span>
                                  )}
                                </span>
                              </TableCell>
                              <TableCell className="text-right align-top tabular-nums text-gray-700 dark:text-gray-300">
                                {fee ? formatChf(toNum(fee.amount)) : '–'}
                              </TableCell>
                              {data.can_record_referee && (
                                <TableCell className="text-right align-top">
                                  {editable && (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); toggleGame(g) }}
                                      aria-expanded={expanded}
                                      className={`inline-flex min-h-[36px] items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium ${expanded ? 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700' : fee ? 'text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-900/30' : 'bg-brand-600 text-white hover:bg-brand-700'}`}
                                    >
                                      {expanded ? <ChevronDown className="h-3.5 w-3.5 rotate-180" /> : fee ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                                      {expanded ? t('common:close') : fee ? t('refereeEdit') : t('refereeRecord')}
                                    </button>
                                  )}
                                </TableCell>
                              )}
                            </TableRow>
                            {expanded && teamId && (
                              <TableRow className="border-gray-200 dark:border-gray-700">
                                {/* The game modal's own editor, inline under the game's row. */}
                                <TableCell colSpan={data.can_record_referee ? 4 : 3} className="bg-gray-50/60 px-4 py-3 dark:bg-gray-900/30">
                                  <RefereeExpenseSection
                                    gameId={String(g.id)}
                                    teamId={String(teamId)}
                                    canEdit
                                    defaultOpen
                                    onSaved={() => void refetch()}
                                  />
                                </TableCell>
                              </TableRow>
                            )}
                            </Fragment>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              )}

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
                {data.home_games.length === 0 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t('teamFinanceRecordHint')}{' '}
                    <Link to="/games" className="font-medium text-brand-700 hover:underline dark:text-brand-300">{t('nav:games')} →</Link>
                  </p>
                )}
              </section>
            </div>
          )}
        </>
      )}

    </div>
  )
}
