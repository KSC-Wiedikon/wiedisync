import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../hooks/useAuth'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import { kscwApi } from '../../lib/api'

interface DeleteAccountModalProps {
  open: boolean
  onClose: () => void
  userEmail: string
}

export default function DeleteAccountModal({ open, onClose, userEmail }: DeleteAccountModalProps) {
  const { t } = useTranslation('auth')
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [confirmEmail, setConfirmEmail] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset the form when the modal closes (it is not remounted per open). Done
  // during render via React's adjust-state-during-render pattern — same trigger
  // (`open` changed), same result, no cascading effect render.
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (!open) {
      setConfirmEmail('')
      setError(null)
      setIsDeleting(false)
    }
  }

  const canConfirm = confirmEmail.trim() === userEmail

  async function handleDelete() {
    if (!user || !canConfirm) return
    setIsDeleting(true)
    setError(null)
    try {
      await kscwApi('/delete-account', { method: 'POST', body: { member_id: user.id } })
      logout()
      navigate('/', { replace: true })
    } catch {
      setError(t('deleteAccountError'))
      setIsDeleting(false)
    }
  }

  return (
    <Modal open={open} onClose={isDeleting ? () => {} : onClose} title={t('dangerZone')} size="sm">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('deleteAccountDescription')}</p>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            {t('deleteAccountEmailPrompt')}
          </label>
          <input
            type="email"
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            placeholder={t('deleteAccountEmailPlaceholder')}
            disabled={isDeleting}
            className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:border-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:opacity-50 dark:bg-input/20 sm:h-9"
          />
        </div>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">{error}</p>
        )}

        <div className="flex gap-3 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isDeleting}
            className="flex-1"
          >
            {t('common:cancel')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={!canConfirm || isDeleting}
            className="flex-1"
          >
            {isDeleting ? '...' : t('deleteAccountConfirm')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
