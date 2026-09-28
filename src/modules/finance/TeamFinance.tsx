import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import Modal from '../../components/Modal'
import { Button } from '@/components/ui/button'
import IconButton from '@/components/IconButton'
import { TeamPickerSingle, type TeamPickerOption } from '@/components/ui/TeamPicker'
import { useConfirm } from '../../components/ConfirmProvider'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import DatePicker from '@/components/ui/DatePicker'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import { useTeams } from '../../hooks/useTeams'
import {
  useTeamsSummary, useTeamEntries, recordTeamEntry, deleteTeamEntry, formatChf, toNum,
  type TeamEntryKind,
} from '../../hooks/useFinance'
import type { Team } from '../../types'
import RefereeReimbursementCard from './RefereeReimbursementCard'

const labelCls = 'block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'
const inputCls = 'mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground sm:h-9 outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary/60 dark:bg-input/20'
// Native <select>: dark:bg-gray-800 is mandatory so the <option> list is dark too.
const selectCls = 'mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground sm:h-9 outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary/60 dark:bg-gray-800'
const apiErr = (e: unknown, fb: string) => (e as { body?: { error?: string } })?.body?.error || fb
const KINDS: TeamEntryKind[] = ['sponsoring', 'income', 'expense']
const netCls = (n: number) => (n >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')
const tableWrapCls = 'overflow-hidden rounded-2xl border border-hairline bg-card shadow-card'
const barCls = 'block h-3 animate-pulse rounded bg-stone-200/80 dark:bg-muted'
const noticeCls = 'rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground'
const errNoticeCls = 'rounded-xl border border-dashed border-red-300 py-10 text-center text-sm text-red-600 dark:border-red-800 dark:text-red-400'

/** Placeholder rows while a team's entries are in flight — never a verdict. */
function TeamEntriesSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-hairline bg-card" aria-busy="true">
      <Table>
        <TableBody>
          {[0, 1, 2].map((i) => (
            <TableRow key={i}>
              <TableCell><span className={`${barCls} w-16`} aria-hidden="true" /></TableCell>
              <TableCell><span className={`${barCls} w-40 max-w-full`} aria-hidden="true" /></TableCell>
              <TableCell><span className={`${barCls} ml-auto w-16`} aria-hidden="true" /></TableCell>
              <TableCell><span className={`${barCls} ml-auto w-7`} aria-hidden="true" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** A team's entries, shown when its summary row is expanded. */
function TeamEntries({ teamId, fiscalYearId, onChanged }: { teamId: number; fiscalYearId: string; onChanged: () => void }) {
  const { t } = useTranslation('finance')
  const confirm = useConfirm()
  const { data: entries, isLoading, isError, isPlaceholderData: entriesStale, refetch } = useTeamEntries(teamId, fiscalYearId)
  const [busyDel, setBusyDel] = useState<number | null>(null)
  const [delErr, setDelErr] = useState('')
  const kindLabel = (k: string) => ({ sponsoring: t('teamKindSponsoring'), income: t('teamKindIncome'), expense: t('teamKindExpense') }[k] ?? k)
  async function remove(id: number) {
    if (!(await confirm({ message: t('teamEntryDeleteSure'), danger: true }))) return
    setBusyDel(id); setDelErr('')
    try { await deleteTeamEntry(id); await refetch(); onChanged() }
    catch (e) { setDelErr(apiErr(e, t('ledActionError'))) }
    finally { setBusyDel(null) }
  }
  const rows = entries ?? []
  // An empty `rows` used to mean both "this team has booked nothing" and "the expand
  // has not been answered yet" — so every expand asserted "No entries for this team."
  // for a whole round-trip, and a 403/500 said the same thing forever. The isError
  // escape matters: TanStack leaves `entries` undefined on a failed fetch too.
  // isPlaceholderData is load-bearing: the key carries the fiscal year and
  // placeholderData: keepPreviousData is a global default (src/lib/query.tsx:83),
  // so a year switch returns LAST year's entries with isLoading already false.
  const pending = !isError && (isLoading || entriesStale || entries === undefined)
  if (pending) return <TeamEntriesSkeleton />
  if (isError) return <p className="py-3 text-center text-xs text-red-600 dark:text-red-400">{t('common:error')}</p>
  if (rows.length === 0) return <p className="py-3 text-center text-xs text-muted-foreground/80">{t('teamNoEntries')}</p>
  return (
    <>
    <div className="overflow-hidden rounded-xl border border-hairline bg-card">
      <Table>
        <TableBody>
          {rows.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{e.entry_date ? formatDateCompactZurich(e.entry_date) : '–'}</TableCell>
              <TableCell className="whitespace-normal break-words text-foreground/85">
                {kindLabel(e.kind)}{e.label ? ` · ${e.label}` : ''}{e.sponsor ? ` · ${e.sponsor}` : ''}
              </TableCell>
              <TableCell className={`text-right tabular-nums ${e.kind === 'expense' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                {e.kind === 'expense' ? '−' : '+'}{formatChf(toNum(e.amount))}
              </TableCell>
              <TableCell className="text-right">
                <IconButton size="sm" variant="outline" disabled={busyDel === e.id} onClick={() => remove(e.id)} label={t('teamEntryDelete')}
                  className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400">
                  {busyDel === e.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                </IconButton>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
    {delErr && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{delErr}</p>}
    </>
  )
}

function AddTeamEntryModal({ open, onClose, fiscalYearId, presetTeam, onDone }: {
  open: boolean; onClose: () => void; fiscalYearId: string; presetTeam?: number | null; onDone: () => void
}) {
  const { t } = useTranslation('finance')
  const { data: teamsRaw } = useTeams('all')
  // Sport-grouped picker (CLAUDE.md → team pickers): a finance admin sees both
  // sports, and a team name alone doesn't say which one it is.
  const teamOptions = useMemo<TeamPickerOption[]>(
    () => ((teamsRaw ?? []) as Team[]).map((tm) => ({
      id: String(tm.id),
      label: tm.name,
      sport: tm.sport === 'volleyball' || tm.sport === 'basketball' ? tm.sport : null,
      active: tm.active !== false,
    })),
    [teamsRaw],
  )
  const [team, setTeam] = useState('')
  const [kind, setKind] = useState<TeamEntryKind>('sponsoring')
  const [amount, setAmount] = useState('')
  const [label, setLabel] = useState('')
  const [sponsor, setSponsor] = useState('')
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const teamId = presetTeam != null ? presetTeam : Number(team)
  const amt = Number(amount.replace(',', '.'))
  const valid = Number.isInteger(teamId) && teamId > 0 && amt >= 0 && amount.trim() !== ''

  async function submit() {
    if (!valid) return
    setBusy(true); setError('')
    try {
      await recordTeamEntry({
        team: teamId, fiscal_year: Number(fiscalYearId) || null, kind, amount: amt,
        label: label.trim() || null, sponsor: kind !== 'expense' ? (sponsor.trim() || null) : null, entry_date: date || null,
      })
      setAmount(''); setLabel(''); setSponsor('')
      onDone(); onClose()
    } catch (e) { setError(apiErr(e, t('teamEntrySaveError'))) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('teamAddEntry')}>
      <div className="space-y-3">
        {presetTeam == null && (
          <div>
            <span className={labelCls}>{t('teamLabel')}</span>
            <TeamPickerSingle
              value={team || null}
              onChange={(id) => setTeam(id ?? '')}
              teams={teamOptions}
              allowEmpty={false}
              placeholder={t('selectTeam')}
              className="mt-1"
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="tf-kind" className={labelCls}>{t('teamEntryKind')}</label>
            <select id="tf-kind" value={kind} onChange={(e) => setKind(e.target.value as TeamEntryKind)} className={selectCls}>
              {KINDS.map((k) => <option key={k} value={k}>{t(`teamKind${k.charAt(0).toUpperCase()}${k.slice(1)}`)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="tf-amount" className={labelCls}>{t('invoiceAmount')}</label>
            <input id="tf-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className={inputCls} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="tf-entry-label" className={labelCls}>{t('teamEntryLabel')}</label>
            <input id="tf-entry-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('teamEntryLabelPlaceholder')} className={inputCls} />
          </div>
          <div>
            <DatePicker id="tf-date" label={t('payDate')} value={date} onChange={setDate} />
          </div>
        </div>
        {kind !== 'expense' && (
          <div>
            <label htmlFor="tf-sponsor" className={labelCls}>{t('teamSponsor')}</label>
            <input id="tf-sponsor" value={sponsor} onChange={(e) => setSponsor(e.target.value)} placeholder={t('teamSponsorPlaceholder')} className={inputCls} />
          </div>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" disabled={!valid || busy} onClick={submit}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{t('teamAddCta')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** Shared header so the loading placeholder has the exact shape of the real table. */
function TeamsHead() {
  const { t } = useTranslation('finance')
  return (
    <TableHeader>
      <TableRow>
        <TableHead>{t('teamLabel')}</TableHead>
        <TableHead className={"text-right"}>{t('teamColIncome')}</TableHead>
        <TableHead className={"hidden sm:table-cell text-right"}>{t('teamColExpense')}</TableHead>
        <TableHead className={"text-right"}>{t('teamColNet')}</TableHead>
        <TableHead className={"hidden sm:table-cell text-right"}>{t('teamColOpenBills')}</TableHead>
        {/* Club-reimbursed referee fees — informational, never part of net. */}
        <TableHead className={"hidden sm:table-cell text-right"}>{t('teamColReferee')}</TableHead>
      </TableRow>
    </TableHeader>
  )
}

/** Placeholder rows while the per-team summary is in flight — no totals, no verdict. */
function TeamsSkeleton() {
  return (
    <div className={tableWrapCls} aria-busy="true">
      <Table>
        <TeamsHead />
        <TableBody>
          {[0, 1, 2, 3, 4].map((i) => (
            <TableRow key={i}>
              <TableCell><span className={`${barCls} w-28 max-w-full`} aria-hidden="true" /></TableCell>
              <TableCell><span className={`${barCls} ml-auto w-16`} aria-hidden="true" /></TableCell>
              <TableCell className="hidden sm:table-cell"><span className={`${barCls} ml-auto w-16`} aria-hidden="true" /></TableCell>
              <TableCell><span className={`${barCls} ml-auto w-16`} aria-hidden="true" /></TableCell>
              <TableCell className="hidden sm:table-cell"><span className={`${barCls} ml-auto w-16`} aria-hidden="true" /></TableCell>
              <TableCell className="hidden sm:table-cell"><span className={`${barCls} ml-auto w-16`} aria-hidden="true" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export default function TeamFinance({ fiscalYearId, fiscalYearLabel }: { fiscalYearId: string; fiscalYearLabel: string }) {
  const { t } = useTranslation('finance')
  const { data: rows, isLoading, isError, isPlaceholderData: rowsStale, refetch } = useTeamsSummary(fiscalYearId, !!fiscalYearId)
  const [showAdd, setShowAdd] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const teams = rows ?? []
  // An empty `teams` used to mean both "no team has booked anything" and "the summary
  // has not arrived yet" — the tab printed the definitive dashed empty box for both,
  // for a full round-trip, on every first visit. `rows === undefined` also covers the
  // window where fiscalYearId is still '' (query disabled ⇒ isLoading false, same
  // gotcha as FinancePage's boot flag), and the isError escape stops a failed request
  // from parking on the skeleton forever.
  // Same year-keyed staleness as above; and gate on having a fiscal year at all,
  // since a disabled query never leaves 'pending'.
  const pending = !!fiscalYearId && !isError && (isLoading || rowsStale || rows === undefined)
  const totals = teams.reduce(
    (a, r) => ({ income: a.income + r.income, expense: a.expense + r.expense, net: a.net + r.net, open: a.open + r.invoice_open, referee: a.referee + toNum(r.referee_total) }),
    { income: 0, expense: 0, net: 0, open: 0, referee: 0 },
  )

  return (
    <div className="space-y-4">
      {/* Season-end referee reimbursement — the fiscal-year label IS the season label ("2026/27"). */}
      {fiscalYearLabel && <RefereeReimbursementCard season={fiscalYearLabel} />}

      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">{t('teamFinanceHint', { year: fiscalYearLabel })}</p>
        <Button type="button" className="shrink-0" onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4" />{t('teamAddEntry')}
        </Button>
      </div>

      {pending ? (
        <TeamsSkeleton />
      ) : isError ? (
        <p className={errNoticeCls}>{t('common:error')}</p>
      ) : teams.length === 0 ? (
        <p className={noticeCls}>{t('teamNoData')}</p>
      ) : (
        <div className={tableWrapCls}>
          <Table>
            <TeamsHead />
            <TableBody>
              {teams.map((r) => (
                <Fragment key={r.team}>
                  <TableRow className="cursor-pointer hover:bg-muted" onClick={() => setExpanded((p) => (p === r.team ? null : r.team))}>
                    <TableCell className="whitespace-normal break-words text-foreground">
                      <span className="mr-1 inline-block align-middle text-muted-foreground/80">
                        {expanded === r.team ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </span>
                      {r.team_name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-green-600 dark:text-green-400">{formatChf(r.income)}</TableCell>
                    <TableCell className="hidden sm:table-cell text-right tabular-nums text-red-600 dark:text-red-400">{formatChf(r.expense)}</TableCell>
                    <TableCell className={`text-right tabular-nums font-semibold ${netCls(r.net)}`}>{formatChf(r.net)}</TableCell>
                    <TableCell className="hidden sm:table-cell text-right tabular-nums text-muted-foreground">{formatChf(r.invoice_open)}</TableCell>
                    <TableCell className="hidden sm:table-cell text-right tabular-nums text-muted-foreground/80">{formatChf(toNum(r.referee_total))}</TableCell>
                  </TableRow>
                  {expanded === r.team && (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-surface-sunken p-2">
                        <TeamEntries teamId={r.team} fiscalYearId={fiscalYearId} onChanged={refetch} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
              <TableRow className="border-t-2 border-border font-semibold">
                <TableCell className="text-foreground">{t('teamColTotal')}</TableCell>
                <TableCell className="text-right tabular-nums text-green-600 dark:text-green-400">{formatChf(totals.income)}</TableCell>
                <TableCell className="hidden sm:table-cell text-right tabular-nums text-red-600 dark:text-red-400">{formatChf(totals.expense)}</TableCell>
                <TableCell className={`text-right tabular-nums ${netCls(totals.net)}`}>{formatChf(totals.net)}</TableCell>
                <TableCell className="hidden sm:table-cell text-right tabular-nums text-muted-foreground">{formatChf(totals.open)}</TableCell>
                <TableCell className="hidden sm:table-cell text-right tabular-nums text-muted-foreground/80">{formatChf(totals.referee)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      <AddTeamEntryModal open={showAdd} onClose={() => setShowAdd(false)} fiscalYearId={fiscalYearId} onDone={refetch} />
    </div>
  )
}
