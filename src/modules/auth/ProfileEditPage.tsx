import { Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useReportPageLoading } from '../../hooks/usePageReady'
import ProfileEditForm from './ProfileEditForm'
import IdentityDocumentSection from './IdentityDocumentSection'

/**
 * Standalone `/profile/edit` subpage — the regular "Edit profile" flow, moved
 * off a modal onto its own route so the (long) form gets full-height scrolling
 * and a shareable/back-navigable URL. The onboarding flow still uses
 * {@link ProfileEditModal} (Layout gate + PendingPage). Both render the same
 * {@link ProfileEditForm}.
 */
export default function ProfileEditPage() {
  const { user } = useAuth()
  const { t } = useTranslation('auth')
  const { t: tc } = useTranslation('common')
  const navigate = useNavigate()

  // Nothing async to await here — the member is already loaded by AuthProvider.
  useReportPageLoading(false)

  if (!user) return <Navigate to="/login" replace />

  const goBack = () => navigate('/profile')

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={goBack}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          aria-label={tc('back')}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('editProfile')}</h1>
      </div>

      <ProfileEditForm onSaved={goBack} onCancel={goBack} />

      {/* Identity document (E2EE) — lives with the other "change my data" actions
          rather than on the read-only profile view (moved 2026-07-28). */}
      <IdentityDocumentSection />
    </div>
  )
}
