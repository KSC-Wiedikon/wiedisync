import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { updateRecord } from '../../lib/api'
import { formatFineAmount } from '../../hooks/useFines'
import type { Fine } from '../../types'

interface WaiveFineModalProps {
  open: boolean
  onClose: () => void
  fine: Fine
  onSuccess?: () => void
}

export default function WaiveFineModal({ open, onClose, fine, onSuccess }: WaiveFineModalProps) {
  const { t } = useTranslation(['fines', 'common'])
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = reason.trim()
    if (!trimmed) {
      setError(t('fines:waiveReasonRequired'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await updateRecord<Fine>('fines', fine.id, {
        status: 'waived',
        waived_at: new Date().toISOString(),
        waived_reason: trimmed,
      })
      onSuccess?.()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('fines:waiveTitle')}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-xl border border-hairline bg-surface-sunken px-3 py-2 text-sm tabular-nums text-foreground/85">
          {formatFineAmount(fine.amount, fine.currency)}
          {fine.reason ? ` — ${fine.reason}` : ''}
        </div>

        <label className="block text-xs font-medium text-muted-foreground">
          {t('fines:waiveReasonLabel')}
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            required
            className="mt-1 w-full leading-relaxed rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 dark:bg-input/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            {t('common:cancel')}
          </Button>
          <Button type="submit" size="sm" variant="destructive" disabled={submitting}>
            {submitting ? t('common:loading') : t('fines:waiveSubmit')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
