import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Undo2, Trash2, BookOpen, ListTree, Scale, Lock, Settings2, RefreshCw } from 'lucide-react'
import Modal from '../../components/Modal'
import { Button } from '@/components/ui/button'
import IconButton from '@/components/IconButton'
import { useConfirm } from '../../components/ConfirmProvider'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import DatePicker from '@/components/ui/DatePicker'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import ReportExportMenu from './ReportExportMenu'
import type { FinanceReport } from './reportExport'
import {
  useLedgerAccounts, useLedgerEntries, useLedgerTrialBalance, useLedgerFiscalYears, useLedgerSettings,
  createLedgerAccount, editLedgerAccount, postLedgerEntry, reverseLedgerEntry, deleteLedgerEntry,
  closeLedgerYear, saveLedgerSettings, reconcileLedger, useLedgerIncomeMap, saveLedgerIncomeMap, autoMapIncome, formatChf, toNum,
  ACCOUNT_TYPES, type LedgerAccount, type LedgerSettings,
} from '../../hooks/useFinance'

const labelCls = 'block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'
const inputCls = 'mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm sm:h-9 dark:bg-gray-800 text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const selectCls = `${inputCls} dark:bg-gray-800`
const apiErr = (e: unknown, fb: string) => (e as { body?: { error?: string } })?.body?.error || fb
// Stand-in for a table that has not been read yet — same shape as ExpensesTab /
// TkExpensesPage, so "still loading" never looks like "the books are empty".
const Spinner = () => <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground/80" /></div>

type Section = 'journal' | 'accounts' | 'trial' | 'close' | 'settings'

export default function LedgerTab({ fiscalYearId }: { fiscalYearId?: string | number | null }) {
  const { t } = useTranslation('finance')
  const [section, setSection] = useState<Section>('journal')
  const { data: years, isLoading: fyLoading } = useLedgerFiscalYears()
  // Follows the single global fiscal-year selector in the FinancePage header — no
  // second dropdown here.
  const fyId = String(fiscalYearId ?? '')
  const activeFy = useMemo(() => (years ?? []).find((y) => String(y.id) === fyId) ?? (years ?? [])[0], [years, fyId])
  const effFy = activeFy ? String(activeFy.id) : ''

  const SECTIONS: { key: Section; icon: typeof BookOpen; label: string }[] = [
    { key: 'journal', icon: BookOpen, label: t('ledJournal') },
    { key: 'accounts', icon: ListTree, label: t('ledAccounts') },
    { key: 'trial', icon: Scale, label: t('ledTrialBalance') },
    { key: 'close', icon: Lock, label: t('ledClose') },
    { key: 'settings', icon: Settings2, label: t('ledAutopost') },
  ]

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t('ledIntro')}</p>
      <div className="flex flex-wrap items-center gap-2">
        {SECTIONS.map((s) => (
          <Button key={s.key} type="button" onClick={() => setSection(s.key)}
            variant={section === s.key ? 'default' : 'ghost'} aria-pressed={section === s.key}
            className={section === s.key ? 'bg-selected text-selected-foreground hover:bg-selected/90' : 'text-muted-foreground'}>
            <s.icon className="h-4 w-4" />{s.label}
          </Button>
        ))}
      </div>

      {/* fyLoading is passed down because `effFy` is '' until the years land — which
          disables the child queries, so their own isLoading stays false in that window. */}
      {section === 'journal' && <Journal fyId={effFy} fyClosed={activeFy?.status === 'closed'} fyLoading={fyLoading} />}
      {section === 'accounts' && <Accounts />}
      {section === 'trial' && <TrialBalance fyId={effFy} period={activeFy?.label || effFy} fyLoading={fyLoading} />}
      {section === 'close' && <CloseYear fy={activeFy} fyLoading={fyLoading} />}
      {section === 'settings' && <AutopostSettings />}
    </div>
  )
}

