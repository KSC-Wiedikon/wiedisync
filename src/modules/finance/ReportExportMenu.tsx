import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { exportReport, type FinanceReport, type ExportFormat } from './reportExport'

/** Dropdown that exports a finance report (built lazily on click) to PDF / Excel / PowerPoint. */
export default function ReportExportMenu({ build, filename }: { build: () => FinanceReport; filename: string }) {
  const { t } = useTranslation('finance')
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const [open, setOpen] = useState(false)

  async function go(fmt: ExportFormat) {
    setOpen(false); setBusy(fmt)
    try { await exportReport(fmt, build(), filename) } catch (e) { toast.error((e as Error)?.message || t('exportError')) } finally { setBusy(null) }
  }
  const opts: { fmt: ExportFormat; label: string }[] = [
    { fmt: 'pdf', label: t('exportPdf') },
    { fmt: 'xlsx', label: t('exportExcel') },
    { fmt: 'pptx', label: t('exportPpt') },
  ]
  return (
    <div className="relative inline-block">
      <Button type="button" variant="outline" onClick={() => setOpen((o) => !o)} disabled={!!busy} aria-expanded={open} aria-haspopup="menu">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{t('export')}
      </Button>
      {open && (
        <>
          <button type="button" aria-hidden className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute right-0 z-20 mt-1 w-40 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl">
            {opts.map((o) => (
              <button key={o.fmt} type="button" role="menuitem" onClick={() => go(o.fmt)}
                className="flex min-h-10 w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent sm:min-h-8">{o.label}</button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
