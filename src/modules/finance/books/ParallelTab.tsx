// Parallel run: the native book against the ClubDesk mirror, month by month.
// A month is signed off once it is over — with a note when the books still differ.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2, PenLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { usePrompt } from '../../../components/ConfirmProvider'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { formatDateCompactZurich, formatDateTimeCompactZurich } from '../../../utils/dateHelpers'
import { useAuth } from '../../../hooks/useAuth'
import { formatChf } from '../../../hooks/useFinance'
import { useParallel, signOffMonth } from '../../../hooks/useFinanceBooks'

const apiErr = (e: unknown, fb: string) => (e as { body?: { error?: string } })?.body?.error || fb
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-')
  return `${mo}.${y}`
}

export default function ParallelTab({ fiscalYearId }: { fiscalYearId?: string | number | null }) {
  const { t } = useTranslation('finance')
  const { canAccessFinance: canWrite } = useAuth()
  const qc = useQueryClient()
  const prompt = usePrompt()
  const [month, setMonth] = useState<string | null>(null)
  const [onlyDiff, setOnlyDiff] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const { data, isLoading } = useParallel(fiscalYearId, month)
  const today = new Date().toISOString().slice(0, 10)

  async function signOff(m: string, differs: boolean) {
    const note = await prompt({ message: differs ? t('bkSignOffNoteRequired') : t('bkSignOffNote'), defaultValue: '' })
    if (note == null) return
    setBusy(m)
    try {
      await signOffMonth(Number(fiscalYearId), m, note)
      toast.success(t('bkSignedOff', { month: monthLabel(m) }))
      qc.invalidateQueries({ queryKey: ['finance'] })
    } catch (e) { toast.error(apiErr(e, t('ledActionError'))) } finally { setBusy(null) }
  }

  if (isLoading || !data) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground/80" /></div>
  const rows = (data.detail?.rows ?? []).filter((r) => !onlyDiff || Math.abs(r.diff) >= 0.005)
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t('bkParallelIntro')}</p>
      <p className="text-xs text-muted-foreground">{t('bkParallelCounts', { native: data.counts.native, clubdesk: data.counts.clubdesk })}</p>
      <div className="overflow-x-auto rounded-2xl border border-hairline bg-card shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('bkMonth')}</TableHead>
              <TableHead className="hidden sm:table-cell text-right">{t('bkAccountsDifferent')}</TableHead>
              <TableHead className="hidden sm:table-cell text-right">{t('bkDifference')}</TableHead>
              <TableHead>{t('bkSignOff')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.months.map((m) => {
              const selected = (month ?? data.month) === m.month
              const over = m.through < today
              return (
                <TableRow key={m.month} onClick={() => setMonth(m.month)} className={`cursor-pointer ${selected ? 'bg-selected/40' : ''}`}>
                  <TableCell className="whitespace-nowrap font-medium text-foreground">
                    {monthLabel(m.month)}
                    {/* Phones: the two figures under the month — their columns are hidden. */}
                    <span className="block text-xs font-normal text-muted-foreground sm:hidden">
                      <span className={m.accountsDifferent ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}>{m.accountsDifferent}</span> {t('bkAccountsDifferent')}
                      <span className="block tabular-nums">{formatChf(m.differenceTotal)}</span>
                    </span>
                  </TableCell>
                  <TableCell className={`hidden sm:table-cell text-right tabular-nums ${m.accountsDifferent ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>{m.accountsDifferent}</TableCell>
                  <TableCell className="hidden sm:table-cell whitespace-nowrap text-right tabular-nums text-foreground">{formatChf(m.differenceTotal)}</TableCell>
                  <TableCell className="whitespace-normal" onClick={(e) => e.stopPropagation()}>
                    {m.signoff ? (
                      <span className="inline-flex items-start gap-1 text-xs text-green-700 dark:text-green-400">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{m.signoff.signed_by_name} · {formatDateTimeCompactZurich(m.signoff.signed_at)}{m.signoff.note ? <span className="block text-muted-foreground">{m.signoff.note}</span> : null}</span>
                      </span>
                    ) : over && canWrite ? (
                      <Button type="button" size="sm" variant="outline" disabled={busy === m.month} onClick={() => signOff(m.month, m.accountsDifferent > 0)}
                        icon={busy === m.month ? <Loader2 className="animate-spin" /> : <PenLine />}>{t('bkSignOff')}</Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">{over ? t('bkNotSigned') : t('bkMonthRunning')}</span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {data.detail && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-semibold text-foreground">{t('bkAccountsThrough', { date: formatDateCompactZurich(data.months.find((m) => m.month === (month ?? data.month))?.through || '') })}</h3>
            <label className="ml-auto flex min-h-9 cursor-pointer items-center gap-2 text-sm text-foreground/85">
              <Checkbox checked={onlyDiff} onCheckedChange={(v) => setOnlyDiff(v === true)} />{t('bkOnlyDifferences')}
            </label>
          </div>
          {rows.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border py-8 text-center text-sm text-green-700 dark:text-green-400">{t('bkBooksMatch')}</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-hairline bg-card shadow-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colAccount')}</TableHead>
                    <TableHead className="hidden sm:table-cell text-right">{t('bkBookClubdesk')}</TableHead>
                    <TableHead className="hidden sm:table-cell text-right">{t('bkBookNative')}</TableHead>
                    <TableHead className="text-right">{t('bkDifference')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.account}>
                      <TableCell className="whitespace-normal break-words text-foreground"><span className="tabular-nums text-muted-foreground">{r.number}</span> {r.name}
                        <span className="block text-xs tabular-nums text-muted-foreground sm:hidden">{t('bkBookClubdesk')} {formatChf(r.clubdesk)} · {t('bkBookNative')} {formatChf(r.native)}</span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell whitespace-nowrap text-right tabular-nums text-foreground">{formatChf(r.clubdesk)}</TableCell>
                      <TableCell className="hidden sm:table-cell whitespace-nowrap text-right tabular-nums text-foreground">{formatChf(r.native)}</TableCell>
                      <TableCell className={`whitespace-nowrap text-right tabular-nums ${Math.abs(r.diff) >= 0.005 ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>{formatChf(r.diff)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
