import { useTranslation } from 'react-i18next'
import Modal from '@/components/Modal'
import ProfileEditForm from './ProfileEditForm'

interface ProfileEditModalProps {
  open: boolean
  onClose: () => void
  onboarding?: boolean
  /** Annual pre-licence data check — full form + banner, stamps `profile_verified_at` on save. */
  verify?: boolean
  /** false = hard gate: no X, Escape dead, no "Skip for now" — saving is the only exit. */
  dismissable?: boolean
}

/**
 * Modal wrapper around {@link ProfileEditForm}. Retained for the onboarding
 * call-sites (Layout's forced "complete your profile" gate + PendingPage), which
 * need the form as a non-dismissable / dismissable overlay. The regular profile
 * "edit" flow is a standalone subpage (`/profile/edit`) that renders the same
 * form directly — see ProfileEditPage.
 */
export default function ProfileEditModal({ open, onClose, onboarding, verify, dismissable = true }: ProfileEditModalProps) {
  const { t } = useTranslation('auth')
  return (
    <Modal
      open={open}
      onClose={dismissable ? onClose : () => {}}
      title={onboarding ? t('onboardingTitle') : verify ? t('verifyTitle') : t('editProfile')}
      size="lg"
      hideClose={!dismissable}
    >
      <ProfileEditForm
        onboarding={onboarding}
        verify={verify}
        onSaved={onClose}
        onCancel={dismissable ? onClose : undefined}
      />
    </Modal>
  )
}
