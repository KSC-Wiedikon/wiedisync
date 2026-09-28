import { useState, useRef } from 'react'
import { createRecord } from '../../lib/api'
import { useTranslation } from 'react-i18next'
import { Download, Upload, AlertCircle, CheckCircle2 } from 'lucide-react'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAuth } from '../../hooks/useAuth'
import {
  parseAbsenceFile,
  validateRow,
  downloadTemplate,
  type RawAbsenceRow,
  type ValidatedRow,
} from './absenceImportUtils'

interface AbsenceImportModalProps {
  open: boolean
  onClose: () => void
  onComplete: () => void
}

export default function AbsenceImportModal({ open, onClose, onComplete }: AbsenceImportModalProps) {
  const { t } = useTranslation('absences')
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const [rows, setRows] = useState<ValidatedRow[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ created: number; failed: number } | null>(null)
  const [parseError, setParseError] = useState('')

  const validRows = rows.filter((r) => r.errors.length === 0)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setResult(null)
    setParseError('')

    try {
      const rawRows: RawAbsenceRow[] = await parseAbsenceFile(file)
      const validated = rawRows.map((r) => validateRow(r, t))
      setRows(validated)
    } catch {
      setParseError(t('importParseError'))
      setRows([])
    }
  }

  async function handleImport() {
    if (validRows.length === 0 || !user) return
    setImporting(true)
    setResult(null)

    let created = 0
    let failed = 0

    // Insert in bounded-concurrency batches so a large import isn't N serial
    // round-trips, while still counting per-row failures.
    const CONCURRENCY = 10
    for (let i = 0; i < validRows.length; i += CONCURRENCY) {
      const batch = validRows.slice(i, i + CONCURRENCY)
      const settled = await Promise.allSettled(
        batch.map((row) =>
          createRecord('absences', {
            member: user.id,
            start_date: row.start_date,
            end_date: row.end_date,
            reason: row.normalizedReason,
            reason_detail: row.reason_detail,
            affects: row.normalizedAffects,
          }),
        ),
      )
      for (const r of settled) {
        if (r.status === 'fulfilled') created++
        else failed++
      }
    }

    setResult({ created, failed })
    setImporting(false)

    // Refresh the parent list as soon as anything imported — even on a partial
    // failure — so the successful rows show up immediately instead of relying on
    // best-effort realtime.
    if (created > 0) onComplete()

    if (created > 0 && failed === 0) {
      // All succeeded — close after a short delay. On partial failure the modal
      // stays open so the user can see which rows failed.
      setTimeout(() => {
        handleClose()
      }, 1500)
    }
  }

  function handleClose() {
    setRows([])
    setResult(null)
    setParseError('')
    if (fileRef.current) fileRef.current.value = ''
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title={t('importTitle')} size="lg">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('importDescription')}</p>

        {/* File input + template download */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileChange}
            className="text-sm text-foreground/85 file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground/85"
          />
          <Button
            type="button"
            variant="link"
            icon={<Download />}
            onClick={downloadTemplate}
            className="self-start px-0 sm:self-auto"
          >
            {t('importDownloadTemplate')}
          </Button>
        </div>

        {parseError && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {parseError}
          </div>
        )}

        {/* Preview table */}
        {rows.length > 0 && (
          <>
            <div className="text-sm font-semibold text-foreground">
              {t('importPreview')} — {t('importValidRows', { valid: String(validRows.length), total: String(rows.length) })}
            </div>

            <div className="max-h-64 overflow-auto rounded-xl border border-border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-surface-sunken">
                  <TableRow>
                    <TableHead className="text-muted-foreground">#</TableHead>
                    <TableHead className="text-muted-foreground">{t('startDate')}</TableHead>
                    <TableHead className="text-muted-foreground">{t('endDate')}</TableHead>
                    <TableHead className="text-muted-foreground">{t('reason')}</TableHead>
                    <TableHead className="text-muted-foreground">{t('detailsOptional')}</TableHead>
                    <TableHead className="text-muted-foreground">{t('affects')}</TableHead>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => {
                    const hasErrors = row.errors.length > 0
                    return (
                      <TableRow
                        key={i}
                        className={hasErrors ? 'bg-red-50/50 dark:bg-red-900/10' : ''}
                        title={hasErrors ? row.errors.join('\n') : undefined}
                      >
                        <TableCell className="text-muted-foreground/80">{i + 1}</TableCell>
                        <TableCell className="whitespace-nowrap text-foreground">{row.start_date || '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-foreground">{row.end_date || '—'}</TableCell>
                        <TableCell className="text-foreground">{row.reason || '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{row.reason_detail || ''}</TableCell>
                        <TableCell className="text-muted-foreground">{row.affects || 'all'}</TableCell>
                        <TableCell>
                          {hasErrors ? (
                            <AlertCircle className="h-4 w-4 text-red-500" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Import button */}
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={handleClose}>
                {t('common:cancel')}
              </Button>
              <Button
                onClick={handleImport}
                disabled={validRows.length === 0 || importing}
                loading={importing}
              >
                <Upload className="mr-2 h-4 w-4" />
                {t('importButton', { count: validRows.length })}
              </Button>
            </div>
          </>
        )}

        {/* Result banner */}
        {result && (
          <div
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
              result.failed === 0
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300'
            }`}
          >
            {result.failed === 0 ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            {result.failed === 0
              ? t('importSuccess', { count: result.created })
              : t('importPartialSuccess', { created: String(result.created), failed: String(result.failed) })}
          </div>
        )}
      </div>
    </Modal>
  )
}
