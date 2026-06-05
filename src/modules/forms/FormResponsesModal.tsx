import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FileText, FileSpreadsheet, Braces, FileDown } from 'lucide-react'
import { useCollection } from '../../lib/query'
import { toCSV, toJSON, toXlsx, downloadText, downloadBlob } from '../admin/utils/exportResults'
import { formatDateTimeCompactZurich } from '../../utils/dateHelpers'
import type { FormDef, FormSubmission, FieldDef, AnswerValue } from './types'

interface Props {
  open: boolean
  form: FormDef
  onClose: () => void
}

function fileBase(title: string): string {
  return (title || 'form').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'form'
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
  const { t } = useTranslation('forms')
  const tableRef = useRef<HTMLDivElement>(null)
  const [pdfBusy, setPdfBusy] = useState(false)

  const { data: subsRaw, isLoading } = useCollection<FormSubmission>('form_submissions', {
    filter: { form: { _eq: form.id } },
    fields: ['id', 'form', 'member.id', 'member.first_name', 'member.last_name', 'answers', 'submitted_at'],
    sort: ['submitted_at'],
    limit: 1000,
    enabled: open,
  })
  const submissions = subsRaw ?? []

  const memberName = (m: FormSubmission['member']): string => {
    if (!m || typeof m !== 'object') return m ? String(m) : '—'
    return `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || String(m.id)
  }
  const formatAnswer = (v: AnswerValue, field: FieldDef): string => {
    if (v === null || v === undefined || v === '') return ''
    if (field.type === 'multi_choice' && Array.isArray(v)) return v.join(', ')
    if (field.type === 'yes_no' || typeof v === 'boolean') return v ? t('yes') : t('no')
    return String(v)
  }

  const { columns, rows } = useMemo(() => {
    const cols = [t('submittedAt')]
    if (!form.anonymous) cols.push(t('member'))
    for (const f of form.fields) cols.push(f.label)
    const r = submissions.map((s) => {
      const row: unknown[] = [formatDateTimeCompactZurich(s.submitted_at)]
      if (!form.anonymous) row.push(memberName(s.member))
      for (const f of form.fields) row.push(formatAnswer((s.answers ?? {})[f.id] ?? null, f))
      return row
    })
    return { columns: cols, rows: r }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissions, form, t])

  const base = fileBase(form.title)
  const exportCsv = () => downloadText(toCSV(columns, rows), `${base}.csv`, 'text/csv;charset=utf-8')
  const exportJson = () => downloadText(toJSON(columns, rows), `${base}.json`, 'application/json')
  const exportXlsx = async () => downloadBlob(await toXlsx(columns, rows), `${base}.xlsx`)
  const exportPdf = async () => {
    if (!tableRef.current) return
    setPdfBusy(true)
    try { await exportTablePdf(tableRef.current, `${base}.pdf`) } finally { setPdfBusy(false) }
  }

  const hasRows = rows.length > 0

  return (
    <Modal open={open} onClose={onClose} title={`${form.title} — ${t('responses')}`} size="lg">
      <div className="space-y-4">
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
                {rows.map((row, ri) => (
                  <TableRow key={ri}>
                    {row.map((cell, ci) => (
                      <TableCell key={ci} className="align-top text-sm">{String(cell ?? '')}</TableCell>
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
