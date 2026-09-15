import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ChevronRight } from 'lucide-react'
import { messagingFeatureEnabled } from '../../../utils/messagingFeatureFlag'
import { useAuth } from '../../../hooks/useAuth'

export default function MessagingSettingsCard() {
  const { t } = useTranslation('messaging')
  const { user } = useAuth()
  if (!messagingFeatureEnabled(user?.id)) return null
  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('settingsCardTitle')}</h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('settingsCardDescription')}</p>
      <div className="mt-3">
        <Button asChild variant="outline">
          <Link to="/options/messaging">
            {t('settingsOpenPage')}
            <ChevronRight className="h-4 w-4 ml-1" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
