import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import { Button } from '@/components/ui/button'
import { FormInput } from '@/components/FormField'
import type { Team } from '../../../types'
import { fetchAllItems, kscwApi } from '../../../lib/api'
import { useReportPageLoading } from '../../../hooks/usePageReady'

const TURNSTILE_SITE_KEY = '0x4AAAAAACoYmx3xiDfRbmv9'

export default function PublicTerminplanungPage() {
  const { t, i18n } = useTranslation('gameScheduling')
  const [searchParams] = useSearchParams()

  const [teams, setTeams] = useState<Team[]>([])
  const [gender, setGender] = useState<'H' | 'D' | ''>('')
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [clubName, setClubName] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [seasonOpen, setSeasonOpen] = useState<boolean | null>(null)
  const [turnstileToken, setTurnstileToken] = useState('')
  // Address the access link was mailed to — set on success, switches the page
  // to the "check your email" confirmation.
  const [sentTo, setSentTo] = useState<string | null>(null)
  const turnstileRef = useRef<TurnstileInstance>(null)

  // Fetch teams and check season status
  useEffect(() => {
    async function load() {
      try {
        const [teamRecords, seasons] = await Promise.all([
          fetchAllItems<Team>('teams', { filter: { _and: [{ active: { _eq: true } }, { sport: { _eq: 'volleyball' } }] }, sort: ['name'] }),
          fetchAllItems('game_scheduling_seasons', { filter: { status: { _eq: 'open' } }, sort: ['-date_created'] }),
        ])
        setTeams(teamRecords)
        setSeasonOpen(seasons.length > 0)
        // Deep-link from the admin dashboard's "Copy registration link" button:
        // ?team=<id> pre-selects that KSCW team (+ derives the gender toggle).
        const preTeam = searchParams.get('team')
        if (preTeam) {
          const tm = teamRecords.find((x) => String(x.id) === preTeam)
          if (tm) {
            setGender(tm.name.startsWith('H') ? 'H' : tm.name.startsWith('D') ? 'D' : '')
            setSelectedTeamId(tm.id)
          }
        }
      } catch {
        setSeasonOpen(false)
      }
    }
    load()
  }, [searchParams])

  // Report to the app boot gate — see usePageReady.tsx. The initial fetch
  // (teams + season status) is in flight while seasonOpen is still null; it
  // resolves to true/false on success or error.
  useReportPageLoading(seasonOpen === null)

  // Filter teams by gender prefix
  const filteredTeams = teams.filter(team => {
    if (!gender) return true
    return team.name.startsWith(gender)
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!selectedTeamId || !clubName.trim() || !contactName.trim() || !contactEmail.trim()) {
      setError(t('required'))
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      setError(t('invalidEmail'))
      return
    }

    setLoading(true)
    try {
      // The endpoint never returns the access token (EP-SCH-2): it mails the
      // link to contact_email, so only the owner of that inbox can open the
      // opponent view. Same answer whether the address was new or already
      // registered — no enumeration.
      const email = contactEmail.trim()
      await kscwApi<{ success: boolean; expires_at?: string }>('/terminplanung/register', {
        method: 'POST',
        anonymous: true,
        body: {
          kscw_team: selectedTeamId,
          team_name: clubName.trim(),
          contact_name: contactName.trim(),
          contact_email: email,
          turnstile_token: turnstileToken,
          language: (i18n.language || '').split('-')[0].toLowerCase(),
        },
      })
      setSentTo(email)
      // Single-use token, already spent — the remounted widget issues a new one.
      setTurnstileToken('')
    } catch (err) {
      const e = err as { code?: string; status?: number }
      setError(
        e?.code === 'registration_closed' ? t('registrationClosed')
          : e?.status === 429 ? t('registrationRateLimited')
          : t('registrationError'),
      )
      turnstileRef.current?.reset()
      setTurnstileToken('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-3xl border border-hairline bg-card p-8 shadow-card-lg">
        {/* Logo / Header */}
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{t('publicTitle')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('publicSubtitle')}</p>
        </div>

        {sentTo ? (
          <div role="status" className="space-y-4 text-center">
            <h2 className="text-lg font-semibold text-foreground">{t('registrationCheckEmailTitle')}</h2>
            <p className="break-words text-sm text-muted-foreground">{t('registrationCheckEmail', { email: sentTo })}</p>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => { setSentTo(null); setSelectedTeamId(''); setError('') }}
            >
              {t('registerAnother')}
            </Button>
          </div>
        ) : (<>
        {seasonOpen === false && (
          <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800 dark:border-yellow-900/60 dark:bg-yellow-950/40 dark:text-yellow-300">
            {t('seasonNotOpen')}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Gender toggle */}
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground/85">
              {t('selectGender')}
            </label>
            <div className="flex gap-2">
              {[{ key: 'H' as const, label: t('genderMen') }, { key: 'D' as const, label: t('genderWomen') }].map(g => (
                <Button
                  key={g.key}
                  type="button"
                  onClick={() => { setGender(g.key); setSelectedTeamId('') }}
                  variant={gender === g.key ? 'default' : 'outline'}
                  className="flex-1"
                >
                  {g.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Team selection */}
          {gender && (
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground/85">
                {t('matchingTeam')}
              </label>
              <div className="flex flex-wrap gap-2">
                {filteredTeams.map(team => (
                  <Button
                    key={team.id}
                    type="button"
                    onClick={() => setSelectedTeamId(team.id)}
                    variant={selectedTeamId === team.id ? 'default' : 'outline'}
                    className="max-w-full"
                  >
                    {team.name}
                    {team.league && (
                      <span className="ml-1 text-xs opacity-75">({team.league})</span>
                    )}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Club info */}
          <FormInput
            type="text"
            label={t('clubName')}
            value={clubName}
            onChange={e => setClubName(e.target.value)}
            placeholder={t('placeholderClubName')}
            required
          />

          <FormInput
            type="text"
            label={t('contactName')}
            value={contactName}
            onChange={e => setContactName(e.target.value)}
            required
          />

          <FormInput
            type="email"
            label={t('contactEmailLabel')}
            value={contactEmail}
            onChange={e => setContactEmail(e.target.value)}
            required
          />

          <Turnstile
            ref={turnstileRef}
            siteKey={TURNSTILE_SITE_KEY}
            onSuccess={setTurnstileToken}
            onExpire={() => setTurnstileToken('')}
            options={{ theme: 'auto', size: 'flexible' }}
          />

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <Button
            type="submit"
            disabled={loading || seasonOpen === false || !selectedTeamId || !turnstileToken}
            loading={loading}
            className="w-full"
          >
            {loading ? t('registering') : t('register')}
          </Button>
        </form>
        </>)}
      </div>
    </div>
  )
}
