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
        <div className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:bg-gray-800/60 dark:text-gray-300">
          {formatFineAmount(fine.amount, fine.currency)}
          {fine.reason ? ` — ${fine.reason}` : ''}
        </div>

        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('fines:waiveReasonLabel')}
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            required
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
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