/* ── Journal ─────────────────────────────────────────────────────────── */
function Journal({ fyId, fyClosed, fyLoading }: { fyId: string; fyClosed?: boolean; fyLoading?: boolean }) {
  const { t } = useTranslation('finance')
  const confirm = useConfirm()
  const qc = useQueryClient()
  const { data: entries, isLoading } = useLedgerEntries(fyId || null, !!fyId)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['finance'] })

  async function reverse(id: number) { setBusy(id); try { await reverseLedgerEntry(id); refresh() } catch (e) { toast.error(apiErr(e, t('ledActionError'))) } finally { setBusy(null) } }
  async function remove(id: number) { if (!(await confirm({ message: t('ledDeleteSure'), danger: true }))) return; setBusy(id); try { await deleteLedgerEntry(id); refresh() } catch (e) { toast.error(apiErr(e, t('ledActionError'))) } finally { setBusy(null) } }

  const rows = entries ?? []
  // `rows` used to mean both "no bookings" and "not read yet" — over the club's book of
  // record that reads as a definitive empty journal. fyLoading covers the window where
  // fyId is still '' (query disabled ⇒ isLoading false).
  const loading = fyLoading || isLoading
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {/* Stays disabled until the year's status is known — posting into a closed year
            is rejected 409, and the button must not flip enabled → disabled under a tap. */}
        <Button type="button" disabled={fyClosed || fyLoading} onClick={() => setOpen(true)}><Plus className="h-4 w-4" />{t('ledPostEntry')}</Button>
      </div>
      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">{t('ledNoEntries')}</p>
      ) : (
        <div className="rounded-2xl border border-hairline bg-card shadow-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('ledColDate')}</TableHead>
                <TableHead>{t('ledColBeleg')}</TableHead>
                <TableHead>{t('ledColText')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('ledColDebit')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('ledColCredit')}</TableHead>
                <TableHead className="text-right">{t('colAmount')}</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{e.booking_date ? formatDateCompactZurich(e.booking_date) : '–'}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{e.beleg || '–'}{e.typ && e.typ !== 'Standard' ? <span className="ml-1 rounded bg-muted px-1 text-[10px]">{e.typ}</span> : null}{e.source === 'clubdesk' ? <span className="ml-1 rounded bg-blue-50 px-1 text-[10px] text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">ClubDesk</span> : null}</TableCell>
                  <TableCell className="whitespace-normal break-words text-foreground">{e.text || '–'}
                    <span className="block text-[11px] text-muted-foreground/80 sm:hidden">{e.debit_account_number} → {e.credit_account_number}</span></TableCell>
                  <TableCell className="hidden sm:table-cell whitespace-nowrap text-xs text-muted-foreground">{e.debit_account_number} {e.debit_account_name}</TableCell>
                  <TableCell className="hidden sm:table-cell whitespace-nowrap text-xs text-muted-foreground">{e.credit_account_number} {e.credit_account_name}</TableCell>
                  <TableCell className="text-right tabular-nums text-foreground">{formatChf(toNum(e.amount_chf))}</TableCell>
                  <TableCell className="text-right">
                    {!fyClosed && e.source === 'native' && (
                      <div className="flex justify-end gap-1">
                        <IconButton size="sm" variant="outline" label={t('ledReverse')} disabled={busy === e.id} onClick={() => reverse(e.id)} className="text-muted-foreground">{busy === e.id ? <Loader2 className="animate-spin" /> : <Undo2 />}</IconButton>
                        {!e.beleg?.startsWith('AP-') && <IconButton size="sm" variant="outline" label={t('delete')} disabled={busy === e.id} onClick={() => remove(e.id)} className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400"><Trash2 /></IconButton>}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <PostEntryModal open={open} onClose={() => setOpen(false)} fyId={fyId} onDone={refresh} />
    </div>
  )
}

function PostEntryModal({ open, onClose, fyId, onDone }: { open: boolean; onClose: () => void; fyId: string; onDone: () => void }) {
  const { t } = useTranslation('finance')
  const { data: accounts } = useLedgerAccounts(open)
  const [debit, setDebit] = useState(''); const [credit, setCredit] = useState('')
  const [amount, setAmount] = useState(''); const [text, setText] = useState(''); const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const amt = Number(amount.replace(',', '.'))
  const valid = debit && credit && debit !== credit && amt > 0

  async function submit() {
    if (!valid) return
    setBusy(true); setError('')
    try {
      await postLedgerEntry({ debit_account: Number(debit), credit_account: Number(credit), amount: amt, text: text.trim() || undefined, booking_date: date || undefined, fiscal_year: fyId ? Number(fyId) : undefined })
      setAmount(''); setText(''); onDone(); onClose()
    } catch (e) { setError(apiErr(e, t('ledActionError'))) } finally { setBusy(false) }
  }
  const opts = (accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)
  return (
    <Modal open={open} onClose={onClose} title={t('ledPostEntry')}>
      <div className="space-y-3">
        <div><label htmlFor="le-debit" className={labelCls}>{t('ledColDebit')}</label>
          <select id="le-debit" value={debit} onChange={(e) => setDebit(e.target.value)} className={selectCls}><option value="">{t('ledSelectAccount')}</option>{opts}</select></div>
        <div><label htmlFor="le-credit" className={labelCls}>{t('ledColCredit')}</label>
          <select id="le-credit" value={credit} onChange={(e) => setCredit(e.target.value)} className={selectCls}><option value="">{t('ledSelectAccount')}</option>{opts}</select></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label htmlFor="le-amt" className={labelCls}>{t('invoiceAmount')}</label><input id="le-amt" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className={inputCls} /></div>
          <div><DatePicker id="le-date" label={t('payDate')} value={date} onChange={setDate} /></div>
        </div>
        <div><label htmlFor="le-text" className={labelCls}>{t('ledColText')}</label><input id="le-text" value={text} onChange={(e) => setText(e.target.value)} className={inputCls} /></div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" disabled={!valid || busy} onClick={submit}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{t('ledPostEntry')}</Button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Kontenplan ──────────────────────────────────────────────────────── */
function Accounts() {
  const { t } = useTranslation('finance')
  const qc = useQueryClient()
  const { data: accounts, isLoading } = useLedgerAccounts(true, true)
  const [open, setOpen] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['finance', 'ledger-accounts'] })
  const typeLabel = (ty: string | null) => (ty ? t(`acctType_${ty}`) : '–')
  const rows = accounts ?? []

  async function toggle(a: LedgerAccount) { try { await editLedgerAccount(a.id, { active: !a.active }); refresh() } catch (e) { toast.error(apiErr(e, t('ledActionError'))) } }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{t('ledAccountsHint')}</p>
        <Button type="button" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />{t('ledNewAccount')}</Button>
      </div>
      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">{t('ledNoAccounts')}</p>
      ) : (
        <div className="rounded-2xl border border-hairline bg-card shadow-card overflow-hidden">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t('ledColNumber')}</TableHead>
              <TableHead>{t('ledColName')}</TableHead>
              <TableHead>{t('ledColType')}</TableHead>
              <TableHead className="hidden sm:table-cell">{t('ledColSource')}</TableHead>
              <TableHead className="text-right"></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id} className={`${a.active ? '' : 'opacity-50'}`}>
                  <TableCell className="whitespace-nowrap tabular-nums text-foreground">{a.number}</TableCell>
                  <TableCell className="whitespace-normal break-words text-foreground">{a.name}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{typeLabel(a.type)}</TableCell>
                  <TableCell className="hidden sm:table-cell whitespace-nowrap text-xs text-muted-foreground">{a.source === 'native' ? t('ledSourceNative') : t('ledSourceClubdesk')}</TableCell>
                  <TableCell className="text-right">
                    {a.source === 'native'
                      ? <Button variant="outline" size="sm" type="button" onClick={() => toggle(a)}>{a.active ? t('ledDeactivate') : t('ledActivate')}</Button>
                      : <span className="text-xs text-muted-foreground/80">{t('ledFromClubdesk')}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <NewAccountModal open={open} onClose={() => setOpen(false)} onDone={refresh} />
    </div>
  )
}

function NewAccountModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation('finance')
  const [number, setNumber] = useState(''); const [name, setName] = useState(''); const [type, setType] = useState('asset')
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  async function submit() {
    if (!number.trim() || !name.trim()) return
    setBusy(true); setError('')
    try { await createLedgerAccount({ number: number.trim(), name: name.trim(), type }); setNumber(''); setName(''); onDone(); onClose() }
    catch (e) { setError(apiErr(e, t('ledActionError'))) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title={t('ledNewAccount')}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label htmlFor="na-num" className={labelCls}>{t('ledColNumber')}</label><input id="na-num" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="1020" className={inputCls} /></div>
          <div><label htmlFor="na-type" className={labelCls}>{t('ledColType')}</label>
            <select id="na-type" value={type} onChange={(e) => setType(e.target.value)} className={selectCls}>{ACCOUNT_TYPES.map((ty) => <option key={ty} value={ty}>{t(`acctType_${ty}`)}</option>)}</select></div>
        </div>
        <div><label htmlFor="na-name" className={labelCls}>{t('ledColName')}</label><input id="na-name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" disabled={!number.trim() || !name.trim() || busy} onClick={submit}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{t('save')}</Button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Trial balance ───────────────────────────────────────────────────── */
function TrialBalance({ fyId, period, fyLoading }: { fyId: string; period: string; fyLoading?: boolean }) {
  const { t } = useTranslation('finance')
  const { data, isLoading } = useLedgerTrialBalance(fyId || null, !!fyId)
  const rows = data?.rows ?? []
  // Same gate as the journal: a statutory report that has not been fetched must not
  // render as a report with nothing in it.
  const loading = fyLoading || isLoading
  const report = (): FinanceReport => ({
    title: t('ledTrialBalance'), org: 'KSC Wiedikon', period,
    columns: [{ label: t('ledColNumber'), type: 'text' }, { label: t('ledColName'), type: 'text' }, { label: t('ledColDebit'), type: 'money' }, { label: t('ledColCredit'), type: 'money' }, { label: t('ledColBalance'), type: 'money' }],
    sections: [{ rows: [...rows.map((r) => ({ cells: [r.number, r.name, r.debit, r.credit, r.balance] })), { cells: [t('total'), '', data?.totals.debit ?? 0, data?.totals.credit ?? 0, ''], bold: true }] }],
  })
  return (
    <div className="space-y-3">
      {data && (
        <div className="flex flex-wrap items-center gap-2">
          <div className={`rounded-lg border px-3 py-2 text-sm ${data.totals.balanced ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300'}`}>
            {t('ledColDebit')} {formatChf(data.totals.debit)} · {t('ledColCredit')} {formatChf(data.totals.credit)} · {data.totals.balanced ? t('ledBalanced') : t('ledUnbalanced')}
          </div>
          {rows.length > 0 && <div className="ml-auto shrink-0"><ReportExportMenu build={report} filename={`trial-balance-${period}`} /></div>}
        </div>
      )}
      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">{t('ledNoEntries')}</p>
      ) : (
        <div className="rounded-2xl border border-hairline bg-card shadow-card overflow-hidden">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t('ledColNumber')}</TableHead>
              <TableHead>{t('ledColName')}</TableHead>
              <TableHead className="text-right">{t('ledColDebit')}</TableHead>
              <TableHead className="text-right">{t('ledColCredit')}</TableHead>
              <TableHead className="text-right">{t('ledColBalance')}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.account}>
                  <TableCell className="whitespace-nowrap tabular-nums text-foreground">{r.number}</TableCell>
                  <TableCell className="whitespace-normal break-words text-foreground/85">{r.name}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{r.debit ? formatChf(r.debit) : '–'}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{r.credit ? formatChf(r.credit) : '–'}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium text-foreground">{formatChf(r.balance)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

/* ── Year-end close ──────────────────────────────────────────────────── */
function CloseYear({ fy, fyLoading }: { fy?: { id: number; label: string | null; status: string }; fyLoading?: boolean }) {
  const { t } = useTranslation('finance')
  const qc = useQueryClient()
  const { data: accounts } = useLedgerAccounts()
  const equityAccts = (accounts ?? []).filter((a) => a.type === 'equity')
  const [equity, setEquity] = useState(''); const [opening, setOpening] = useState('')
  const [preview, setPreview] = useState<{ income: number; expense: number; net: number; closing_entries: number; opening_entries: number } | null>(null)
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [done, setDone] = useState('')
  const closed = fy?.status === 'closed'
  const valid = !!fy && !closed && equity && opening && equity !== opening

  async function run(dry: boolean) {
    if (!valid || !fy) return
    setBusy(true); setError(''); setDone('')
    try {
      const r = await closeLedgerYear(fy.id, { equity_account: Number(equity), opening_account: Number(opening), dry_run: dry })
      if (dry) setPreview(r)
      else { setDone(t('ledCloseDone', { net: formatChf(r.net) })); setPreview(null); qc.invalidateQueries({ queryKey: ['finance'] }) }
    } catch (e) { setError(apiErr(e, t('ledActionError'))) } finally { setBusy(false) }
  }

  if (!fy) return fyLoading ? <Spinner /> : <p className="text-sm text-muted-foreground">{t('ledNoYear')}</p>
  return (
    <div className="max-w-xl space-y-4">
      <div className="rounded-xl border border-hairline bg-surface-sunken p-3 text-sm">
        <div className="font-medium text-foreground">{fy.label || `#${fy.id}`}</div>
        <div className="text-xs text-muted-foreground">{closed ? t('ledAlreadyClosed') : t('ledCloseHint')}</div>
      </div>
      {!closed && (
        <>
          <div><label htmlFor="cl-eq" className={labelCls}>{t('ledEquityAccount')}</label>
            <select id="cl-eq" value={equity} onChange={(e) => setEquity(e.target.value)} className={selectCls}><option value="">{t('ledSelectAccount')}</option>{equityAccts.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)}</select>
            <p className="mt-1 text-xs text-muted-foreground/80">{t('ledEquityHint')}</p></div>
          <div><label htmlFor="cl-op" className={labelCls}>{t('ledOpeningAccount')}</label>
            <select id="cl-op" value={opening} onChange={(e) => setOpening(e.target.value)} className={selectCls}><option value="">{t('ledSelectAccount')}</option>{equityAccts.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)}</select>
            <p className="mt-1 text-xs text-muted-foreground/80">{t('ledOpeningHint')}</p></div>
          {preview && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/40 dark:bg-amber-900/20">
              <div className="font-medium text-amber-900 dark:text-amber-200">{t('ledPreview')}</div>
              <div className="mt-1 text-amber-800 dark:text-amber-300">{t('ledColIncome')}: {formatChf(preview.income)} · {t('ledColExpense')}: {formatChf(preview.expense)} · {t('ledNet')}: <strong>{formatChf(preview.net)}</strong></div>
              <div className="text-xs text-amber-700 dark:text-amber-400">{t('ledEntriesPlanned', { close: preview.closing_entries, open: preview.opening_entries })}</div>
            </div>
          )}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-2">
            <Button variant="outline" type="button" disabled={!valid || busy} onClick={() => run(true)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />}{t('ledPreviewCta')}</Button>
            <Button type="button" disabled={!valid || busy || !preview} onClick={() => run(false)}><Lock className="h-4 w-4" />{t('ledCloseCta')}</Button>
          </div>
        </>
      )}
      {done && <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300">{done}</p>}
    </div>
  )
}

