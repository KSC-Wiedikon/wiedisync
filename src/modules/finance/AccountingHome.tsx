import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { isAuthenticated } from '@/lib/api'
import { useReportPageLoading } from '../../hooks/usePageReady'
import FinancePage from './FinancePage'

/**
 * Root of accounting.wiedisync.kscw.ch. Not logged in → /login; board, treasurer
 * ('finance') or auditor ('revisor') → the books; anyone else → a short notice
 * (never a redirect loop back to here).
 */
export default function AccountingHome() {
  const { user, isLoading, canReadFinance } = useAuth()
  const { theme } = useTheme()
  const { t } = useTranslation('finance')
  const booting = isLoading && isAuthenticated()
  useReportPageLoading(booting)
  if (booting) return null
  if (!user) return <Navigate to="/login" replace />
  if (canReadFinance) return <FinancePage />
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <img src={theme === 'light' ? '/wiedisync_blau.png' : '/wiedisync_weiss.png'} alt="KSC Wiedikon" className="mx-auto mb-6 h-14 w-auto" />
        <h1 className="text-xl font-bold tracking-tight text-foreground">{t('accountingNoAccessTitle')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('accountingNoAccess')}</p>
        <a href="https://wiedisync.kscw.ch" className="mt-4 inline-block text-sm font-medium text-primary underline dark:text-brand-300">wiedisync.kscw.ch</a>
      </div>
    </div>
  )
}
