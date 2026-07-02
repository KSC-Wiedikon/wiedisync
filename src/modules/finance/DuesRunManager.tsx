import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Loader2, PlayCircle, ListChecks, Download, Mail } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { formatDateCompactZurich } from '../../utils/dateHelpers'
import {
  useDuesRates, useDuesRuns, saveDuesRate, deleteDuesRate,
  previewDuesRun, issueDuesRun, cancelDuesRun, fetchDuesRunInvoices, formatChf, toNum,
  type DuesPreviewResult, type DuesPreviewRow, type DuesRun,
} from '../../hooks/useFinance'
import { downloadInvoiceBillsPdf } from './qrBillPdf'
import { DuesEmailSettings, SendDuesEmailModal } from './DuesEmail'

const labelCls = 'block text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'
const inputCls = 'mt-1 w-full rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
const apiErr = (e: unknown, fallback: string) => (e as { body?: { error?: string } })?.body?.error || fallback

/** Per-member row status badge in the preview. */
function rowStatus(r: DuesPreviewRow): 'willBill' | 'alreadyBilled' | 'noRate' {
  if (r.missing_rate) return 'noRate'
  if (r.already_billed) return 'alreadyBilled'
  return 'willBill'
}
const STATUS_TONE: Record<string, string> = {
  willBill: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  alreadyBilled: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  noRate: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
}

