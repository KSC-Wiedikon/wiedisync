import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { messagingApi } from '../api/messaging'
import type { MessageRow } from '../api/types'

type Props = {
  message: MessageRow
  onClose: () => void
  onSubmitted?: () => void
}

const REASONS = ['harassment', 'spam', 'inappropriate', 'other'] as const

export default function ReportMessageDialog({ message, onClose, onSubmitted }: Props) {
  const { t } = useTranslation('messaging')
  const [reason, setReason] = useState<(typeof REASONS)[number]>('spam')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      await messagingApi.createReport({
        reported_member: String(message.sender),
        message: message.id,
        conversation: message.conversation,
        reason,
        note: note.trim() || undefined,
      })
      onSubmitted?.()
      onClose()
    } catch {
      // toast later
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-foreground">{t('reportDialogTitle')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t('reportDialogHint')}</p>

        <label className="mt-4 block text-xs font-medium text-foreground">{t('reportReason')}</label>
        <select
          className="mt-1 w-full rounded-md border border-input bg-background text-foreground text-sm p-2 dark:bg-gray-800"
          value={reason}
          onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])}
        >
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {t(`reportReason_${r}`)}
            </option>
          ))}
        </select>

        <label className="mt-3 block text-xs font-medium text-foreground">
          {t('reportNoteOptional')} <span className="text-muted-foreground">(max. 500)</span>
        </label>
        <textarea
          rows={3}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 w-full rounded-md border border-input bg-background text-foreground text-sm p-2 focus:outline-none focus:ring-2 focus:ring-ring"
        />

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy ? t('sending') : t('reportSubmit')}
          </Button>
        </div>
      </div>
    </div>
  )
}
