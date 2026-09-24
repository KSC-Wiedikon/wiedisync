import { useTranslation } from 'react-i18next'
import { Eye } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

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
      className="relative z-30 flex shrink-0 items-center justify-center gap-3 bg-orange-500 px-4 py-1.5 text-sm font-medium text-white shadow-md"
      style={topInset ? { paddingTop: 'calc(0.375rem + env(safe-area-inset-top, 0px))' } : undefined}
    >
      <Eye className="h-4 w-4 shrink-0" />
      <span className="truncate">{t('impersonationBanner', { name })}</span>
      <button
        type="button"
        onClick={() => { void stopImpersonation() }}
        className="shrink-0 rounded bg-white/20 px-2 py-0.5 text-xs font-semibold transition-colors hover:bg-white/30"
      >
        {t('impersonationExit')}
      </button>
    </div>
  )
}
