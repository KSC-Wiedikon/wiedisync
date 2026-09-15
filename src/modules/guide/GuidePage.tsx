import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowRight, ArrowUp, ChevronDown, ChevronRight, CircleHelp, Link as LinkIcon,
  Search, Smartphone, TriangleAlert, X,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useReportPageLoading } from '../../hooks/usePageReady'
import { useGuideContent } from './useGuideContent'
import { badgeVariants } from '../../components/ui/badge'
import { Input } from '../../components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../../components/ui/dialog'
import InstallInstructions from './install/InstallInstructions'
import GuideStart from './GuideStart'
import { GuideBody } from './GuideBlocks'
import { countMatches, sectionText } from './guideText'
import { GUIDE_GROUPS, guideSections } from './sections'
import type { GuideSectionContent, GuideSectionDef } from './types'

/**
 * The written user guide (Options → Guide, the "?" on every page, /guide#<id>).
 *
 * Sections come from `sections.ts` (metadata) + the `guide` i18n namespace
 * (content). Everything is on one page so the browser's find-in-page and the
 * search box both work; sections are collapsed until opened, and a hash in the
 * URL (`/guide#games`) opens and scrolls to that section — that is what the
 * per-page help button links to.
 */
export default function GuidePage() {
  const { t } = useTranslation('guide')
  const { t: tPwa } = useTranslation('pwa')
  const auth = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [installOpen, setInstallOpen] = useState(false)

  // The section text (~170 KB per language) is loaded on demand, not at boot.
  const { content: contentByLang, loading, error } = useGuideContent()
  useReportPageLoading(loading)

  // Sections this reader may see, with their translated content attached.
  const sections = useMemo(() => {
    if (!contentByLang) return []
    return guideSections
      .filter((s) => s.canAccess(auth))
      .map((s) => ({ def: s, content: contentByLang[s.id] as GuideSectionContent | undefined }))
      // A section whose content is missing in this locale renders nothing rather
      // than a raw key — the unit test guards completeness, this guards prod.
      .filter((s): s is { def: GuideSectionDef; content: GuideSectionContent } =>
        !!s.content && Array.isArray(s.content.body))
  }, [auth, contentByLang])

  const q = query.trim().toLowerCase()
  const matchLabel = (n: number) => (n === 1 ? t('page.matchOne') : t('page.matchMany', { count: n }))
  const visible = useMemo(() => {
    if (!q) return sections
    return sections.filter(({ content }) => sectionText(content).includes(q))
  }, [sections, q])

  // Deep link: /guide#games is an open section — derived from the URL, not
  // copied into state, so the effect below only has to scroll.
  const hashId = location.hash.replace(/^#/, '')
  const isOpen = useCallback(
    (id: string) => !!q || open.has(id) || id === hashId,
    [q, open, hashId],
  )

  const toggle = useCallback((id: string) => {
    if (id === hashId) {
      // Closing the deep-linked section: drop the hash, or it would stay open.
      navigate({ hash: '' }, { replace: true })
      setOpen((prev) => { const next = new Set(prev); next.delete(id); return next })
      return
    }
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [hashId, navigate])

  // Scroll to the deep-linked section once it has rendered open — which, on a
  // cold cache, is only after the content chunk has arrived.
  useEffect(() => {
    if (loading || !hashId || !guideSections.some((s) => s.id === hashId)) return
    const raf = requestAnimationFrame(() => {
      document.getElementById(`guide-${hashId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => cancelAnimationFrame(raf)
  }, [hashId, loading])

  const copyLink = (id: string) => {
    jumpTo(id)
    const url = `${window.location.origin}/guide#${id}`
    navigator.clipboard?.writeText(url).then(() => toast.success(t('page.linkCopied'))).catch(() => {})
  }

  const jumpTo = (id: string) => {
    if (hashId === id) {
      // Same hash twice: the effect will not re-run, so scroll by hand.
      document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      navigate({ hash: `#${id}` }, { replace: true })
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <CircleHelp className="h-7 w-7 text-primary shrink-0" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('page.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('page.subtitle')}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('page.searchPlaceholder')}
          aria-label={t('page.searchPlaceholder')}
          className="pl-9 pr-9 h-11 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:appearance-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label={t('page.clearSearch')}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-2.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{t('page.loadError')}</p>
        </div>
      )}

      {/* Who you are + a live getting-started checklist. */}
      {!q && <GuideStart onInstall={() => setInstallOpen(true)} />}

      {/* Install the app — kept from the old page; it is the one interactive help item. */}
      {!q && (
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
      )}
      <Dialog open={installOpen} onOpenChange={setInstallOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tPwa('install.title')}</DialogTitle>
          </DialogHeader>
          <InstallInstructions onInstalled={() => setInstallOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Table of contents */}
      {!q && (
        <nav aria-label={t('page.contents')} className="rounded-xl border border-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            {t('page.contents')}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {GUIDE_GROUPS.map((group) => {
              const items = sections.filter((s) => s.def.group === group)
              if (items.length === 0) return null
              return (
                <div key={group}>
                  <p className="text-sm font-semibold text-foreground mb-1.5">{t(`page.groups.${group}`)}</p>
                  <ul className="space-y-0.5">
                    {items.map(({ def, content }) => (
                      <li key={def.id}>
                        <button
                          type="button"
                          onClick={() => jumpTo(def.id)}
                          className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm text-foreground hover:bg-muted/60 min-h-[44px] sm:min-h-[36px]"
                        >
                          <def.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="flex-1">{content.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </nav>
      )}

      {/* Sections */}
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground px-1">{t('page.noResults', { query })}</p>
      ) : (
        GUIDE_GROUPS.map((group) => {
          const items = visible.filter((s) => s.def.group === group)
          if (items.length === 0) return null
          return (
            <div key={group} className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
                {t(`page.groups.${group}`)}
              </p>
              <div className="rounded-xl border border-border divide-y divide-border">
                {items.map(({ def, content }) => (
                  <GuideSection
                    key={def.id}
                    def={def}
                    content={content}
                    open={isOpen(def.id)}
                    query={q}
                    matches={q ? countMatches(content, q) : 0}
                    onToggle={() => toggle(def.id)}
                    onCopyLink={() => copyLink(def.id)}
                    labels={{
                      audience: t(`page.audience.${def.audience}`),
                      copyLink: t('page.openSection'),
                      openPage: t('page.openPage'),
                      matches: matchLabel(q ? countMatches(content, q) : 0),
                    }}
                  />
                ))}
              </div>
            </div>
          )
        })
      )}

      {/* Back to top */}
      <div className="pt-2 flex justify-center">
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <ArrowUp className="h-4 w-4" />
          {t('page.backToTop')}
        </button>
      </div>
    </div>
  )
}

function GuideSection({
  def, content, open, query, matches, onToggle, onCopyLink, labels,
}: {
  def: GuideSectionDef
  content: GuideSectionContent
  open: boolean
  query: string
  matches: number
  onToggle: () => void
  onCopyLink: () => void
  labels: { audience: string; copyLink: string; openPage: string; matches: string }
}) {
  const Icon = def.icon
  return (
    <article id={`guide-${def.id}`} className="scroll-mt-20">
      {/* Accordion pattern: the heading wraps the disclosure button, and the
          button holds only phrasing content (spans), so heading navigation and
          the expanded state both read correctly. */}
      <h2 className="m-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`guide-${def.id}-body`}
          className="w-full flex items-start gap-3 px-4 py-3.5 text-left hover:bg-muted/50 transition-colors min-h-[56px]"
        >
          <Icon className="mt-0.5 h-5 w-5 text-muted-foreground shrink-0" />
          <span className="flex-1 min-w-0 block">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{content.title}</span>
              {def.audience !== 'everyone' && (
                <span className={badgeVariants({ variant: 'secondary' }) + ' text-[10px] font-medium'}>{labels.audience}</span>
              )}
              {matches > 0 && (
                <span className={badgeVariants({ variant: 'outline' }) + ' text-[10px] font-medium'}>{labels.matches}</span>
              )}
            </span>
            <span className="block text-xs font-normal text-muted-foreground mt-0.5">{content.summary}</span>
          </span>
          {open
            ? <ChevronDown className="h-5 w-5 text-muted-foreground shrink-0" />
            : <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />}
        </button>
      </h2>
      {open && (
        <div id={`guide-${def.id}-body`} className="px-4 pb-5 pl-12 space-y-3 text-sm text-foreground">
          <GuideBody body={content.body} query={query || undefined} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
            {def.open && (
              <Link
                to={def.open}
                className="inline-flex min-h-[44px] sm:min-h-[36px] items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted/60"
              >
                {labels.openPage}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
            <button
              type="button"
              onClick={onCopyLink}
              className="inline-flex min-h-[44px] sm:min-h-0 items-center gap-1.5 px-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <LinkIcon className="h-3.5 w-3.5" />
              {labels.copyLink}
            </button>
          </div>
        </div>
      )}
    </article>
  )
}
