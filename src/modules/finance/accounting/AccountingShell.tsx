import { useEffect, useState, type ComponentType } from 'react'
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ExternalLink, LogOut, Menu, Moon, Search, Sun } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import LanguageDropdown from '@/components/LanguageDropdown'
import IconButton from '@/components/IconButton'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAuth } from '../../../hooks/useAuth'
import { useTheme } from '../../../hooks/useTheme'
import { isAuthenticated, MEMBER_APP_ORIGIN } from '../../../lib/api'
import { handlePWAExternalClick } from '../../../utils/pwa'
import { useReportPageLoading } from '../../../hooks/usePageReady'
import { ACCOUNTING_GROUPS, MEMBER_APP_LINKS, pageForPath, pagesFor } from './nav'
import { useAccountingFy } from './fyContext'
import FyProvider from './FyProvider'
import SearchDialog from './SearchDialog'

/**
 * Shell of accounting.wiedisync.kscw.ch — the club's books for the treasurer, the
 * board and the auditors (Revisoren). Full window width: a grouped menu on the left
 * (a slide-in menu on phones), a search over every page and account (Ctrl/⌘ K), and
 * for each page a title, a one-line "what is this" and the fiscal-year picker.
 * All of it reads `./nav.ts`.
 */
export default function AccountingShell() {
  const { user, isLoading, canReadFinance } = useAuth()
  const booting = isLoading && isAuthenticated()
  useReportPageLoading(booting)
  // The app-level <BootOverlay/> shows the one boot spinner meanwhile.
  if (booting) return null
  if (!user) return <Navigate to="/login" replace />
  if (!canReadFinance) return <NoAccess />
  return (
    <FyProvider>
      <Shell />
    </FyProvider>
  )
}

function Shell() {
  const { t } = useTranslation('finance')
  const { t: tn } = useTranslation('nav')
  const { theme, toggleTheme } = useTheme()
  const { logout, isRevisor } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const page = pageForPath(pathname)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    document.title = page ? `${t(`accNav_${page.key}`)} · ${t('accountingTitle')} — KSC Wiedikon` : `${t('accountingTitle')} — KSC Wiedikon`
  }, [page, t])

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  const themeLabel = theme === 'dark' ? tn('switchToLight') : tn('switchToDark')

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-hairline bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="flex h-14 items-center gap-2 px-3 sm:px-4 lg:px-6">
          <IconButton onClick={() => setMenuOpen(true)} label={t('accMenu')} className="rounded-xl lg:hidden">
            <Menu />
          </IconButton>
          <NavLink to="/" className="flex shrink-0 items-center gap-2">
            <img src={theme === 'light' ? '/wiedisync_blau.png' : '/wiedisync_weiss.png'} alt="KSC Wiedikon" className="h-7 w-auto" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('accountingTitle')}</span>
          </NavLink>

          {/* Desktop: a wide, labelled search field — it is THE way to find a page. */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="ml-4 hidden h-9 w-full max-w-md items-center gap-2 rounded-xl border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate text-left" title={t('accSearchPlaceholder')}>{t('accSearchPlaceholder')}</span>
            <kbd className="hidden rounded border border-border px-1.5 text-[10px] font-medium lg:inline">Ctrl K</kbd>
          </button>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <IconButton onClick={() => setSearchOpen(true)} label={t('accSearchTitle')} className="rounded-xl md:hidden">
              <Search />
            </IconButton>
            <a
              href={MEMBER_APP_ORIGIN}
              onClick={(e) => handlePWAExternalClick(e, MEMBER_APP_ORIGIN)}
              className="hidden h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:flex"
            >
              <ExternalLink className="h-4 w-4" />
              <span className="whitespace-nowrap">Wiedisync</span>
            </a>
            <div className="hidden items-center gap-1 sm:flex">
              <LanguageDropdown />
              <IconButton onClick={toggleTheme} label={themeLabel} className="rounded-xl">
                {theme === 'dark' ? <Sun /> : <Moon />}
              </IconButton>
              <IconButton onClick={handleLogout} label={tn('logout')} className="rounded-xl">
                <LogOut />
              </IconButton>
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 overflow-y-auto border-r border-hairline bg-card/40 px-3 py-4 lg:block">
          <NavTree isRevisor={isRevisor} />
        </aside>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
          {page && <PageHeader pageKey={page.key} icon={page.icon} usesFiscalYear={!!page.usesFiscalYear} />}
          {isRevisor && (
            <p className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200">{t('bkReadOnlyBanner')}</p>
          )}
          <Outlet />
        </main>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-[85vw] max-w-xs gap-0 overflow-y-auto p-0">
          <SheetTitle className="sr-only">{t('accMenu')}</SheetTitle>
          <SheetDescription className="sr-only">{t('accMenuHint')}</SheetDescription>
          <div className="px-3 pb-6 pt-14">
            <NavTree isRevisor={isRevisor} onNavigate={() => setMenuOpen(false)} />
            <div className="mt-4 border-t border-border pt-3 sm:hidden">
              <div className="flex items-center gap-1 px-1">
                <LanguageDropdown />
                <IconButton onClick={toggleTheme} label={themeLabel} className="rounded-xl">
                  {theme === 'dark' ? <Sun /> : <Moon />}
                </IconButton>
                <Button type="button" variant="ghost" onClick={handleLogout} className="ml-auto gap-2 text-muted-foreground">
                  <LogOut className="h-4 w-4" />{tn('logout')}
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  )
}

