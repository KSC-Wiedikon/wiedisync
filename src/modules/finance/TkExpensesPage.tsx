import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import {
  useTkExpenses, tkConfirmExpense, formatExpenseAmount, type FinanceExpense,
} from '../../hooks/useFinance'
import ReceiptButton from './ReceiptButton'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import { ExpenseStatusBadge } from './expenseShared'

/**
 * Sport-Admin (TK) expense confirmation queue. Each section's TK (vb_admin /
 * bb_admin — finance/board see every section) confirms that a member's
 * reimbursement is budgeted and OK to pay, and flags whether the section has
 * ALREADY reimbursed the member. Server-scoped via GET /kscw/expenses/tk-queue;
 * writes via POST /kscw/expenses/:id/tk-confirm. Purely informational — it never
 * changes the treasurer's paid/rejected lifecycle.
 */
// UI display name — prefers the member's chosen nickname (falls back to first_name).
const memberName = (e: FinanceExpense) => {
  const m = e.member
  if (m && typeof m === 'object') return [(m.nickname || m.first_name), m.last_name].filter(Boolean).join(' ').trim() || `#${m.id}`
  return m != null ? `#${m}` : '—'
}

/** One expense row with its own confirm/already-paid/note controls. */
function TkRow({ e, onDone }: { e: FinanceExpense; onDone: () => void }) {
  const { t } = useTranslation('finance')
  const [alreadyPaid, setAlreadyPaid] = useState(!!e.tk_already_paid)
  const [note, setNote] = useState(e.tk_note ?? '')
  const [internal, setInternal] = useState(e.internal_note ?? '')
  const [busy, setBusy] = useState(false)
  const confirmed = !!e.tk_confirmed_at

  async function send(nextConfirmed: boolean) {
    setBusy(true)
    try {
      await tkConfirmExpense(e.id, { confirmed: nextConfirmed, already_paid: alreadyPaid, note, internal_note: internal })
      toast.success(nextConfirmed ? t('expenseTkConfirmedToast') : t('expenseTkUnconfirmedToast'))
      onDone()
    } catch (err) {
      const serverMsg = (err as { body?: { error?: string } })?.body?.error
      toast.error(serverMsg || t('expenseUpdateError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <TableRow className="min-h-[44px] align-top">
      <TableCell className="text-sm text-gray-500 dark:text-gray-400">
        {e.date_created ? formatDateCompactZurich(e.date_created) : '—'}
      </TableCell>
      <TableCell className="whitespace-normal break-words text-sm font-medium text-gray-900 dark:text-gray-100">
        {memberName(e)}
      </TableCell>
      <TableCell className="text-right text-sm font-medium tabular-nums text-gray-900 dark:text-gray-100">
        {formatExpenseAmount(e)}
      </TableCell>
      <TableCell className="hidden sm:table-cell whitespace-normal break-words text-sm text-gray-700 dark:text-gray-300">
        {e.vendor || '—'}
        {e.description && <span className="block text-xs text-gray-400 dark:text-gray-500">{e.description}</span>}
        {e.member_already_paid && <span className="mt-0.5 block text-[11px] italic text-gray-400 dark:text-gray-500">{t('expenseMemberAlreadyPaid')}</span>}
      </TableCell>
      <TableCell>
        <ExpenseStatusBadge status={e.status} />
        {e.file && (
          <ReceiptButton
            expenseId={e.id}
            showLabel
            iconClassName="h-3.5 w-3.5"
            className="mt-1 inline-flex min-h-[32px] items-center gap-1 rounded-md px-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          />
        )}
      </TableCell>
      <TableCell className="min-w-[220px]">
        <div className="flex flex-col gap-2">
          {confirmed && (
            <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              {e.tk_confirmed_by_name
                ? t('expenseTkConfirmedBy', { name: e.tk_confirmed_by_name })
                : t('expenseTkConfirmed')}
            </span>
          )}
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
            <Checkbox checked={alreadyPaid} onCheckedChange={(v) => setAlreadyPaid(v === true)} disabled={busy} />
            {t('expenseTkAlreadyPaidLabel')}
          </label>
          <textarea
            value={note}
            onChange={(ev) => setNote(ev.target.value)}
            rows={2}
            disabled={busy}
            placeholder={t('expenseTkNotePlaceholder')}
            className="w-full rounded-md border border-gray-300 bg-transparent px-2 py-1 text-xs text-gray-700 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          />
          <div>
            <label className="mb-0.5 block text-[11px] font-medium text-gray-500 dark:text-gray-400">{t('expenseInternalNote')}</label>
            <textarea
              value={internal}
              onChange={(ev) => setInternal(ev.target.value)}
              rows={2}
              disabled={busy}
              placeholder={t('expenseInternalNotePlaceholder')}
              className="w-full rounded-md border border-amber-300 bg-amber-50/40 px-2 py-1 text-xs text-gray-700 placeholder:text-gray-400 dark:border-amber-700/60 dark:bg-amber-900/10 dark:text-gray-200"
            />
            <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">{t('expenseInternalNoteHint')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => void send(true)}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
              {confirmed ? t('expenseTkSave') : t('expenseTkConfirmBtn')}
            </Button>
            {confirmed && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void send(false)}>
                {t('expenseTkUnconfirm')}
              </Button>
            )}
          </div>
        </div>
      </TableCell>
    </TableRow>
  )
}

export default function TkExpensesPage() {
  const { t } = useTranslation('finance')
  const qc = useQueryClient()
  const { data, isLoading } = useTkExpenses()
  const rows = data ?? []
  const refresh = () => qc.invalidateQueries({ queryKey: ['finance', 'tk-expenses'] })

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('tkExpensesTitle')}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('tkExpensesSubtitle')}</p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">{t('tkExpensesEmpty')}</p>
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
                  <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('expenseTkActionCol')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => <TkRow key={e.id} e={e} onDone={refresh} />)}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
