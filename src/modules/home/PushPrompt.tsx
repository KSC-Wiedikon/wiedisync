import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BellRing } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { usePushNotifications } from '../../hooks/usePushNotifications'
import { isImpersonating } from '../../lib/api'
import { useInstallBanner } from '../guide/install/useInstallBanner'
import { readPushPromptDismissed, setPushPromptDismissed, shouldShowPushPrompt } from './pushPromptState'

/** Home card that offers push on this device, once. Self-gates via shouldShowPushPrompt. */
export default function PushPrompt() {
  const { t } = useTranslation('notifications')
  const push = usePushNotifications()
  const installBanner = useInstallBanner()
  const [dismissed, setDismissedState] = useState<boolean>(readPushPromptDismissed)

  const show = shouldShowPushPrompt({
    supported: push.supported,
    probing: push.probing,
    subscribed: push.subscribed,
    permission: push.permission,
    dismissed,
    installBannerShown: installBanner.shouldShow,
    impersonating: isImpersonating(),
  })
  if (!show) return null

  const notNow = () => {
    setPushPromptDismissed()
    setDismissedState(true)
  }

  const turnOn = async () => {
    // A failure toasts inside subscribe(); a refused permission hides the card
    // (permission becomes "denied"), so only success needs a word here.
    if (await push.subscribe()) toast.success(t('pushPromptDone'))
  }

  return (
    <div className="mb-4 rounded-2xl border border-hairline bg-card p-4 shadow-card">
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{t('pushPromptTitle')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('pushPromptBody')}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button onClick={() => void turnOn()} loading={push.loading}>
          {t('pushPromptEnable')}
        </Button>
        <Button variant="ghost" onClick={notNow} disabled={push.loading}>
          {t('pushPromptLater')}
        </Button>
      </div>
    </div>
  )
}
