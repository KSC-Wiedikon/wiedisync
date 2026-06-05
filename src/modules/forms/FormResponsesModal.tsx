import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FileText, FileSpreadsheet, Braces, FileDown, BellRing, Users } from 'lucide-react'
import { useCollection } from '../../lib/query'
import { kscwApi, assetUrl } from '../../lib/api'
import { toCSV, toJSON, toXlsx, downloadText, downloadBlob } from '../admin/utils/exportResults'
import { formatDateTimeCompactZurich } from '../../utils/dateHelpers'
import { resolveFieldLabel } from './labels'
import type { FormDef, FormSubmission, FieldDef, AnswerValue, FileAnswer } from './types'

interface Props {
  open: boolean
  form: FormDef
  onClose: () => void
}

interface FormStats {
  targeted: number
  responded: number
  nonResponders: { id: string; first_name?: string; last_name?: string }[]
}

function fileBase(title: string): string {
  return (title || 'form').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'form'
}

function isFileAnswer(v: AnswerValue): v is FileAnswer {
  return !!v && typeof v === 'object' && !Array.isArray(v) && 'id' in v
}

/** Render the responses table to a paginated A4 PDF (html-to-image + jspdf). */
async function exportTablePdf(node: HTMLElement, filename: string) {
  const { toPng } = await import('html-to-image')
  const { jsPDF } = await import('jspdf')
  const dataUrl = await toPng(node, { pixelRatio: 2, backgroundColor: '#ffffff' })
  const img = new Image()
  img.src = dataUrl
  await new Promise((res) => { img.onload = res })
  const pdf = new jsPDF('p', 'mm', 'a4')
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const imgW = pageW
  const imgH = (img.height / img.width) * imgW
  let heightLeft = imgH
  let position = 0
  pdf.addImage(dataUrl, 'PNG', 0, position, imgW, imgH)
  heightLeft -= pageH
  while (heightLeft > 0) {
    position -= pageH
    pdf.addPage()
    pdf.addImage(dataUrl, 'PNG', 0, position, imgW, imgH)
    heightLeft -= pageH
  }
  pdf.save(filename)
}

