import { useEffect, useRef, useState, type MouseEvent } from 'react'
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
 * writes via POST /kscw/expenses/:id/tk-confirm (checkbox + notes autosave
 * without confirming, serialised per row; the buttons confirm/un-confirm). Purely informational — it never
 * changes the treasurer's paid/rejected lifecycle.
 */
// UI display name — prefers the member's chosen nickname (falls back to first_name).
const memberName = (e: FinanceExpense) => {
  const m = e.member
  if (m && typeof m === 'object') return [(m.nickname || m.first_name), m.last_name].filter(Boolean).join(' ').trim() || `#${m.id}`
  return m != null ? `#${m}` : '—'
}

type TkFields = { already_paid?: boolean; note?: string; internal_note?: string }
type NoteKind = 'note' | 'internal'
/** A note saves this long after the last keystroke, so closing the tab or
 *  swiping back mid-sentence loses at most the last couple of seconds. */
const NOTE_DEBOUNCE_MS = 1500

/** One expense row with its own confirm/already-paid/note controls. */
function TkRow({ e, onSaved }: { e: FinanceExpense; onSaved: (patch: Partial<FinanceExpense>) => void }) {
  const { t } = useTranslation('finance')
  const [alreadyPaid, setAlreadyPaid] = useState(!!e.tk_already_paid)
  const [note, setNote] = useState(e.tk_note ?? '')
  const [internal, setInternal] = useState(e.internal_note ?? '')
  const [busy, setBusy] = useState(false)
  const confirmed = !!e.tk_confirmed_at
  // What the server holds (as it normalised it) — autosave only fires on a real change.
  const saved = useRef({ alreadyPaid: !!e.tk_already_paid, note: e.tk_note ?? '', internal: e.internal_note ?? '' })
  // The TK's latest input, readable from queued writes and the unmount flush.
  const latest = useRef({ alreadyPaid: !!e.tk_already_paid, note: e.tk_note ?? '', internal: e.internal_note ?? '' })
  // Every write of this row runs after the previous one settles, so the server
  // applies them in the order the TK made them (fast checkbox taps, blur + Confirm).
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const timers = useRef<Partial<Record<NoteKind, number>>>({})

  function enqueue(job: () => Promise<void>) {
    const run = chain.current.then(job, job)
    chain.current = run.catch(() => {})
    return run
  }

  /** Adopts the server's copy of the row: `saved` follows the server, and a note
   *  the TK hasn't touched since sending takes the server's normalised text. */
  function applyServer(x: FinanceExpense, sent: TkFields) {
    const s = { alreadyPaid: !!x.tk_already_paid, note: x.tk_note ?? '', internal: x.internal_note ?? '' }
    if (sent.note !== undefined && latest.current.note === sent.note) { latest.current.note = s.note; setNote(s.note) }
    if (sent.internal_note !== undefined && latest.current.internal === sent.internal_note) {
      latest.current.internal = s.internal; setInternal(s.internal)
    }
    saved.current = s
    onSaved({
      tk_already_paid: x.tk_already_paid, tk_note: x.tk_note, internal_note: x.internal_note,
      tk_confirmed_at: x.tk_confirmed_at, tk_confirmed_by_name: x.tk_confirmed_by_name,
    })
  }

  function showError(err: unknown) {
    const serverMsg = (err as { body?: { error?: string } })?.body?.error
    toast.error(serverMsg || t('expenseUpdateError'))
  }

  /** Saves fields without touching the confirmation. */
  async function write(fields: TkFields) {
    try {
      const r = await tkConfirmExpense(e.id, fields)
      applyServer(r.expense, fields)
      toast.success(t('expenseTkSavedToast'), { id: `tk-saved-${e.id}` })
    } catch (err) {
      // A failed checkbox write snaps back to what the server holds (unless the
      // TK already toggled again). A failed note keeps its text: it stays dirty
      // and the next blur or keystroke retries.
      if (fields.already_paid !== undefined && latest.current.alreadyPaid === fields.already_paid) {
        latest.current.alreadyPaid = saved.current.alreadyPaid
        setAlreadyPaid(saved.current.alreadyPaid)
      }
      showError(err)
    }
  }

  function toggleAlreadyPaid(next: boolean) {
    latest.current.alreadyPaid = next
    setAlreadyPaid(next)
    void enqueue(() => write({ already_paid: next }))
  }

  /** Queues a save of one note; it reads the text when it runs, so a burst of
   *  blurs/timers collapses into at most one request per real change. */
  function flushNote(kind: NoteKind) {
    window.clearTimeout(timers.current[kind])
    return enqueue(async () => {
      const v = latest.current[kind]
      if (v === saved.current[kind]) return
      await write(kind === 'note' ? { note: v } : { internal_note: v })
    })
  }

  function typeNote(kind: NoteKind, v: string) {
    latest.current[kind] = v
    if (kind === 'note') setNote(v)
    else setInternal(v)
    window.clearTimeout(timers.current[kind])
    timers.current[kind] = window.setTimeout(() => void flushNote(kind), NOTE_DEBOUNCE_MS)
  }

  // Leaving the page (in-app link, browser back, swipe back) unmounts the row
  // without a blur — save whatever is still pending on the way out.
  const flushRef = useRef(flushNote)
  useEffect(() => { flushRef.current = flushNote })
  useEffect(() => () => {
    void flushRef.current('note')
    void flushRef.current('internal')
  }, [])

  async function send(nextConfirmed: boolean) {
    window.clearTimeout(timers.current.note)
    window.clearTimeout(timers.current.internal)
    setBusy(true)
    await enqueue(async () => {
      const fields = {
        confirmed: nextConfirmed, already_paid: latest.current.alreadyPaid,
        note: latest.current.note, internal_note: latest.current.internal,
      }
      try {
        const r = await tkConfirmExpense(e.id, fields)
        applyServer(r.expense, fields)
        toast.success(nextConfirmed ? t('expenseTkConfirmedToast') : t('expenseTkUnconfirmedToast'))
      } catch (err) {
        showError(err)
      }
    })
    setBusy(false)
  }

  // Keeps a focused note from blurring (and autosaving) when a button is
  // pressed — send() already carries every field in one request.
  const keepFocus = (ev: MouseEvent) => ev.preventDefault()

  return (
    <TableRow className="min-h-[44px] align-top">
      <TableCell className="text-sm tabular-nums text-muted-foreground">
        {e.date_created ? formatDateCompactZurich(e.date_created) : '—'}
      </TableCell>
      <TableCell className="whitespace-normal break-words text-sm font-medium text-foreground">
        {memberName(e)}
      </TableCell>
      <TableCell className="text-right text-sm font-medium tabular-nums text-foreground">
        {formatExpenseAmount(e)}
      </TableCell>
      <TableCell className="hidden sm:table-cell whitespace-normal break-words text-sm text-foreground/85">
        {e.vendor || '—'}
        {e.description && <span className="block text-xs text-muted-foreground/80">{e.description}</span>}
        {e.member_already_paid && <span className="mt-0.5 block text-[11px] italic text-muted-foreground/80">{t('expenseMemberAlreadyPaid')}</span>}
      </TableCell>
      <TableCell>
        <ExpenseStatusBadge status={e.status} />
        {e.file && (
          <ReceiptButton expenseId={e.id} showLabel className="mt-1 flex" />
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
          <label className="flex items-center gap-2 text-xs text-foreground/85">
            <Checkbox checked={alreadyPaid} onCheckedChange={(v) => toggleAlreadyPaid(v === true)} disabled={busy} />
            {t('expenseTkAlreadyPaidLabel')}
          </label>
          <textarea
            value={note}
            onChange={(ev) => typeNote('note', ev.target.value)}
            onBlur={() => void flushNote('note')}
            rows={2}
            maxLength={1000}
            disabled={busy}
            placeholder={t('expenseTkNotePlaceholder')}
            className="w-full rounded-lg border border-input bg-card px-2 py-1 text-xs text-foreground/85 placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/20"
          />
          <div>
            <label className="mb-0.5 block text-[11px] font-medium text-muted-foreground">{t('expenseInternalNote')}</label>
            <textarea
              value={internal}
              onChange={(ev) => typeNote('internal', ev.target.value)}
              onBlur={() => void flushNote('internal')}
              rows={2}
              maxLength={1000}
              disabled={busy}
              placeholder={t('expenseInternalNotePlaceholder')}
              className="w-full rounded-lg border border-amber-300 bg-amber-50/40 px-2 py-1 text-xs text-foreground/85 placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-amber-700/60 dark:bg-amber-900/10"
            />
            <p className="mt-0.5 text-[11px] text-muted-foreground/80">{t('expenseInternalNoteHint')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onMouseDown={keepFocus} onClick={() => void send(true)}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
              {confirmed ? t('expenseTkSave') : t('expenseTkConfirmBtn')}
            </Button>
            {confirmed && (
              <Button size="sm" variant="outline" disabled={busy} onMouseDown={keepFocus} onClick={() => void send(false)}>
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
  // Writes return the updated row — patch it into the cache instead of
  // refetching the whole queue on every autosave.
  const patchRow = (id: FinanceExpense['id'], patch: Partial<FinanceExpense>) =>
    qc.setQueryData<{ expenses: FinanceExpense[]; sections: string[] }>(['finance', 'tk-expenses'], (old) =>
      old && { ...old, expenses: old.expenses.map((x) => (x.id === id ? { ...x, ...patch } : x)) })

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{t('tkExpensesTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('tkExpensesSubtitle')}</p>
      </div>

      <div className="rounded-2xl border border-hairline bg-card shadow-card p-4">
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground/80" /></div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground/80">{t('tkExpensesEmpty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colDate')}</TableHead>
                  <TableHead>{t('expenseMember')}</TableHead>
                  <TableHead className="text-right">{t('expenseAmount')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('expenseVendor')}</TableHead>
                  <TableHead>{t('expenseStatusCol')}</TableHead>
                  <TableHead>{t('expenseTkActionCol')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => <TkRow key={e.id} e={e} onSaved={(p) => patchRow(e.id, p)} />)}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
