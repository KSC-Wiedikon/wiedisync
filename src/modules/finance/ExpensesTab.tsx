import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock, Loader2, Pencil, Save, Wallet, X } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import DatePicker from '@/components/ui/DatePicker'
import { FormInput, FormTextarea } from '../../components/FormField'
import { useConfirm } from '../../components/ConfirmProvider'
import { Button } from '../../components/ui/button'
import { useAllExpenses, patchExpense, formatExpenseAmount, type FinanceExpense } from '../../hooks/useFinance'
import ReceiptButton from './ReceiptButton'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import { ExpenseStatusBadge } from './expenseShared'

/** The section TK's confirmation state, as the treasurer sees it (read-only).
 *  Informational — it never gates the paid/rejected lifecycle. */
function TkConfirmCell({ e }: { e: FinanceExpense }) {
  const { t } = useTranslation('finance')
  const sectionLabel = e.section
    ? t(e.section === 'vb' ? 'divVb' : e.section === 'bb' ? 'divBb' : 'divClub')
    : null
  return (
    <div className="flex flex-col items-start gap-1 text-xs">
      {e.tk_confirmed_at ? (
        <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {t('expenseTkConfirmed')}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          {sectionLabel ? t('expenseTkAwaitingSection', { section: sectionLabel }) : t('expenseTkAwaiting')}
        </span>
      )}
      {e.tk_confirmed_at && e.tk_confirmed_by_name && (
        <span className="text-[11px] text-gray-400 dark:text-gray-500">
          {e.tk_confirmed_by_name} · {formatDateCompactZurich(e.tk_confirmed_at)}
        </span>
      )}
      {e.tk_already_paid && (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
          <Wallet className="h-3 w-3 shrink-0" />
          {t('expenseTkAlreadyPaid')}
        </span>
      )}
      {e.member_already_paid && (
        <span className="text-[11px] italic text-gray-400 dark:text-gray-500">{t('expenseMemberAlreadyPaid')}</span>
      )}
      {e.tk_note && (
        <span className="whitespace-normal break-words text-[11px] italic text-gray-500 dark:text-gray-400">«{e.tk_note}»</span>
      )}
      {e.internal_note && (
        <span className="mt-0.5 block whitespace-normal break-words rounded-md bg-amber-50 px-1.5 py-1 text-[11px] text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          <span className="font-medium">{t('expenseInternalNote')}: </span>{e.internal_note}
        </span>
      )}
    </div>
  )
}

/**
 * Finance queue for the expense reimbursements members submit on /finance/expense
 * (finance_expenses, migration 175). Status changes + edits go through
 * PATCH /kscw/expenses/:id — the endpoint notifies the member on paid/rejected
 * and auto-creates the linked finance_payouts row on paid.
 */
