import { useTranslation } from 'react-i18next'
import { Inbox } from 'lucide-react'

export default function InboxEmptyState() {
  const { t } = useTranslation('messaging')
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <Inbox className="h-10 w-10 text-muted-foreground/70 mb-3" />
      <h3 className="text-sm font-semibold text-foreground">{t('inboxEmptyTitle')}</h3>
      <p className="mt-1 text-sm text-muted-foreground max-w-sm">{t('inboxEmptyBody')}</p>
    </div>
  )
}
