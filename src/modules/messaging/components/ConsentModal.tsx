import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useMessagingConsent } from '../hooks/useMessagingConsent'

export default function ConsentModal() {
  const { t } = useTranslation('messaging')
  const { shouldShowModal, accept, decline, later, busy } = useMessagingConsent()

  if (!shouldShowModal) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg">
        <h3 className="text-base font-semibold text-foreground">{t('consentModalTitle')}</h3>
        <p className="mt-3 text-sm text-muted-foreground">{t('consentModalBody1')}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('consentModalBody2')}{' '}
          <Link to="/datenschutz#nachrichten" className="underline hover:text-foreground">
            Datenschutz
          </Link>
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={later} disabled={busy}>{t('consentLater')}</Button>
          <Button variant="outline" onClick={decline} disabled={busy}>{t('consentDecline')}</Button>
          <Button onClick={accept} disabled={busy}>{t('consentAccept')}</Button>
        </div>
      </div>
    </div>
  )
}
