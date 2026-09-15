import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export default function MessagingDisabledBanner() {
  const { t } = useTranslation('messaging')
  return (
    <div className="rounded-md border border-border bg-muted p-4 text-sm text-foreground">
      <div className="font-medium mb-1">{t('disabledBannerTitle')}</div>
      <div className="text-muted-foreground mb-3">{t('disabledBannerBody')}</div>
      <Button asChild variant="outline" size="sm">
        <Link to="/profile">{t('disabledBannerCta')}</Link>
      </Button>
    </div>
  )
}
