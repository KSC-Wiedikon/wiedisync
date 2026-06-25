import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import Modal from '../../components/Modal'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import { useTeams } from '../../hooks/useTeams'
import {
  useTeamsSummary, useTeamEntries, recordTeamEntry, deleteTeamEntry, formatChf, toNum,
  type TeamEntryKind,
} from '../../hooks/useFinance'
import type { Team } from '../../types'

const labelCls = 'block text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'
const inputCls = 'mt-1 w-full rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
const apiErr = (e: unknown, fb: string) => (e as { body?: { error?: string } })?.body?.error || fb
const KINDS: TeamEntryKind[] = ['sponsoring', 'income', 'expense']
const netCls = (n: number) => (n >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')

/** A team's entries, shown when its summary row is expanded. */
function TeamEntries({ teamId, fiscalYearId, onChanged }: { teamId: number; fiscalYearId: string; onChanged: () => void }) {
  const { t } = useTranslation('finance')
  const { data: entries, refetch } = useTeamEntries(teamId, fiscalYearId)
  const [busyDel, setBusyDel] = useState<number | null>(null)
  const kindLabel = (k: string) => ({ sponsoring: t('teamKindSponsoring'), income: t('teamKindIncome'), expense: t('teamKindExpense') }[k] ?? k)
  async function remove(id: number) {
    if (!window.confirm(t('teamEntryDeleteSure'))) return
    setBusyDel(id)
    try { await deleteTeamEntry(id); await refetch(); onChanged() } finally { setBusyDel(null) }
  }
  const rows = entries ?? []
  if (rows.length === 0) return <p className="py-3 text-center text-xs text-gray-400">{t('teamNoEntries')}</p>
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700">
      <Table>
        <TableBody>
          {rows.map((e) => (
            <TableRow key={e.id} className="border-gray-200 dark:border-gray-700">
              <TableCell className="whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">{e.entry_date ? formatDateCompactZurich(e.entry_date) : '–'}</TableCell>
              <TableCell className="whitespace-normal break-words text-gray-700 dark:text-gray-300">
                {kindLabel(e.kind)}{e.label ? ` · ${e.label}` : ''}{e.sponsor ? ` · ${e.sponsor}` : ''}
              </TableCell>
              <TableCell className={`text-right tabular-nums ${e.kind === 'expense' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                {e.kind === 'expense' ? '−' : '+'}{formatChf(toNum(e.amount))}
              </TableCell>
              <TableCell className="text-right">
                <button type="button" disabled={busyDel === e.id} onClick={() => remove(e.id)} aria-label={t('teamEntryDelete')}
                  className="inline-flex items-center rounded-md border border-gray-300 p-1.5 text-gray-500 hover:bg-gray-50 hover:text-red-600 disabled:opacity-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700">
                  {busyDel === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function AddTeamEntryModal({ open, onClose, fiscalYearId, presetTeam, onDone }: {
  open: boolean; onClose: () => void; fiscalYearId: string; presetTeam?: number | null; onDone: () => void
}) {
  const { t } = useTranslation('finance')
  const { data: teamsRaw } = useTeams('all')
  const teams = (teamsRaw ?? []) as Team[]
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
            <label htmlFor="tf-team" className={labelCls}>{t('teamLabel')}</label>
            <select id="tf-team" value={team} onChange={(e) => setTeam(e.target.value)} className={`${inputCls} dark:bg-gray-800`}>
              <option value="">{t('selectTeam')}</option>
              {teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="tf-kind" className={labelCls}>{t('teamEntryKind')}</label>
            <select id="tf-kind" value={kind} onChange={(e) => setKind(e.target.value as TeamEntryKind)} className={`${inputCls} dark:bg-gray-800`}>
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
            <label htmlFor="tf-date" className={labelCls}>{t('payDate')}</label>
            <input id="tf-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} dark:bg-gray-800`} />
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
          <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">{t('cancel')}</button>
          <button type="button" disabled={!valid || busy} onClick={submit}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{t('teamAddCta')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default function TeamFinance({ fiscalYearId, fiscalYearLabel }: { fiscalYearId: string; fiscalYearLabel: string }) {
  const { t } = useTranslation('finance')
  const { data: rows, refetch } = useTeamsSummary(fiscalYearId, !!fiscalYearId)
  const [showAdd, setShowAdd] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const teams = rows ?? []
  const totals = teams.reduce((a, r) => ({ income: a.income + r.income, expense: a.expense + r.expense, net: a.net + r.net, open: a.open + r.invoice_open }), { income: 0, expense: 0, net: 0, open: 0 })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">{t('teamFinanceHint', { year: fiscalYearLabel })}</p>
        <button type="button" onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
          <Plus className="h-4 w-4" />{t('teamAddEntry')}
        </button>
      </div>

      {teams.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">{t('teamNoData')}</p>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <Table>
            <TableHeader>
              <TableRow className="border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('teamLabel')}</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('teamColIncome')}</TableHead>
                <TableHead className="hidden sm:table-cell text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('teamColExpense')}</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('teamColNet')}</TableHead>
                <TableHead className="hidden sm:table-cell text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('teamColOpenBills')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams.map((r) => (
                <Fragment key={r.team}>
                  <TableRow className="cursor-pointer border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/40" onClick={() => setExpanded((p) => (p === r.team ? null : r.team))}>
                    <TableCell className="whitespace-normal break-words text-gray-900 dark:text-gray-100">
                      <span className="mr-1 inline-block align-middle text-gray-400">
                        {expanded === r.team ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </span>
                      {r.team_name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-green-600 dark:text-green-400">{formatChf(r.income)}</TableCell>
                    <TableCell className="hidden sm:table-cell text-right tabular-nums text-red-600 dark:text-red-400">{formatChf(r.expense)}</TableCell>
                    <TableCell className={`text-right tabular-nums font-semibold ${netCls(r.net)}`}>{formatChf(r.net)}</TableCell>
                    <TableCell className="hidden sm:table-cell text-right tabular-nums text-gray-600 dark:text-gray-300">{formatChf(r.invoice_open)}</TableCell>
                  </TableRow>
                  {expanded === r.team && (
                    <TableRow className="border-gray-200 dark:border-gray-700">
                      <TableCell colSpan={5} className="bg-gray-50/60 p-2 dark:bg-gray-900/20">
                        <TeamEntries teamId={r.team} fiscalYearId={fiscalYearId} onChanged={refetch} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
              <TableRow className="border-t-2 border-gray-300 font-semibold dark:border-gray-600">
                <TableCell className="text-gray-900 dark:text-gray-100">{t('teamColTotal')}</TableCell>
                <TableCell className="text-right tabular-nums text-green-600 dark:text-green-400">{formatChf(totals.income)}</TableCell>
                <TableCell className="hidden sm:table-cell text-right tabular-nums text-red-600 dark:text-red-400">{formatChf(totals.expense)}</TableCell>
                <TableCell className={`text-right tabular-nums ${netCls(totals.net)}`}>{formatChf(totals.net)}</TableCell>
                <TableCell className="hidden sm:table-cell text-right tabular-nums text-gray-600 dark:text-gray-300">{formatChf(totals.open)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      <AddTeamEntryModal open={showAdd} onClose={() => setShowAdd(false)} fiscalYearId={fiscalYearId} onDone={refetch} />
    </div>
  )
}
