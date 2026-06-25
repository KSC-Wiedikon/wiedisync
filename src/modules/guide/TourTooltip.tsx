import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { TooltipRenderProps } from 'react-joyride'
import { Button } from '../../components/ui/button'
import { useIsMobile } from '../../hooks/useMediaQuery'

export function TourTooltip({
  backProps,
  closeProps,
  primaryProps,
  skipProps,
  step,
  tooltipProps,
  index,
  size,
  isLastStep,
}: TooltipRenderProps) {
  const { t } = useTranslation('guide')
  const { t: tRaw } = useTranslation()
  const isMobile = useIsMobile()
  const progress = ((index + 1) / size) * 100

  // step.title and step.content are fully-qualified i18n keys (e.g. "guide:tours.*.steps.*.title")
  const title = step.title ? tRaw(step.title as string) : ''
  const body = step.content ? tRaw(step.content as string) : ''

  return (
    <div
      {...tooltipProps}
      className={`relative bg-background text-foreground shadow-xl overflow-hidden ${
        isMobile
          ? 'fixed bottom-0 left-0 right-0 w-full rounded-t-xl z-[10001]'
          : 'w-[340px] max-w-[calc(100vw-32px)] rounded-lg'
      }`}
      style={isMobile ? { position: 'fixed', bottom: 0, left: 0, right: 0, width: '100%' } : undefined}
    >
      {/* Progress bar */}
      <div className="h-[3px] w-full bg-muted">
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${progress}%`,
            background: 'linear-gradient(90deg, #4A55A2, #FFC832)',
          }}
        />
      </div>

      <div className={isMobile ? 'p-5 pb-8' : 'p-4'}>
        {/* Close button */}
        <button
          {...closeProps}
          aria-label={tRaw('common:close')}
          className={`absolute top-2 right-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors ${
            isMobile ? 'p-2 min-h-[44px] min-w-[44px] flex items-center justify-center' : 'p-1'
          }`}
        >
          <X className={isMobile ? 'h-5 w-5' : 'h-4 w-4'} />
        </button>

        {/* Step badge + counter + title */}
        <div className="flex items-start gap-3 mb-2 pr-10">
          <span className="flex-shrink-0 flex items-center justify-center w-[26px] h-[26px] rounded-full bg-primary text-primary-foreground text-xs font-semibold">
            {index + 1}
          </span>
          <div className="min-w-0">
            {title && (
              <h3 className={`font-semibold leading-tight ${isMobile ? 'text-lg' : 'text-base'}`}>
                {title}
              </h3>
            )}
            <span className="text-xs text-muted-foreground">
              {index + 1} {t('tooltip.stepOf')} {size}
            </span>
          </div>
        </div>

        {/* Body */}
        {body && (
          <p className={`text-muted-foreground mb-5 ml-[38px] ${isMobile ? 'text-base leading-relaxed' : 'text-sm'}`}>
            {body}
          </p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between ml-[38px]">
          <button
            {...skipProps}
            className={`text-primary hover:underline underline-offset-2 ${
              isMobile ? 'text-base min-h-[44px]' : 'text-sm'
            }`}
          >
            {t('tooltip.skip')}
          </button>

          <div className="flex items-center gap-2">
            {index > 0 && (
              <Button
                {...backProps}
                variant="secondary"
                size={isMobile ? 'default' : 'sm'}
                className={isMobile ? 'min-h-[44px] min-w-[44px]' : ''}
              >
                {t('tooltip.back')}
              </Button>
            )}
            <Button
              {...primaryProps}
              size={isMobile ? 'default' : 'sm'}
              className={isMobile ? 'min-h-[44px] min-w-[44px]' : ''}
            >
              {isLastStep ? t('tooltip.finish') : t('tooltip.next')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
