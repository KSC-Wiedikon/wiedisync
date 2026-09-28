import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, BellRing, ShieldOff, ShieldCheck } from 'lucide-react'
import Modal from '../../components/Modal'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import {
  useDunningCandidates, escalateDunning, setMemberNeverDun, formatChf, toNum,
  type DunningCandidate,
} from '../../hooks/useFinance'

const labelCls = 'block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'
const inputCls = 'mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm sm:h-9 dark:bg-gray-800 text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const apiErr = (e: unknown, fb: string) => (e as { body?: { error?: string } })?.body?.error || fb
const daysOverdue = (due: string | null, today: string) => (due ? Math.max(0, Math.floor((Date.parse(today) - Date.parse(due)) / 86_400_000)) : 0)
const tableWrapCls = 'rounded-2xl border border-hairline bg-card shadow-card overflow-hidden'
const thCls = ''
const barCls = 'block h-3 animate-pulse rounded bg-stone-200/80 dark:bg-muted'

/** Shared header so the loading placeholder has the exact shape of the real table. */
function DunningHead() {
  const { t } = useTranslation('finance')
  return (
    <TableHeader>
      <TableRow>
        <TableHead className={thCls}>{t('colRecipient')}</TableHead>
        <TableHead className={`hidden sm:table-cell ${thCls}`}>{t('colDue')}</TableHead>
        <TableHead className={`text-right ${thCls}`}>{t('colOpen')}</TableHead>
        <TableHead className={thCls}>{t('dunColLevel')}</TableHead>
        <TableHead className={`text-right ${thCls}`}></TableHead>
      </TableRow>
    </TableHeader>
  )
}

/** Placeholder rows while the candidate list is in flight — never a verdict. */
function DunningSkeleton() {
  return (
    <div className={tableWrapCls} aria-busy="true">
      <Table>
        <DunningHead />
        <TableBody>
          {[0, 1, 2, 3, 4].map((i) => (
            <TableRow key={i}>
              <TableCell>
                <span className={`${barCls} w-32`} aria-hidden="true" />
                <span className={`${barCls} mt-1.5 w-24`} aria-hidden="true" />
              </TableCell>
              <TableCell className="hidden sm:table-cell"><span className={`${barCls} w-20`} aria-hidden="true" /></TableCell>
              <TableCell><span className={`${barCls} ml-auto w-16`} aria-hidden="true" /></TableCell>
              <TableCell><span className={`${barCls} w-10`} aria-hidden="true" /></TableCell>
              <TableCell><span className={`${barCls} ml-auto w-24`} aria-hidden="true" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function EscalateModal({ row, onClose, onDone }: { row: DunningCandidate | null; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation('finance')
  const [fee, setFee] = useState('')
  const [sendEmail, setSendEmail] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const next = (row?.dunning_level ?? 0) + 1

  async function go() {
    if (!row) return
    setBusy(true); setError('')
    try {
      const r = await escalateDunning(row.id, { level: next, reminder_fee: Number(fee.replace(',', '.')) || 0, send_email: sendEmail })
      const sent = { sent: t('dunSentLive'), test: t('dunSentTest'), no_test_recipient: t('dunNoTestRecipient'), send_failed: t('dunSendFailed'), not_sent: t('dunRecorded') }[r.send_result] ?? t('dunRecorded')
      setResult(sent); onDone()
    } catch (e) { setError(apiErr(e, t('dunEscalateError'))) } finally { setBusy(false) }
  }

  return (
    <Modal open={!!row} onClose={onClose} title={t('dunEscalateTitle', { level: next })}>
      {row && (
        <div className="space-y-4">
          <div className="rounded-xl border border-hairline bg-surface-sunken p-3 text-sm">
            <div className="font-medium text-foreground">{row.number} · {row.recipient_name || '–'}</div>
            <div className="text-xs text-muted-foreground">{t('colOpen')}: {formatChf(row.open_amount)} · {row.recipient_email || t('noEmail')}</div>
          </div>
          {result ? (
            <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300">{result}</p>
          ) : (
            <>
              <div>
                <label htmlFor="dun-fee" className={labelCls}>{t('dunFee')}</label>
                <input id="dun-fee" value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" placeholder="0.00" className={inputCls} />
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground/85">
                <input type="checkbox" className="h-4 w-4 rounded border-input accent-[var(--primary)]" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} disabled={!row.recipient_email} />
                {t('dunSendEmail')}
              </label>
              {sendEmail && <p className="text-xs text-amber-700 dark:text-amber-400">{t('dunTestModeNote')}</p>}
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={onClose}>{t('cancel')}</Button>
                <Button type="button" disabled={busy} onClick={go}
                  className="bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}{t('dunEscalateCta', { level: next })}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}

export default function DunningConsole() {
  const { t } = useTranslation('finance')
  const { data, isLoading, isError, refetch } = useDunningCandidates()
  const [target, setTarget] = useState<DunningCandidate | null>(null)
  const [busyDun, setBusyDun] = useState<number | null>(null)
  const [err, setErr] = useState('')
  // `data` is undefined while the request is in flight AND when it fails, so an empty
  // `candidates` used to mean either "nothing overdue" or "nothing loaded yet" — and the
  // console printed the all-clear for both. Only trust the length once the query settled.
  const candidates = data?.candidates ?? []
  const today = data?.today ?? new Date().toISOString().slice(0, 10)

  async function toggleNeverDun(c: DunningCandidate) {
    if (!c.member) return
    setBusyDun(c.member); setErr('')
    try { await setMemberNeverDun(c.member, !c.never_dun); await refetch() }
    catch (e) { setErr(apiErr(e, t('ledActionError'))) }
    finally { setBusyDun(null) }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t('dunHint')}</p>
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      {isLoading ? (
        <DunningSkeleton />
      ) : isError ? (
        <p className="rounded-lg border border-dashed border-red-300 py-10 text-center text-sm text-red-600 dark:border-red-800 dark:text-red-400">{t('common:error')}</p>
      ) : candidates.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">{t('dunNone')}</p>
      ) : (
        <div className={tableWrapCls}>
          <Table>
            <DunningHead />
            <TableBody>
              {candidates.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="whitespace-normal break-words text-foreground">
                    {c.recipient_name || '–'}
                    <span className="mt-0.5 block text-xs text-muted-foreground/80">{c.number} · {t('dunDaysOverdue', { days: daysOverdue(c.due_date, today) })}</span>
                    {c.never_dun ? <span className="mt-0.5 inline-block rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t('dunNeverBadge')}</span> : null}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell whitespace-nowrap text-muted-foreground">{c.due_date ? formatDateCompactZurich(c.due_date) : '–'}</TableCell>
                  <TableCell className="text-right tabular-nums text-foreground">{formatChf(toNum(c.open_amount))}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{c.dunning_level > 0 ? t('dunLevelBadge', { level: c.dunning_level }) : '–'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:justify-end">
                      {c.member ? (
                        <Button type="button" size="sm" variant="outline" disabled={busyDun === c.member} onClick={() => toggleNeverDun(c)}>
                          {c.never_dun ? <ShieldCheck /> : <ShieldOff />}
                          {c.never_dun ? t('dunUndoNever') : t('dunSetNever')}
                        </Button>
                      ) : null}
                      {c.dunning_level < 3 && !c.never_dun && (
                        <Button type="button" size="sm" onClick={() => setTarget(c)}
                          className="bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500">
                          <BellRing />{t('dunEscalateCta', { level: c.dunning_level + 1 })}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <EscalateModal key={target?.id ?? 'none'} row={target} onClose={() => setTarget(null)} onDone={() => { refetch() }} />
    </div>
  )
}
