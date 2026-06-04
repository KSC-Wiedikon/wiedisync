import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth'
import { useAdminMode } from '../hooks/useAdminMode'
import SwitchToggle from '@/components/SwitchToggle'
import { Eye, EyeOff, Shield, ShieldCheck } from 'lucide-react'

interface AdminToggleProps {
  size?: 'sm' | 'md'
  onAfterToggle?: () => void
}

export default function AdminToggle({ size = 'sm', onAfterToggle }: AdminToggleProps) {
  const { isAdmin } = useAuth()
  const { isAdminMode, toggleAdminMode, hasElevatedAccess } = useAdminMode()
  const { t } = useTranslation('nav')

  if (!hasElevatedAccess) return null

  // Pure data-scope toggle — flips the lens (own teams vs club-wide) and nothing
  // else. The navbar stays complete in both modes, so there's no reason to
  // navigate away when switching to member mode; you can preview member view in
  // place. onAfterToggle lets the mobile MoreSheet close itself after the flip.
  const handleToggle = () => {
    toggleAdminMode()
    onAfterToggle?.()
  }

  const iconOff = isAdmin ? <Shield /> : <EyeOff />
  const iconOn = isAdmin ? <ShieldCheck /> : <Eye />
  const label = isAdminMode ? t('memberMode') : (isAdmin ? t('adminMode') : t('vorstandMode'))

  return (
    <SwitchToggle
      enabled={isAdminMode}
      onChange={handleToggle}
      size={size}
      ariaLabel={label}
      iconOff={iconOff}
      iconOn={iconOn}
    />
  )
}
