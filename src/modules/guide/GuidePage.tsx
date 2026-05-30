import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle, CircleHelp, Smartphone, ChevronRight } from 'lucide-react'
import { useTour } from './useTour'
import type { TourDefinition } from './types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'
import InstallInstructions from './install/InstallInstructions'

const SECTION_ORDER: TourDefinition['section'][] = ['basics', 'member', 'coach', 'admin']

export default function GuidePage() {
  // 'guide' namespace for menu/section labels
  const { t } = useTranslation('guide')
  // No-namespace t for fully-qualified keys (e.g. "guide:tours.gettingStarted.title")
  const { t: tRaw } = useTranslation()
  const { t: tPwa } = useTranslation('pwa')
  const { availableTours, isTourCompleted, startTour, resetAllTours } = useTour()
  const [installOpen, setInstallOpen] = useState(false)

  const groupedTours = SECTION_ORDER.reduce<Record<TourDefinition['section'], TourDefinition[]>>(
    (acc, section) => {
      acc[section] = availableTours.filter((tour) => tour.section === section)
      return acc
    },
    { basics: [], member: [], coach: [], admin: [] },
  )

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <CircleHelp className="h-7 w-7 text-primary shrink-0" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('menu.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('menu.subtitle')}</p>
        </div>
      </div>

      {/* Install the app */}
      <button
        onClick={() => setInstallOpen(true)}
        className="w-full flex items-center gap-3 rounded-xl border border-border px-4 py-3.5 text-left hover:bg-muted/50 transition-colors min-h-[56px]"
      >
        <Smartphone className="h-5 w-5 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{tPwa('guide.cardTitle')}</p>
          <p className="text-xs text-muted-foreground truncate">{tPwa('guide.cardSubtitle')}</p>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
      </button>

      <Dialog open={installOpen} onOpenChange={setInstallOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tPwa('install.title')}</DialogTitle>
          </DialogHeader>
          <InstallInstructions onInstalled={() => setInstallOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Tour sections */}
      {SECTION_ORDER.map((section) => {
        const tours = groupedTours[section]
        if (tours.length === 0) return null

        return (
          <div key={section} className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
              {t(`sections.${section}`)}
            </p>

            <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
              {tours.map((tour) => {
                const completed = isTourCompleted(tour.id)
                const Icon = tour.icon

                return (
                  <button
                    key={tour.id}
                    onClick={() => startTour(tour.id)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/50 transition-colors min-h-[56px]"
                  >
                    <Icon className="h-5 w-5 text-muted-foreground shrink-0" />

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {tRaw(tour.titleKey)}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {tRaw(tour.descriptionKey)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">
                        {t('menu.steps', { count: tour.steps.length })}
                      </span>
                      {completed && (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Reset all button */}
      <div className="pt-2">
        <button
          onClick={resetAllTours}
          className="w-full rounded-lg border border-border px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          {t('menu.resetAll')}
        </button>
      </div>
    </div>
  )
}
