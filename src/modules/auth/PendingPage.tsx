import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'
import ProfileEditModal from './ProfileEditModal'
import ImpersonationBanner from '../../components/ImpersonationBanner'
import ActingBanner from '../../components/ActingBanner'
import { Button } from '@/components/ui/button'
import type { Team } from '../../types'
import { client, fetchItem } from '../../lib/api'
import SupportContact from '@/components/SupportContact'
import LanguageDropdown from '@/components/LanguageDropdown'

export default function PendingPage() {
  const { user, isApproved, isProfileComplete, isLoading, logout, isImpersonating } = useAuth()
  const { theme } = useTheme()
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const [team, setTeam] = useState<Team | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [skippedOnboarding, setSkippedOnboarding] = useState(false)

  // If not logged in, go to login
  useEffect(() => {
    if (!isLoading && !user) navigate('/login', { replace: true })
  }, [user, isLoading, navigate])

  // If already approved, go home
  useEffect(() => {
    if (!isLoading && user && isApproved) navigate('/', { replace: true })
  }, [user, isApproved, isLoading, navigate])

  // Fetch the requested team name
  useEffect(() => {
    if (!user?.requested_team) return
    fetchItem<Team>('teams', user.requested_team)
      .then(setTeam)
      .catch(() => setTeam(null))
  }, [user?.requested_team])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await client.refresh()
    } catch {
      // ignore
    } finally {
      setRefreshing(false)
    }
  }

  if (isLoading || !user) return null

  return (
    <>
    <ImpersonationBanner topInset={isImpersonating} />
    <ActingBanner topInset={!isImpersonating} />
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-100 via-stone-50 to-stone-100 p-4 dark:from-background dark:via-background dark:to-card/40">
      <div className="w-full max-w-sm">
        <div className="mb-2 flex justify-end">
          <LanguageDropdown size="sm" />
        </div>
        <div className="relative w-full overflow-hidden rounded-3xl border border-hairline bg-card p-6 shadow-card-lg sm:p-8">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-600 to-brand-400" />
          <div className="mb-6 flex justify-center">
            <img
              src={theme === 'light' ? '/wiedisync_blau.png' : '/wiedisync_weiss.png'}
              alt="KSC Wiedikon"
              className="h-11 w-auto"
            />
          </div>
          {/* Hourglass icon */}
          <div className="mb-4 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
              <Clock className="h-8 w-8 text-amber-600 dark:text-amber-400" strokeWidth={1.5} aria-hidden="true" />
            </div>
          </div>

          <h1 className="mb-2 text-center text-xl font-bold tracking-tight text-foreground">
            {t('pendingApproval')}
          </h1>

          <p className="mb-6 text-center text-sm text-muted-foreground">
            {t('pendingDescription')}
          </p>

          {/* User info */}
          <div className="mb-6 space-y-2 rounded-xl border border-hairline bg-surface-sunken p-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t('firstName')}</span>
              <span className="font-medium text-foreground">{user.first_name} {user.last_name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t('email')}</span>
              <span className="font-medium text-foreground">{user.email}</span>
            </div>
            {team && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t('requestedTeam')}</span>
                <span className="font-medium text-foreground">{team.name}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="space-y-3">
            <Button onClick={handleRefresh} loading={refreshing} className="w-full">
              {refreshing ? t('checking') : t('refreshStatus')}
            </Button>

            {/* Hidden while impersonating — logout would end the superadmin's
                own session. They exit read-only view via the banner instead. */}
            {!isImpersonating && (
              <Button variant="outline" onClick={logout} className="w-full">
                {t('logout')}
              </Button>
            )}
          </div>
        </div>
        <SupportContact className="mt-4" />
      </div>
      {/* Onboarding modal for unapproved users who haven't set language */}
      {user && !isProfileComplete && !skippedOnboarding && (
        <ProfileEditModal
          open
          onClose={() => setSkippedOnboarding(true)}
          onboarding
        />
      )}
    </div>
    </>
  )
}