export default function FormResponsesModal({ open, form, onClose }: Props) {
  const { t, i18n } = useTranslation('forms')
  const tableRef = useRef<HTMLDivElement>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [stats, setStats] = useState<FormStats | null>(null)
  const [reminding, setReminding] = useState(false)
  const [remindMsg, setRemindMsg] = useState('')
  const [showMissing, setShowMissing] = useState(false)

  // Roster tracking is only meaningful for member-scoped (non-anonymous,
  // non-public) forms — the server endpoint refuses the others.
  const trackable = !form.anonymous && !form.is_public

  const { data: subsRaw, isLoading } = useCollection<FormSubmission>('form_submissions', {
    filter: { form: { _eq: form.id } },
    fields: ['id', 'form', 'member.id', 'member.first_name', 'member.last_name', 'answers', 'submitted_at'],
    sort: ['submitted_at'],
    limit: 1000,
    enabled: open,
  })
  const submissions = subsRaw ?? []

  useEffect(() => {
    if (!open || !trackable) { setStats(null); return }
    let cancelled = false
    kscwApi<FormStats>(`/forms/${form.id}/stats`)
      .then((s) => { if (!cancelled) setStats(s) })
      .catch(() => { if (!cancelled) setStats(null) })
    return () => { cancelled = true }
  }, [open, trackable, form.id, submissions.length])

  async function remind() {
    setReminding(true)
    setRemindMsg('')
    try {
      const r = await kscwApi<{ reminded: number }>(`/forms/${form.id}/remind`, { method: 'POST' })
      setRemindMsg(r.reminded > 0 ? t('remindSent', { count: r.reminded }) : t('remindNobody'))
    } catch {
      setRemindMsg(t('remindFailed'))
    } finally {
      setReminding(false)
    }
  }

  const memberName = (m: FormSubmission['member']): string => {
    if (!m || typeof m !== 'object') return m ? String(m) : '—'
    return `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || String(m.id)
  }
  const fieldLabel = (f: FieldDef) => resolveFieldLabel(f, i18n.language)

  // String form of an answer (for export). File answers export their asset URL.
  const answerToString = (v: AnswerValue, field: FieldDef): string => {
    if (v === null || v === undefined || v === '') return ''
    if (isFileAnswer(v)) return assetUrl(v.id)
    if (field.type === 'multi_choice' && Array.isArray(v)) return v.join(', ')
    if (field.type === 'yes_no' || typeof v === 'boolean') return v ? t('yes') : t('no')
    if (field.type === 'rating') return `${v}/5`
    return String(v)
  }

  const { columns, exportRows, displayRows } = useMemo(() => {
    const cols = [t('submittedAt')]
    if (!form.anonymous) cols.push(t('member'))
    for (const f of form.fields) cols.push(fieldLabel(f))

    const exp = submissions.map((s) => {
      const row: string[] = [formatDateTimeCompactZurich(s.submitted_at)]
      if (!form.anonymous) row.push(memberName(s.member))
      for (const f of form.fields) row.push(answerToString((s.answers ?? {})[f.id] ?? null, f))
      return row
    })
    // Display rows keep file answers as objects so the table can link them.
    const disp = submissions.map((s) => {
      const row: (string | FileAnswer)[] = [formatDateTimeCompactZurich(s.submitted_at)]
      if (!form.anonymous) row.push(memberName(s.member))
      for (const f of form.fields) {
        const v = (s.answers ?? {})[f.id] ?? null
        row.push(isFileAnswer(v) ? v : answerToString(v, f))
      }
      return row
    })
    return { columns: cols, exportRows: exp, displayRows: disp }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissions, form, t, i18n.language])

  const base = fileBase(form.title)
  const exportCsv = () => downloadText(toCSV(columns, exportRows), `${base}.csv`, 'text/csv;charset=utf-8')
  const exportJson = () => downloadText(toJSON(columns, exportRows), `${base}.json`, 'application/json')
  const exportXlsx = async () => downloadBlob(await toXlsx(columns, exportRows), `${base}.xlsx`)
  const exportPdf = async () => {
    if (!tableRef.current) return
    setPdfBusy(true)
    try { await exportTablePdf(tableRef.current, `${base}.pdf`) } finally { setPdfBusy(false) }
  }

  const hasRows = displayRows.length > 0

  return (
    <Modal open={open} onClose={onClose} title={`${form.title} — ${t('responses')}`} size="lg">
      <div className="space-y-4">
        {/* Roster-aware progress + reminder (member-scoped forms only) */}
        {trackable && stats && stats.targeted > 0 && (
          <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm">
                <Users size={15} className="text-muted-foreground" />
                <span className="font-medium">{t('respondedCount', { done: stats.responded, total: stats.targeted })}</span>
              </div>
              {stats.nonResponders.length > 0 && (
                <Button variant="outline" size="sm" onClick={remind} loading={reminding}>
                  <BellRing size={15} className="mr-1" />{t('remindNonResponders')}
                </Button>
              )}
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-brand-500 transition-all"
                style={{ width: `${stats.targeted ? Math.round((stats.responded / stats.targeted) * 100) : 0}%` }}
              />
            </div>
            {remindMsg && <p className="mt-2 text-xs text-muted-foreground">{remindMsg}</p>}
            {stats.nonResponders.length > 0 && (
              <button
                type="button"
                onClick={() => setShowMissing((v) => !v)}
                className="mt-2 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
              >
                {showMissing ? t('hideMissing') : t('showMissing', { count: stats.nonResponders.length })}
              </button>
            )}
            {showMissing && (
              <p className="mt-1 text-xs text-muted-foreground">
                {stats.nonResponders.map((m) => `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim()).join(', ')}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">{t('responseCount', { count: submissions.length })}</span>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!hasRows}><FileText size={15} className="mr-1" />CSV</Button>
            <Button variant="outline" size="sm" onClick={exportXlsx} disabled={!hasRows}><FileSpreadsheet size={15} className="mr-1" />Excel</Button>
            <Button variant="outline" size="sm" onClick={exportJson} disabled={!hasRows}><Braces size={15} className="mr-1" />JSON</Button>
            <Button variant="outline" size="sm" onClick={exportPdf} disabled={!hasRows} loading={pdfBusy}><FileDown size={15} className="mr-1" />PDF</Button>
          </div>
        </div>

        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('loading')}</p>
        ) : !hasRows ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('noResponses')}</p>
        ) : (
          <div ref={tableRef} className="overflow-x-auto bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => (
                    <TableHead key={c} className="whitespace-nowrap">{c}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayRows.map((row, ri) => (
                  <TableRow key={ri}>
                    {row.map((cell, ci) => (
                      <TableCell key={ci} className="align-top text-sm">
                        {isFileAnswer(cell) ? (
                          <a href={assetUrl(cell.id)} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline dark:text-brand-400">
                            {cell.name || t('download')}
                          </a>
                        ) : (
                          String(cell ?? '')
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </Modal>
  )
}
