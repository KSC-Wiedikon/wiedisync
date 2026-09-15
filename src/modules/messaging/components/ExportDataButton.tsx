import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'
import { messagingApi } from '../api/messaging'

export default function ExportDataButton() {
  const { t } = useTranslation('messaging')
  const [busy, setBusy] = useState(false)

  const onClick = useCallback(async () => {
    setBusy(true)
    try {
      const bundle = await messagingApi.exportData()
      if (bundle.cached === true) {
        toast.info(t('settingsExportCached', { time: bundle.last_export_at ?? '' }))
        return
      }
      // Offer as download
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `kscw-messaging-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error(t('settingsExportError', 'Export fehlgeschlagen'))
    } finally { setBusy(false) }
  }, [t])

  return (
    <Button onClick={onClick} disabled={busy} variant="outline" size="sm">
      <Download className="h-4 w-4 mr-2" />
      {busy ? t('sending', 'Wird gesendet…') : t('settingsExportButton')}
    </Button>
  )
}