export default function DuesRunManager({ fiscalYearId, fiscalYearLabel }: { fiscalYearId: string; fiscalYearLabel: string }) {
  const { t } = useTranslation('finance')
  const fyNum = Number(fiscalYearId)
  const { data: ratesData, refetch: refetchRates } = useDuesRates(fiscalYearId)
  const { data: runs, refetch: refetchRuns } = useDuesRuns(fiscalYearId)
  const categories = ratesData?.categories ?? []
  const sektionen = ratesData?.sektionen ?? []

  // ── Add-rate form ──
  const [rCat, setRCat] = useState('')
  const [rSek, setRSek] = useState('')
  const [rAmt, setRAmt] = useState('')
  const [rSubj, setRSubj] = useState('')
  const [rBusy, setRBusy] = useState(false)
  const [rErr, setRErr] = useState('')
  const rAmtNum = Number(rAmt.replace(',', '.'))
  const rValid = !!rCat && rAmtNum >= 0 && rAmt.trim() !== ''

  async function addRate() {
    if (!rValid) return
    setRBusy(true); setRErr('')
    try {
      await saveDuesRate({ fiscal_year: fyNum, category: rCat, sektion: rSek || null, amount_chf: rAmtNum, subject_template: rSubj.trim() || null })
      setRCat(''); setRSek(''); setRAmt(''); setRSubj('')
      await refetchRates()
    } catch (e) { setRErr(apiErr(e, t('duesRateSaveError'))) } finally { setRBusy(false) }
  }
  async function removeRate(id: number) {
    if (!window.confirm(t('duesRateDeleteSure'))) return
    setRErr('')
    try { await deleteDuesRate(id); await refetchRates() } catch (e) { setRErr(apiErr(e, t('ledActionError'))) }
  }

  // ── Run wizard ──
  const [selected, setSelected] = useState<string[]>([])
  const [onlyActive, setOnlyActive] = useState(true)
  const [dueDate, setDueDate] = useState('')
  const [preview, setPreview] = useState<DuesPreviewResult | null>(null)
  const [pvBusy, setPvBusy] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [runMsg, setRunMsg] = useState('')
  const [runErr, setRunErr] = useState('')
  const toggleCat = (c: string) => { setPreview(null); setRunMsg(''); setSelected((p) => p.includes(c) ? p.filter((x) => x !== c) : [...p, c]) }

  async function runPreview() {
    if (!selected.length) { setRunErr(t('duesNoCategories')); return }
    setPvBusy(true); setRunErr(''); setRunMsg('')
    try {
      setPreview(await previewDuesRun({ fiscal_year: fyNum, categories: selected, only_active: onlyActive }))
    } catch (e) { setRunErr(apiErr(e, t('duesPreviewError'))) } finally { setPvBusy(false) }
  }
  async function issue() {
    if (!preview) return
    const billable = preview.totals.billable
    if (!billable) return
    if (!window.confirm(t('duesIssueSure', { count: billable, amount: formatChf(preview.totals.billable_amount) }))) return
    setIssuing(true); setRunErr('')
    try {
      const r = await issueDuesRun({ fiscal_year: fyNum, categories: selected, only_active: onlyActive, due_date: dueDate || null })
      setRunMsg(t('duesIssued', { count: r.summary.created, amount: formatChf(r.run.total_amount) }))
      setPreview(null); setSelected([])
      await refetchRuns()
    } catch (e) { setRunErr(apiErr(e, t('duesIssueError'))) } finally { setIssuing(false) }
  }
  async function cancelRun(id: number) {
    if (!window.confirm(t('duesRunCancelSure'))) return
    try {
      const r = await cancelDuesRun(id)
      setRunMsg(t('duesRunCancelled', { count: r.cancelled }))
      await refetchRuns()
    } catch (e) { setRunErr(apiErr(e, t('duesRunCancelError'))) }
  }

  // Download every bill in a run as one multi-page PDF (print/post or attach).
  const [billBusy, setBillBusy] = useState<number | null>(null)
  const [emailTarget, setEmailTarget] = useState<DuesRun | null>(null)
  async function downloadBills(run: DuesRun) {
    setBillBusy(run.id); setRunErr('')
    try {
      const { invoices } = await fetchDuesRunInvoices(run.id)
      const bills = invoices
        // Never re-bill a settled invoice — a full-amount QR slip would let a
        // paid member pay twice.
        .filter((inv) => inv.status !== 'paid')
        .map((inv) => {
          // Bill only the still-open balance. Fall back to the full amount only
          // when open_amount is genuinely unknown (null), never when it's 0 (paid).
          const open = inv.open_amount == null ? toNum(inv.amount) : toNum(inv.open_amount)
          return {
            number: inv.number,
            recipientName: inv.recipient_name,
            amount: open,
            message: [inv.number ? `Rechnungsnummer: ${inv.number}` : null, inv.subject].filter(Boolean).join('\n') || null,
            reference: inv.reference_type === 'SCOR' ? inv.reference : null,
          }
        })
        .filter((b) => b.amount >= 0.01)
      if (!bills.length) { setRunErr(t('duesBillsEmpty')); return }
      const safe = String(run.label || run.id).replace(/[^\w.-]+/g, '-')
      await downloadInvoiceBillsPdf(bills, `dues-${safe}.pdf`, t('duesBillsPdfTitle', { run: run.label || `#${run.id}` }))
    } catch { setRunErr(t('duesBillsError')) } finally { setBillBusy(null) }
  }

  const statusLabel = (s: string) => ({ willBill: t('duesStatusWillBill'), alreadyBilled: t('duesStatusAlreadyBilled'), noRate: t('duesStatusNoRate') }[s] ?? s)
  const sektionLabel = (s: string | null) => s || t('duesSektionDefault')
  const sortedRates = useMemo(() => [...(ratesData?.rates ?? [])].sort((a, b) => a.category.localeCompare(b.category) || (a.sektion || '').localeCompare(b.sektion || '')), [ratesData])

  if (!fiscalYearId) {
    return <p className="rounded-lg border border-dashed border-gray-300 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">{t('duesNeedFiscalYear')}</p>
  }

  return (
    <div className="space-y-8">
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
        {t('duesBookNote')}
      </p>

      {/* ── Rate schedule ──────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('duesRatesTitle')}</h2>
        <p className="mb-3 mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t('duesRatesHint', { year: fiscalYearLabel })}</p>

        <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <Table>
            <TableHeader>
              <TableRow className="border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('duesColCategory')}</TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('duesColSektion')}</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('duesColAmount')}</TableHead>
                <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('duesColSubject')}</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRates.map((r) => (
                <TableRow key={r.id} className="border-gray-200 dark:border-gray-700">
                  <TableCell className="whitespace-normal break-words text-gray-900 dark:text-gray-100">{r.category}</TableCell>
                  <TableCell className="whitespace-normal break-words text-gray-600 dark:text-gray-400">{sektionLabel(r.sektion)}</TableCell>
                  <TableCell className="text-right tabular-nums text-gray-900 dark:text-gray-100">{formatChf(r.amount_chf)}</TableCell>
                  <TableCell className="hidden sm:table-cell whitespace-normal break-words text-xs text-gray-500 dark:text-gray-400">{r.subject_template || '–'}</TableCell>
                  <TableCell className="text-right">
                    <button type="button" onClick={() => removeRate(r.id)} aria-label={t('duesRateDelete')}
                      className="inline-flex items-center rounded-md border border-gray-300 p-1.5 text-gray-500 hover:bg-gray-50 hover:text-red-600 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
              {/* Add-rate row */}
              <TableRow className="border-gray-200 bg-gray-50/60 dark:border-gray-700 dark:bg-gray-900/20">
                <TableCell>
                  <select value={rCat} onChange={(e) => setRCat(e.target.value)} className={`${inputCls} mt-0`} aria-label={t('duesColCategory')}>
                    <option value="">{t('duesPickCategory')}</option>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </TableCell>
                <TableCell>
                  <select value={rSek} onChange={(e) => setRSek(e.target.value)} className={`${inputCls} mt-0`} aria-label={t('duesColSektion')}>
                    <option value="">{t('duesSektionDefault')}</option>
                    {sektionen.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </TableCell>
                <TableCell>
                  <input value={rAmt} onChange={(e) => setRAmt(e.target.value)} inputMode="decimal" placeholder="0.00" className={`${inputCls} mt-0 text-right`} aria-label={t('duesColAmount')} />
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <input value={rSubj} onChange={(e) => setRSubj(e.target.value)} placeholder={t('duesSubjectPlaceholder')} className={`${inputCls} mt-0`} aria-label={t('duesColSubject')} />
                </TableCell>
                <TableCell className="text-right">
                  <button type="button" disabled={!rValid || rBusy} onClick={addRate}
                    className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                    {rBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}{t('duesAddRateCta')}
                  </button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        {rErr && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{rErr}</p>}
      </section>

      {/* ── Run wizard ─────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('duesRunTitle')}</h2>
        <p className="mb-3 mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t('duesRunHint', { year: fiscalYearLabel })}</p>

        <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div>
            <span id="dues-pick-categories-label" className={labelCls}>{t('duesPickCategories')}</span>
            {categories.length === 0 ? (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('duesNoActiveCategories')}</p>
            ) : (
              <div role="group" aria-labelledby="dues-pick-categories-label" className="mt-1.5 flex flex-wrap gap-1.5">
                {categories.map((c) => (
                  <button key={c} type="button" onClick={() => toggleCat(c)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${selected.includes(c)
                      ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                      : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-300'}`}>
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={onlyActive} onChange={(e) => { setOnlyActive(e.target.checked); setPreview(null) }} />
              {t('duesOnlyActive')}
            </label>
            <div>
              <label htmlFor="dues-run-due-date" className={labelCls}>{t('duesRunDueDate')}</label>
              <input id="dues-run-due-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`${inputCls} dark:bg-gray-800`} />
            </div>
            <button type="button" disabled={!selected.length || pvBusy} onClick={runPreview}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700">
              {pvBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}{t('duesPreviewCta')}
            </button>
          </div>

          {runErr && <p className="text-sm text-red-600 dark:text-red-400">{runErr}</p>}
          {runMsg && <p className="text-sm text-green-700 dark:text-green-400">{runMsg}</p>}

          {preview && (
            <div className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {t('duesPreviewSummary', {
                  billable: preview.totals.billable,
                  amount: formatChf(preview.totals.billable_amount),
                  already: preview.totals.already_billed,
                  noRate: preview.totals.missing_rate,
                })}
                {preview.totals.no_email > 0 && <span className="text-amber-700 dark:text-amber-400"> · {t('duesNoEmailNote', { count: preview.totals.no_email })}</span>}
              </p>
              <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                      <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('duesColMember')}</TableHead>
                      <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('duesColCategory')}</TableHead>
                      <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('duesColAmount')}</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colStatus')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.map((r) => {
                      const s = rowStatus(r)
                      return (
                        <TableRow key={r.member} className="border-gray-200 dark:border-gray-700">
                          <TableCell className="whitespace-normal break-words text-gray-900 dark:text-gray-100">
                            {r.name || '–'}
                            {r.missing_email && <span className="mt-0.5 block text-xs text-amber-600 dark:text-amber-400">{t('duesStatusNoEmail')}</span>}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell whitespace-normal break-words text-gray-600 dark:text-gray-400">{r.category || '–'}{r.sektion ? ` · ${r.sektion}` : ''}</TableCell>
                          <TableCell className="text-right tabular-nums text-gray-900 dark:text-gray-100">{r.amount != null ? formatChf(r.amount) : '–'}</TableCell>
                          <TableCell><span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[s]}`}>{statusLabel(s)}</span></TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-end">
                <button type="button" disabled={!preview.totals.billable || issuing} onClick={issue}
                  className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                  {issuing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                  {t('duesIssueCta', { count: preview.totals.billable })}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Email sending (global test-mode switch) ────────────── */}
      <DuesEmailSettings />

      {/* ── Past runs ──────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{t('duesRunsTitle')}</h2>
        {(runs ?? []).length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">{t('duesNoRuns')}</p>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                  <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('duesColRunLabel')}</TableHead>
                  <TableHead className="hidden sm:table-cell text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('duesColRunDate')}</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('duesColRunCount')}</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('duesColRunTotal')}</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('colStatus')}</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(runs ?? []).map((run) => (
                  <TableRow key={run.id} className="border-gray-200 dark:border-gray-700">
                    <TableCell className="whitespace-normal break-words text-gray-900 dark:text-gray-100">{run.label || `#${run.id}`}</TableCell>
                    <TableCell className="hidden sm:table-cell whitespace-nowrap text-gray-600 dark:text-gray-400">{run.date_created ? formatDateCompactZurich(run.date_created) : '–'}</TableCell>
                    <TableCell className="text-right tabular-nums text-gray-900 dark:text-gray-100">{run.total_count}</TableCell>
                    <TableCell className="text-right tabular-nums text-gray-900 dark:text-gray-100">{formatChf(toNum(run.total_amount))}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-gray-600 dark:text-gray-300">{run.status === 'cancelled' ? t('duesRunStatusCancelled') : t('duesRunStatusIssued')}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:justify-end">
                        {run.status !== 'cancelled' && run.total_count > 0 && (
                          <button type="button" disabled={billBusy === run.id} onClick={() => downloadBills(run)}
                            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">
                            {billBusy === run.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}{t('duesDownloadBills')}
                          </button>
                        )}
                        {run.status !== 'cancelled' && run.total_count > 0 && (
                          <button type="button" onClick={() => setEmailTarget(run)}
                            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">
                            <Mail className="h-3.5 w-3.5" />{t('duesEmailSendShort')}
                          </button>
                        )}
                        {run.status !== 'cancelled' && (
                          <button type="button" onClick={() => cancelRun(run.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">
                            {t('duesRunCancel')}
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <SendDuesEmailModal key={emailTarget?.id ?? 'none'} run={emailTarget} onClose={() => setEmailTarget(null)} />
    </div>
  )
}
