import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Loader2 } from 'lucide-react'
import { exportReport, type FinanceReport, type ExportFormat } from './reportExport'

/** Dropdown that exports a finance report (built lazily on click) to PDF / Excel / PowerPoint. */
export default function ReportExportMenu({ build, filename }: { build: () => FinanceReport; filename: string }) {
  const { t } = useTranslation('finance')
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const [open, setOpen] = useState(false)

  async function go(fmt: ExportFormat) {
    setOpen(false); setBusy(fmt)
    try { await exportReport(fmt, build(), filename) } catch (e) { alert((e as Error)?.message || 'Export failed') } finally { setBusy(null) }
  }
  const opts: { fmt: ExportFormat; label: string }[] = [
    { fmt: 'pdf', label: t('exportPdf') },
    { fmt: 'xlsx', label: t('exportExcel') },
    { fmt: 'pptx', label: t('exportPpt') },
  ]
  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen((o) => !o)} disabled={!!busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{t('export')}
      </button>
      {open && (
        <>
          <button type="button" aria-hidden className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-40 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
            {opts.map((o) => (
              <button key={o.fmt} type="button" onClick={() => go(o.fmt)}
                className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700">{o.label}</button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
