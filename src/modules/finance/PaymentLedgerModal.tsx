import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Loader2 } from 'lucide-react'
import Modal from '../../components/Modal'
import { Button } from '@/components/ui/button'
import IconButton from '@/components/IconButton'
import { useConfirm } from '../../components/ConfirmProvider'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import DatePicker from '@/components/ui/DatePicker'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import {
  useInvoicePayments, recordInvoicePayment, deleteInvoicePayment, formatChf, toNum,
  type PaymentEntryType,
} from '../../hooks/useFinance'
import type { FinanceInvoice } from './types'

const labelCls = 'block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'
const inputCls = 'mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground sm:h-9 outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary/60 dark:bg-input/20'
// Native <select>: dark:bg-gray-800 is mandatory so the <option> list is dark too.
const selectCls = 'mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground sm:h-9 outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary/60 dark:bg-gray-800'
const apiErr = (e: unknown, fb: string) => (e as { body?: { error?: string } })?.body?.error || fb

const ENTRY_TYPES: PaymentEntryType[] = ['payment', 'credit_note', 'refund', 'writeoff']
const METHODS = ['cash', 'twint', 'bank', 'other']
const hasMethod = (t: PaymentEntryType) => t === 'payment' || t === 'refund'

/** Per-invoice settlement ledger: record a payment / credit note / refund / write-off
 *  and see the running ledger. Recompute happens server-side. */
export default function PaymentLedgerModal({ invoice, onClose, onChanged }: {
  invoice: FinanceInvoice | null; onClose: () => void; onChanged: () => void
}) {
  const { t } = useTranslation('finance')
  const confirm = useConfirm()
  const { data: payments, refetch, isLoading, isError, isPlaceholderData } = useInvoicePayments(invoice?.id)
  const [entryType, setEntryType] = useState<PaymentEntryType>('payment')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyDel, setBusyDel] = useState<number | null>(null)
  const [error, setError] = useState('')

  const amt = Number(amount.replace(',', '.'))
  const valid = amt > 0

  async function add() {
    if (!invoice || !valid) return
    setBusy(true); setError('')
    try {
      await recordInvoicePayment(invoice.id, {
        amount: amt, entry_type: entryType,
        method: hasMethod(entryType) ? method : null,
        payment_date: date || null, note: note.trim() || null,
      })
      setAmount(''); setNote('')
      await refetch(); onChanged()
    } catch (e) { setError(apiErr(e, t('payAddError'))) } finally { setBusy(false) }
  }
  async function remove(pid: number) {
    if (!invoice || !(await confirm({ message: t('payDeleteSure'), danger: true }))) return
    setBusyDel(pid); setError('')
    try { await deleteInvoicePayment(invoice.id, pid); await refetch(); onChanged() }
    catch (e) { setError(apiErr(e, t('payDeleteError'))) } finally { setBusyDel(null) }
  }

  const typeLabel = (x: string) => ({ payment: t('payTypePayment'), credit_note: t('payTypeCredit'), refund: t('payTypeRefund'), writeoff: t('payTypeWriteoff') }[x] ?? x)
  // The ledger fetch starts when the modal opens, and the global keepPreviousData default
  // (src/lib/query.tsx) hands back the PREVIOUS invoice's rows on the next open — either way
  // the ledger below would claim something untrue about this invoice. isError releases the
  // gate so a failed fetch can never strand the block in a permanent skeleton.
  const ledgerPending = !isError && (isLoading || isPlaceholderData)
  const rows = ledgerPending ? [] : (payments ?? [])

  return (
    <Modal open={!!invoice} onClose={onClose} title={t('payLedgerTitle')}>
      {invoice && (
        <div className="space-y-4">
          <div className="rounded-xl border border-hairline bg-surface-sunken p-3 text-sm">
            <div className="font-medium text-foreground">{invoice.number} · {invoice.recipient_name || '–'}</div>
            <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{t('colAmount')}: {formatChf(invoice.amount)}</span>
              <span>{t('colOpen')}: <span className="font-semibold text-foreground/85">{formatChf(invoice.open_amount)}</span></span>
              <span>{t('colStatus')}: {invoice.status}</span>
            </div>
          </div>

          {/* Record an entry */}
          <div className="space-y-3 rounded-xl border border-hairline p-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pay-entry-type" className={labelCls}>{t('payEntryType')}</label>
                <select id="pay-entry-type" value={entryType} onChange={(e) => setEntryType(e.target.value as PaymentEntryType)} className={selectCls}>
                  {ENTRY_TYPES.map((x) => <option key={x} value={x}>{typeLabel(x)}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="pay-amount" className={labelCls}>{t('invoiceAmount')}</label>
                <input id="pay-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {hasMethod(entryType) && (
                <div>
                  <label htmlFor="pay-method" className={labelCls}>{t('payMethod')}</label>
                  <select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)} className={selectCls}>
                    {METHODS.map((m) => <option key={m} value={m}>{t(`payMethod_${m}`)}</option>)}
                  </select>
                </div>
              )}
              <div>
                <DatePicker id="pay-date" label={t('payDate')} value={date} onChange={setDate} />
              </div>
            </div>
            <div>
              <label htmlFor="pay-note" className={labelCls}>{t('payNote')}</label>
              <input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('payNotePlaceholder')} className={inputCls} />
            </div>
            <div className="flex justify-end">
              <Button type="button" disabled={!valid || busy} onClick={add}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{t('payAddCta')}
              </Button>
            </div>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          {/* Ledger */}
          {rows.length === 0 && !ledgerPending ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t('payNoEntries')}</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-hairline" aria-busy={ledgerPending}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colDate')}</TableHead>
                    <TableHead>{t('payColType')}</TableHead>
                    <TableHead className="text-right">{t('colAmount')}</TableHead>
                    <TableHead className="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledgerPending && [0, 1].map((i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell><div className="h-4 w-16 animate-pulse rounded bg-stone-200/80 dark:bg-muted" /></TableCell>
                      <TableCell><div className="h-4 w-24 animate-pulse rounded bg-stone-200/80 dark:bg-muted" /></TableCell>
                      <TableCell><div className="ml-auto h-4 w-16 animate-pulse rounded bg-stone-200/80 dark:bg-muted" /></TableCell>
                      <TableCell><div className="ml-auto h-7 w-7 animate-pulse rounded-md bg-stone-200/80 dark:bg-muted" /></TableCell>
                    </TableRow>
                  ))}
                  {rows.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap tabular-nums text-foreground">{p.payment_date ? formatDateCompactZurich(p.payment_date) : '–'}</TableCell>
                      <TableCell className="whitespace-normal break-words text-foreground/85">
                        {typeLabel(p.entry_type)}
                        {p.method && p.entry_type !== 'credit_note' && p.entry_type !== 'writeoff' ? ` · ${t(`payMethod_${p.method}`, p.method)}` : ''}
                        {p.note ? <span className="mt-0.5 block text-xs text-muted-foreground/80">{p.note}</span> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-foreground">{formatChf(toNum(p.amount))}</TableCell>
                      <TableCell className="text-right">
                        {p.source === 'native' && p.method !== 'camt' ? (
                          <IconButton size="sm" variant="outline" disabled={busyDel === p.id} onClick={() => remove(p.id)} label={t('payDelete')}
                            className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400">
                            {busyDel === p.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                          </IconButton>
                        ) : <span className="text-xs text-muted-foreground/80">{p.camt_reference ? t('payViaCamt') : ''}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
