import { useTranslation } from 'react-i18next'
import { Download, Share, Plus, MoreVertical, CheckCircle2 } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { usePlatform } from './usePlatform'
import { useInstallPrompt } from './useInstallPrompt'

function Step({ n, icon: Icon, children }: { n: number; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {n}
      </span>
      <span className="flex items-center gap-1.5 text-sm text-foreground">
        {children}
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      </span>
    </li>
  )
}

/** Platform-aware install help. Reused by the guide page and the banner sheet. */
export default function InstallInstructions({ onInstalled }: { onInstalled?: () => void }) {
  const { t } = useTranslation('pwa')
  const platform = usePlatform()
  const { canInstall, promptInstall } = useInstallPrompt(onInstalled)

  if (platform === 'standalone') {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-foreground">
        <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
        {t('install.alreadyInstalled')}
      </div>
    )
  }

  if (platform === 'android' || platform === 'desktop') {
    if (canInstall) {
      return (
        <div className="space-y-3">
          <Button className="w-full" onClick={() => { void promptInstall() }}>
            <Download className="mr-2 h-4 w-4" />
            {t('install.installButton')}
          </Button>
        </div>
      )
    }
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('install.androidFallback.intro')}</p>
        <ol className="space-y-2.5">
          <Step n={1} icon={MoreVertical}>{t('install.androidFallback.step1')}</Step>
          <Step n={2} icon={Plus}>{t('install.androidFallback.step2')}</Step>
          <Step n={3} icon={Download}>{t('install.androidFallback.step3')}</Step>
        </ol>
      </div>
    )
  }

  // iOS (safari or other)
  return (
    <div className="space-y-3">
      {platform === 'ios-other' && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {t('install.iosOther.notice')}
        </p>
      )}
      <p className="text-sm text-muted-foreground">{t('install.iosSafari.intro')}</p>
      <ol className="space-y-2.5">
        <Step n={1} icon={Share}>{t('install.iosSafari.step1')}</Step>
        <Step n={2} icon={Plus}>{t('install.iosSafari.step2')}</Step>
        <Step n={3} icon={CheckCircle2}>{t('install.iosSafari.step3')}</Step>
      </ol>
    </div>
  )
}