/** The grouped page list — the sidebar on desktop, the slide-in menu on phones. */
function NavTree({ isRevisor, onNavigate }: { isRevisor: boolean; onNavigate?: () => void }) {
  const { t } = useTranslation('finance')
  const pages = pagesFor(isRevisor)
  const linkCls = ({ isActive }: { isActive: boolean }) => cn(
    'flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-9',
    isActive ? 'bg-selected text-selected-foreground' : 'text-foreground/80 hover:bg-accent hover:text-foreground',
  )
  return (
    <nav aria-label={t('accMenu')} className="space-y-4">
      {ACCOUNTING_GROUPS.map((g) => {
        const items = pages.filter((p) => p.group === g)
        if (items.length === 0) return null
        return (
          <div key={g}>
            <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t(`accGroup_${g}`)}</p>
            <div className="space-y-0.5">
              {items.map((p) => (
                <NavLink key={p.key} to={p.path} end={p.path === '/'} className={linkCls} onClick={onNavigate}>
                  <p.icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">{t(`accNav_${p.key}`)}</span>
                </NavLink>
              ))}
            </div>
          </div>
        )
      })}
      {!isRevisor && (
        <div>
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('accGroup_memberApp')}</p>
          <div className="space-y-0.5">
            {MEMBER_APP_LINKS.map((l) => {
              const href = `${MEMBER_APP_ORIGIN}${l.path}`
              return (
                <a key={l.key} href={href} onClick={(e) => handlePWAExternalClick(e, href)}
                  className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-sm font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground lg:min-h-9">
                  <l.icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">{t(`accLink_${l.key}`)}</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </a>
              )
            })}
          </div>
        </div>
      )}
    </nav>
  )
}

/** Title, one-line explanation and — where the page depends on it — the fiscal year. */
function PageHeader({ pageKey, icon: Icon, usesFiscalYear }: { pageKey: string; icon: ComponentType<{ className?: string }>; usesFiscalYear: boolean }) {
  const { t } = useTranslation('finance')
  const { years, fyId, setFyId } = useAccountingFy()
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-muted-foreground sm:flex">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{t(`accNav_${pageKey}`)}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t(`accNavDesc_${pageKey}`)}</p>
        </div>
      </div>
      {usesFiscalYear && years.length > 0 && (
        <label className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          <span className="whitespace-nowrap">{t('fiscalYear')}</span>
          <select
            value={fyId}
            onChange={(e) => setFyId(e.target.value)}
            className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-card px-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-gray-800 sm:h-9 sm:flex-none"
          >
            {years.map((fy) => <option key={fy.id} value={fy.id}>{fy.label}</option>)}
          </select>
        </label>
      )}
    </div>
  )
}

function NoAccess() {
  const { theme } = useTheme()
  const { t } = useTranslation('finance')
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <img src={theme === 'light' ? '/wiedisync_blau.png' : '/wiedisync_weiss.png'} alt="KSC Wiedikon" className="mx-auto mb-6 h-14 w-auto" />
        <h1 className="text-xl font-bold tracking-tight text-foreground">{t('accountingNoAccessTitle')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('accountingNoAccess')}</p>
        <a href={MEMBER_APP_ORIGIN} className="mt-4 inline-block text-sm font-medium text-primary underline dark:text-brand-300">{MEMBER_APP_ORIGIN.replace(/^https?:\/\//, '')}</a>
      </div>
    </div>
  )
}