/* ── Auto-posting settings ───────────────────────────────────────────── */
const MAP_FIELDS: { key: keyof LedgerSettings; label: string; types: string[] }[] = [
  { key: 'debitoren_account', label: 'ledMapDebitoren', types: ['asset'] },
  { key: 'bank_account', label: 'ledMapBank', types: ['asset'] },
  { key: 'income_account', label: 'ledMapIncome', types: ['income'] },
  { key: 'sponsoring_account', label: 'ledMapSponsoring', types: ['income'] },
  { key: 'bad_debt_account', label: 'ledMapBadDebt', types: ['expense'] },
  { key: 'expense_account', label: 'ledMapExpense', types: ['expense'] },
  { key: 'prepayment_account', label: 'ledMapPrepayment', types: ['liability', 'equity'] },
]

function AutopostSettings() {
  const qc = useQueryClient()
  const { data: settings } = useLedgerSettings()
  const { data: accounts } = useLedgerAccounts()
  if (!settings) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/80" />
  return (
    <div className="space-y-6">
      <AutopostForm key={settings.id + ':' + settings.autopost_enabled} settings={settings} accounts={accounts ?? []} onSaved={() => qc.invalidateQueries({ queryKey: ['finance'] })} />
      <IncomeByCategory accounts={accounts ?? []} />
    </div>
  )
}

