import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import { isAuthenticated } from '../lib/api'
import LanguageDropdown from '@/components/LanguageDropdown'
import IconButton from '@/components/IconButton'
import { ExternalLink, LogOut, Moon, Sun } from 'lucide-react'

const WIEDISYNC_URL = 'https://wiedisync.kscw.ch'

/**
 * Shell of accounting.wiedisync.kscw.ch — the club's books for the treasurer, the
 * board and the auditors (Revisoren). Logo, the section label, language, dark mode,
 * logout and a way back to the member app. The finance page brings its own tabs.
 */
export default function AccountingLayout() {
  const { user, isLoading, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { t } = useTranslation('nav')
  const { t: tf } = useTranslation('finance')
  const navigate = useNavigate()

  // The app-level <BootOverlay/> shows the one boot spinner meanwhile.
  if (isLoading && isAuthenticated()) return null

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-hairline bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <NavLink to="/" className="flex shrink-0 items-center gap-2">
            <img src={theme === 'light' ? '/wiedisync_blau.png' : '/wiedisync_weiss.png'} alt="KSC Wiedikon" className="h-7 w-auto" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{tf('accountingTitle')}</span>
          </NavLink>
          <a
            href={WIEDISYNC_URL}
            className="ml-auto hidden h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:flex"
          >
            <ExternalLink className="h-4 w-4" />
            <span className="whitespace-nowrap">Wiedisync</span>
          </a>
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:ml-0">
            <LanguageDropdown />
            <IconButton onClick={toggleTheme} label={theme === 'dark' ? t('switchToLight') : t('switchToDark')} className="rounded-xl">
              {theme === 'dark' ? <Sun /> : <Moon />}
            </IconButton>
            {user && (
              <IconButton onClick={handleLogout} label={t('logout')} className="rounded-xl">
                <LogOut />
              </IconButton>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl">
        <Outlet />
      </main>
    </div>
  )
}