// LEGAL name — used only for the confirm-paid / confirm-rejected message.
const memberName = (e: FinanceExpense) => {
  const m = e.member
  if (m && typeof m === 'object') return [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || `#${m.id}`
  return m != null ? `#${m}` : '—'
}
// UI display name — prefers the member's chosen nickname (falls back to first_name).
const memberDisplayName = (e: FinanceExpense) => {
  const m = e.member
  if (m && typeof m === 'object') return [(m.nickname || m.first_name), m.last_name].filter(Boolean).join(' ').trim() || `#${m.id}`
  return m != null ? `#${m}` : '—'
}

interface EditState {
  amount: string
  currency: string
  expense_date: string
  vendor: string
  description: string
  reference: string
  pay_to_iban: string
  finance_note: string
  internal_note: string
}

export default function ExpensesTab() {
  const { t } = useTranslation('finance')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { data, isLoading } = useAllExpenses()
  const rows = data ?? []
  const [editingId, setEditingId] = useState<string | number | null>(null)
  const [edit, setEdit] = useState<EditState | null>(null)
  const [busyId, setBusyId] = useState<string | number | null>(null)

  const refresh = () => qc.invalidateQueries({ queryKey: ['finance', 'expenses'] })

  async function apply(e: FinanceExpense, body: Partial<FinanceExpense>, successMsg: string): Promise<boolean> {
    setBusyId(e.id)
    try {
      const res = await patchExpense(e.id, body)
      await refresh()
      toast.success(successMsg)
      if (res.payoutCreated) toast.success(t('expensePayoutCreated'))
      else if (res.payoutCancelled) toast.info(t('expensePayoutCancelled'))
      else if (res.payoutSkipped) {
        // Backend returns a machine code; localize it here (never English prose).
        const reason = t(`expensePayoutSkip_${res.payoutSkipped}`, { defaultValue: res.payoutSkipped })
        toast.warning(t('expensePayoutSkipped', { reason }))
      }
      return true
    } catch (err) {
      // Surface the server's precise reason ('Invalid IBAN'), not kscwApi's
      // technical "API /expenses/7: 400"; fall back to the localized generic.
      const serverMsg = (err as { body?: { error?: string } })?.body?.error
      toast.error(serverMsg || t('expenseUpdateError'))
      return false
    } finally {
      setBusyId(null)
    }
  }

  async function changeStatus(e: FinanceExpense, status: string) {
    if (status === (e.status || 'pending')) return
    // Paid/rejected notifies the member — make the flip deliberate.
    if (status === 'paid' || status === 'rejected') {
      const ok = await confirm({
        message: t(status === 'paid' ? 'expenseConfirmPaid' : 'expenseConfirmRejected', { amount: formatExpenseAmount(e), member: memberName(e) }),
        danger: status === 'rejected',
      })
      if (!ok) return
    }
    await apply(e, { status }, t('expenseStatusUpdated'))
  }

  function startEdit(e: FinanceExpense) {
    setEditingId(e.id)
    setEdit({
      amount: e.amount != null ? String(e.amount) : '',
      currency: e.currency || 'CHF',
      expense_date: e.expense_date ? String(e.expense_date).slice(0, 10) : '',
      vendor: e.vendor || '',
      description: e.description || '',
      reference: e.reference || '',
      pay_to_iban: e.pay_to_iban || '',
      finance_note: e.finance_note || '',
      internal_note: e.internal_note || '',
    })
  }

  async function saveEdit(e: FinanceExpense) {
    if (!edit) return
    const amountNum = Number(edit.amount.replace(/'/g, '').replace(',', '.'))
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      toast.error(t('expenseAmountRequired'))
      return
    }
    const ok = await apply(e, {
      amount: amountNum,
      currency: edit.currency.trim().toUpperCase() || 'CHF',
      expense_date: edit.expense_date || null,
      vendor: edit.vendor,
      description: edit.description,
      reference: edit.reference,
      pay_to_iban: edit.pay_to_iban.replace(/\s+/g, ''),
      finance_note: edit.finance_note,
      internal_note: edit.internal_note,
    }, t('expenseSaved'))
    // Keep the editor open with the typed values on failure so the user can fix
    // the flagged field instead of retyping everything.
    if (ok) {
      setEditingId(null)
      setEdit(null)
    }
  }

  if (isLoading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-1 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('tabExpenses')}</h3>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">{t('expensesTabHint')}</p>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">{t('expensesEmpty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colDate')}</TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('expenseMember')}</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('expenseAmount')}</TableHead>
                <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('expenseVendor')}</TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('expenseStatusCol')}</TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('expenseTkCol')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <Fragment key={e.id}>
                  <TableRow className="min-h-[44px]">
                    <TableCell className="text-sm text-gray-500 dark:text-gray-400">
                      {e.date_created ? formatDateCompactZurich(e.date_created) : '—'}
                    </TableCell>
                    <TableCell className="whitespace-normal break-words text-sm font-medium text-gray-900 dark:text-gray-100">
                      {memberDisplayName(e)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium tabular-nums text-gray-900 dark:text-gray-100">
                      {formatExpenseAmount(e)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell whitespace-normal break-words text-sm text-gray-700 dark:text-gray-300">
                      {e.vendor || '—'}
                      {e.description && <span className="block text-xs text-gray-400 dark:text-gray-500">{e.description}</span>}
                      {e.member_note && <span className="mt-0.5 block text-xs italic text-gray-400 dark:text-gray-500">«{e.member_note}»</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <ExpenseStatusBadge status={e.status} />
                        <select
                          value={e.status || 'pending'}
                          disabled={busyId === e.id}
                          onChange={(ev) => void changeStatus(e, ev.target.value)}
                          className="rounded-md border border-gray-300 bg-transparent px-1.5 py-1 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
                          aria-label={t('expenseStatusCol')}
                        >
                          <option value="pending">{t('expenseStatus_pending')}</option>
                          <option value="paid">{t('expenseStatus_paid')}</option>
                          <option value="rejected">{t('expenseStatus_rejected')}</option>
                        </select>
                      </div>
                      {e.status_changed_by_name && (
                        <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">{e.status_changed_by_name}</p>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <TkConfirmCell e={e} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:justify-end">
                        {e.file && (
                          <ReceiptButton
                            expenseId={e.id}
                            className="inline-flex min-h-[44px] items-center gap-1 rounded-md px-2 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => (editingId === e.id ? (setEditingId(null), setEdit(null)) : startEdit(e))}
                          className="inline-flex min-h-[44px] items-center gap-1 rounded-md px-2 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                          title={t('expenseEdit')}
                        >
                          {editingId === e.id ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {editingId === e.id && edit && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-gray-50 dark:bg-gray-900/40">
                        <div className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-2">
                          <FormInput label={t('expenseAmount')} type="text" inputMode="decimal" value={edit.amount}
                            onChange={(ev) => setEdit({ ...edit, amount: ev.target.value })} />
                          <FormInput label={t('expenseCurrency')} value={edit.currency}
                            onChange={(ev) => setEdit({ ...edit, currency: ev.target.value })} />
                          <DatePicker label={t('expenseDate')} value={edit.expense_date}
                            onChange={(v) => setEdit({ ...edit, expense_date: v })} />
                          <FormInput label={t('expenseVendor')} value={edit.vendor}
                            onChange={(ev) => setEdit({ ...edit, vendor: ev.target.value })} />
                          <FormInput label={t('expenseDescription')} value={edit.description}
                            onChange={(ev) => setEdit({ ...edit, description: ev.target.value })} />
                          <FormInput label={t('expenseReference')} value={edit.reference}
                            onChange={(ev) => setEdit({ ...edit, reference: ev.target.value })} />
                          <FormInput label={t('expensePayToIban')} value={edit.pay_to_iban}
                            onChange={(ev) => setEdit({ ...edit, pay_to_iban: ev.target.value })} />
                          <div className="sm:col-span-2">
                            <FormTextarea label={t('expenseFinanceNote')} value={edit.finance_note} rows={2}
                              onChange={(ev) => setEdit({ ...edit, finance_note: ev.target.value })} />
                            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{t('expenseFinanceNoteHint')}</p>
                          </div>
                          <div className="sm:col-span-2">
                            <FormTextarea label={t('expenseInternalNote')} value={edit.internal_note} rows={2}
                              placeholder={t('expenseInternalNotePlaceholder')}
                              onChange={(ev) => setEdit({ ...edit, internal_note: ev.target.value })} />
                            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{t('expenseInternalNoteHint')}</p>
                          </div>
                        </div>
                        <div className="flex justify-end gap-2 pb-2">
                          <Button variant="outline" size="sm" onClick={() => { setEditingId(null); setEdit(null) }}>
                            {t('expenseCancel')}
                          </Button>
                          <Button size="sm" disabled={busyId === e.id} onClick={() => void saveEdit(e)}>
                            {busyId === e.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                            {t('expenseSave')}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
