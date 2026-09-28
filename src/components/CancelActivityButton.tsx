import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Ban, RotateCcw } from 'lucide-react'
import Modal from '@/components/Modal'
import { useAuth } from '../hooks/useAuth'
import { useTeamPermissions } from '../hooks/useTeamPermissions'
import { useAdminMode } from '../hooks/useAdminMode'
import { useMutation } from '../hooks/useMutation'
import IconButton from './IconButton'
import { Button } from '@/components/ui/button'

type ActivityKind = 'training' | 'event' | 'game'

interface CancelActivityButtonProps {
  kind: ActivityKind
  activityId: string
  isCancelled: boolean
  /** Teams the activity belongs to. Empty array = club-wide (admin only). */
  teamIds: string[]
  /** 'icon' = card action bar; 'inline' = labelled button for modal headers. */
  variant?: 'icon' | 'inline'
  /** Called after a successful patch so the parent can refetch or close. */
  onDone?: () => void
}

const COLLECTION: Record<ActivityKind, string> = {
  training: 'trainings',
  event: 'events',
  game: 'games',
}

// Per-kind i18n keys — keeps the label/confirm wiring flat instead of nesting
// ternaries over (isCancelled × kind). The reinstate *action* label is shared
// across kinds, so only reinstate confirmations vary here.
const CANCEL_KEYS: Record<ActivityKind, { action: string; confirm: string; reinstateConfirm: string }> = {
  training: { action: 'cancelTrainingAction', confirm: 'cancelTrainingConfirm', reinstateConfirm: 'reinstateTrainingConfirm' },
  event: { action: 'cancelEventAction', confirm: 'cancelEventConfirm', reinstateConfirm: 'reinstateEventConfirm' },
  game: { action: 'cancelGameAction', confirm: 'cancelGameConfirm', reinstateConfirm: 'reinstateGameConfirm' },
}

export default function CancelActivityButton({
  kind,
  activityId,
  isCancelled,
  teamIds,
  variant = 'icon',
  onDone,
}: CancelActivityButtonProps) {
  const { t } = useTranslation('common')
  const { teamResponsibleIds } = useAuth()
  const { canManageTeam } = useTeamPermissions()
  const { effectiveIsAdmin } = useAdminMode()
  const { update, isLoading } = useMutation(COLLECTION[kind])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  const canManage =
    effectiveIsAdmin ||
    teamIds.some((id) => canManageTeam(id) || teamResponsibleIds.includes(id))
  if (!canManage) return null

  const keys = CANCEL_KEYS[kind]
  const actionLabel = isCancelled ? t('reinstateAction') : t(keys.action)
  const confirmText = isCancelled ? t(keys.reinstateConfirm) : t(keys.confirm)

  async function handleConfirm() {
    setError('')
    try {
      if (isCancelled) {
        await update(
          activityId,
          kind === 'game'
            ? { status: 'scheduled' }
            : { cancelled: false, cancel_reason: '' },
        )
      } else {
        await update(
          activityId,
          kind === 'game'
            ? { status: 'cancelled' }
            : { cancelled: true, cancel_reason: reason.trim() },
        )
      }
      setDialogOpen(false)
      setReason('')
      onDone?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      {variant === 'icon' ? (
        <IconButton
          label={actionLabel}
          onClick={(e) => {
            e.stopPropagation()
            setDialogOpen(true)
          }}
          className={
            isCancelled
              ? 'text-muted-foreground'
              : 'text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400'
          }
        >
          {isCancelled ? <RotateCcw /> : <Ban />}
        </IconButton>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation()
            setDialogOpen(true)
          }}
          className={
            isCancelled
              ? undefined
              : 'border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20'
          }
        >
          {isCancelled ? <RotateCcw aria-hidden /> : <Ban aria-hidden />}
          {actionLabel}
        </Button>
      )}

      <Modal open={dialogOpen} onClose={() => setDialogOpen(false)} title={actionLabel} size="sm">
        <div className="space-y-4" onClick={(e) => e.stopPropagation()}>
          <p className="text-sm text-foreground/85">{confirmText}</p>

          {!isCancelled && kind !== 'game' && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground/85">
                {t('cancelReasonLabel')}
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('cancelReasonPlaceholder')}
                rows={2}
                className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/20"
              />
            </div>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={isLoading}>
              {t('keepBtn')}
            </Button>
            <Button
              type="button"
              variant={isCancelled ? 'default' : 'destructive'}
              onClick={handleConfirm}
              loading={isLoading}
            >
              {isCancelled ? t('reinstateConfirmBtn') : t('cancelConfirmBtn')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