function IncomeByCategory({ accounts }: { accounts: LedgerAccount[] }) {
  const { data } = useLedgerIncomeMap()
  const qc = useQueryClient()
  if (!data || data.categories.length === 0) return null
  return <IncomeByCategoryForm key={data.map.map((m) => `${m.fee_category}:${m.account}`).join('|')} categories={data.categories} map={data.map} accounts={accounts} onSaved={() => qc.invalidateQueries({ queryKey: ['finance', 'ledger-income-map'] })} />
}

function IncomeByCategoryForm({ categories, map, accounts, onSaved }: { categories: string[]; map: { fee_category: string; account: number | null }[]; accounts: LedgerAccount[]; onSaved: () => void }) {
  const { t } = useTranslation('finance')
  const incomeAccts = accounts.filter((a) => a.type === 'income')
  const [sel, setSel] = useState<Record<string, string>>(() => Object.fromEntries(map.map((m) => [m.fee_category, m.account ? String(m.account) : ''])))
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [msg, setMsg] = useState('')
  async function save() {
    setBusy(true); setError(''); setMsg('')
    try {
      const entries = categories.map((c) => ({ fee_category: c, account: sel[c] ? Number(sel[c]) : null }))
      await saveLedgerIncomeMap(entries); setMsg(t('ledSettingsSaved')); onSaved()
    } catch (e) { setError(apiErr(e, t('ledActionError'))) } finally { setBusy(false) }
  }
  async function auto() {
    setBusy(true); setError(''); setMsg('')
    try { const r = await autoMapIncome(); setMsg(t('ledAutoMapped', { matched: r.matched, total: r.total })); onSaved() } catch (e) { setError(apiErr(e, t('ledActionError'))) } finally { setBusy(false) }
  }
  return (
    <div className="max-w-xl space-y-3 border-t border-border pt-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">{t('ledIncomeByCategory')}</p>
          <p className="text-xs text-muted-foreground">{t('ledIncomeByCategoryHint')}</p>
        </div>
        <Button variant="outline" type="button" disabled={busy} onClick={auto} className="shrink-0">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{t('ledAutoMap')}</Button>
      </div>
      <div className="space-y-2">
        {categories.map((c) => (
          <div key={c} className="grid grid-cols-2 items-center gap-2">
            <span className="text-sm text-foreground/85">{c}</span>
            <select value={sel[c] || ''} onChange={(e) => setSel((s) => ({ ...s, [c]: e.target.value }))} className={selectCls}>
              <option value="">{t('ledDefaultIncome')}</option>
              {incomeAccts.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)}
            </select>
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {msg && <p className="text-sm text-green-700 dark:text-green-400">{msg}</p>}
      <Button type="button" disabled={busy} onClick={save}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings2 className="h-4 w-4" />}{t('save')}</Button>
    </div>
  )
}

function AutopostForm({ settings, accounts, onSaved }: { settings: LedgerSettings; accounts: LedgerAccount[]; onSaved: () => void }) {
  const { t } = useTranslation('finance')
  const [enabled, setEnabled] = useState(settings.autopost_enabled)
  const [map, setMap] = useState<Record<string, string>>(() => Object.fromEntries(MAP_FIELDS.map((f) => [f.key, settings[f.key] ? String(settings[f.key]) : ''])))
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [msg, setMsg] = useState('')
  const optsFor = (types: string[]) => accounts.filter((a) => a.type && types.includes(a.type)).map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)
  const ready = !!map.debitoren_account && !!map.bank_account && !!map.income_account // required for auto-posting

  async function save() {
    setBusy('save'); setError(''); setMsg('')
    try {
      const body: Record<string, unknown> = { autopost_enabled: enabled }
      for (const f of MAP_FIELDS) body[f.key] = map[f.key] ? Number(map[f.key]) : null
      await saveLedgerSettings(body); setMsg(t('ledSettingsSaved')); onSaved()
    } catch (e) { setError(apiErr(e, t('ledActionError'))) } finally { setBusy('') }
  }
  async function reconcile() { setBusy('recon'); setError(''); setMsg(''); try { const r = await reconcileLedger(); setMsg(t('ledReconciled', { posted: r.posted })); onSaved() } catch (e) { setError(apiErr(e, t('ledActionError'))) } finally { setBusy('') } }

  return (
    <div className="max-w-xl space-y-4">
      <p className="text-xs text-muted-foreground">{t('ledAutopostHint')}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" type="button" disabled={!!busy} onClick={reconcile}>{busy === 'recon' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{t('ledReconcile')}</Button>
      </div>
      <div className="space-y-3">
        {MAP_FIELDS.map((f) => (
          <div key={f.key}><label htmlFor={`map-${f.key}`} className={labelCls}>{t(f.label)}</label>
            <select id={`map-${f.key}`} value={map[f.key]} onChange={(e) => setMap((m) => ({ ...m, [f.key]: e.target.value }))} className={selectCls}>
              <option value="">{t('ledNone')}</option>{optsFor(f.types)}
            </select></div>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" className="h-4 w-4 rounded border-input accent-[var(--primary)]" checked={enabled && ready} disabled={!ready} onChange={(e) => setEnabled(e.target.checked)} />{t('ledAutopostEnable')}
      </label>
      {!ready && <p className="text-xs text-amber-600 dark:text-amber-400">{t('ledAutopostNeedsAccounts')}</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {msg && <p className="text-sm text-green-700 dark:text-green-400">{msg}</p>}
      <Button type="button" disabled={busy === 'save'} onClick={save}>{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings2 className="h-4 w-4" />}{t('save')}</Button>
    </div>
  )
}
