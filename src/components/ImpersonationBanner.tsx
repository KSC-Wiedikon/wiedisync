import { useTranslation } from 'react-i18next'
import { Eye } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { Button } from '@/components/ui/button'

/**
 * Persistent banner shown while a superadmin views the app "as" another member
 * (read-only). Always visible at the very top so the operator can't forget they
 * are impersonating, with a one-tap Exit that restores their real identity.
 *
 * Not sticky / z-[100]: it lives in the shell's flex column above the scroll
 * container, and z-[100] painted it over full-screen modals. `topInset` adds the
 * iOS safe-area padding when this is the top-most banner (Layout decides).
 */
export default function ImpersonationBanner({ topInset = false }: { topInset?: boolean }) {
  const { t } = useTranslation('common')
  const { isImpersonating, user, stopImpersonation } = useAuth()
  if (!isImpersonating || !user) return null
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
  return (
    <div
      className="relative z-30 flex shrink-0 items-center justify-center gap-3 border-b border-orange-300 bg-orange-50 px-4 py-1.5 text-xs font-medium text-orange-800 dark:border-orange-800/60 dark:bg-orange-950/60 dark:text-orange-200"
      style={topInset ? { paddingTop: 'calc(0.375rem + env(safe-area-inset-top, 0px))' } : undefined}
      data-system-bar={topInset ? 'top' : undefined}
    >
      <Eye className="h-4 w-4 shrink-0" />
      <span className="truncate" title={t('impersonationBanner', { name })}>{t('impersonationBanner', { name })}</span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => { void stopImpersonation() }}
        className="shrink-0 border border-orange-300 bg-card font-semibold text-orange-800 hover:bg-orange-100 hover:text-orange-900 dark:border-orange-800/60 dark:bg-orange-900/40 dark:text-orange-100 dark:hover:bg-orange-900/60 dark:hover:text-orange-50"
      >
        {t('impersonationExit')}
      </Button>
    </div>
  )
}
