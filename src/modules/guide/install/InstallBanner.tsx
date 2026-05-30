import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
  DrawerClose,
} from '../../../components/ui/drawer'
import { useInstallBanner } from './useInstallBanner'
import InstallInstructions from './InstallInstructions'

/** Mobile-only home-screen install banner. Self-gates via useInstallBanner. */
export default function InstallBanner() {
  const { t } = useTranslation('pwa')
  const { shouldShow, understood, remindLater, markInstalled } = useInstallBanner()
  const [sheetOpen, setSheetOpen] = useState(false)

  if (!shouldShow) return null

  return (
    <>
      <div className="mb-4 rounded-xl border border-border bg-muted/40 p-4">
        <div className="flex items-start gap-3">
          <Download className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{t('banner.title')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('banner.body')}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Button size="sm" className="min-h-[44px] sm:min-h-9" onClick={() => setSheetOpen(true)}>
            {t('banner.showHow')}
          </Button>
          <Button size="sm" variant="ghost" className="min-h-[44px] sm:min-h-9" onClick={remindLater}>
            {t('banner.remindLater')}
          </Button>
          <Button size="sm" variant="ghost" className="min-h-[44px] sm:min-h-9" onClick={understood}>
            {t('banner.understood')}
          </Button>
        </div>
      </div>

      <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{t('install.title')}</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-2">
            <InstallInstructions onInstalled={() => { markInstalled(); setSheetOpen(false) }} />
          </div>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="outline" className="w-full">{t('banner.understood')}</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  )
}
