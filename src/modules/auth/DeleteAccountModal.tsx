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
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('deleteAccountDescription')}</p>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('deleteAccountEmailPrompt')}
          </label>
          <input
            type="email"
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            placeholder={t('deleteAccountEmailPlaceholder')}
            disabled={isDeleting}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-500"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
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
