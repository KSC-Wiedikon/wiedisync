import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookOpen, CircleHelp, Loader2, TriangleAlert } from 'lucide-react'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import IconButton from '../../components/IconButton'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '../../components/ui/sheet'
import { GuideBody } from './GuideBlocks'
import { sectionForPath } from './sections'
import { useGuideContent } from './useGuideContent'
import type { GuideSectionContent } from './types'

/**
 * The standalone scheduling build (VITE_APP_TARGET=scheduling, its own
 * CF Pages project) has no /guide route, so its help panel links to the guide
 * on the member app instead. Both prod hosts are pinned in lib/api.ts; the
 * dev scheduling host maps to the dev member preview.
 */
function guideHref(sectionId: string): string {
  const path = `/guide#${sectionId}`
  if (import.meta.env.VITE_APP_TARGET !== 'scheduling') return path
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  const origin = host === 'spielplanung.wiedisync.kscw.ch'
    ? 'https://wiedisync.kscw.ch'
    : 'https://dev.kscw-wiedisync.pages.dev'
  return origin + path
}

/**
 * The "?" next to a page title. Opens the section of the written guide that
 * explains the current page in a slide-over, so the reader keeps the page
 * underneath; the panel links on to the full guide. When no section claims
 * the route it is a plain link to the guide. Replaced the tour launcher on
 * 2026-09-15.
 */
export function GuideHelpButton() {
  const { t } = useTranslation('guide')
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const section = sectionForPath(pathname)
  // Icon-button scale: 44 px touch on phones, 36 px from sm (see /kscw-ui).
  const cls = 'shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground'

  if (!section) {
    return (
      <Button asChild variant="ghost" size="icon" className={cls}>
        <Link to="/guide" aria-label={t('page.helpButton')} title={t('page.helpButton')}>
          <CircleHelp className="!size-5" />
        </Link>
      </Button>
    )
  }

  return (
    <>
      <IconButton
        type="button"
        label={t('page.helpButton')}
        onClick={() => setOpen(true)}
        className={cls}
      >
        <CircleHelp className="!size-5" />
      </IconButton>
      {/* The Sheet stays mounted so Radix can play its close animation; the
          body — and with it the content chunk fetch — mounts only while open. */}
      <HelpSheet open={open} onOpenChange={setOpen} sectionId={section.id} audience={section.audience} />
    </>
  )
}

function HelpSheet({ open, onOpenChange, sectionId, audience }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sectionId: string
  audience: string
}) {
  const isMobile = useIsMobile()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={isMobile ? 'max-h-[85vh] overflow-y-auto rounded-t-2xl' : 'w-full overflow-y-auto sm:max-w-lg'}
      >
        {open && <HelpPanelBody sectionId={sectionId} audience={audience} onClose={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function HelpPanelBody({ sectionId, audience, onClose }: {
  sectionId: string
  audience: string
  onClose: () => void
}) {
  const { t } = useTranslation('guide')
  const { content, loading, error } = useGuideContent()
  const c = (content?.[sectionId] ?? null) as GuideSectionContent | null
  const href = guideHref(sectionId)
  const external = href.startsWith('http')

  return (
    <>
      <SheetHeader className="text-left">
        <div className="flex flex-wrap items-center gap-2">
          <SheetTitle>{c ? c.title : t('page.title')}</SheetTitle>
          {audience !== 'everyone' && (
            <Badge variant="secondary" className="text-[10px] font-medium">{t(`page.audience.${audience}`)}</Badge>
          )}
        </div>
        <SheetDescription>{c ? c.summary : t('page.subtitle')}</SheetDescription>
      </SheetHeader>
      <div className="mt-4 space-y-3 text-sm text-foreground">
        {loading && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('page.loading')}
          </p>
        )}
        {error && !c && (
          <p className="flex items-start gap-2 text-amber-900 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {t('page.loadError')}
          </p>
        )}
        {c && <GuideBody body={c.body} />}
      </div>
      <div className="mt-6 border-t border-border pt-4">
        {external ? (
          <Button asChild variant="outline">
            <a href={href}>
              <BookOpen />
              {t('page.openGuide')}
            </a>
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link to={href} onClick={onClose}>
              <BookOpen />
              {t('page.openGuide')}
            </Link>
          </Button>
        )}
      </div>
    </>
  )
}
