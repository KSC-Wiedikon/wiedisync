import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import { Button } from '@/components/ui/button'
import { FormInput } from '@/components/FormField'
import type { Team } from '../../../types'
import { fetchAllItems, kscwApi } from '../../../lib/api'
import { useReportPageLoading } from '../../../hooks/usePageReady'

const TURNSTILE_SITE_KEY = '0x4AAAAAACoYmx3xiDfRbmv9'

export default function PublicTerminplanungPage() {
  const { t } = useTranslation('gameScheduling')
  const navigate = useNavigate()
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
      const resp = await kscwApi<{ token: string }>('/terminplanung/register', {
        method: 'POST',
        anonymous: true,
        body: {
          kscw_team_id: selectedTeamId,
          club_name: clubName.trim(),
          contact_name: contactName.trim(),
          contact_email: contactEmail.trim(),
          turnstile_token: turnstileToken,
        },
      })

      navigate(`/terminplanung/${resp.token}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('registrationError'))
      turnstileRef.current?.reset()
      setTurnstileToken('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg dark:bg-gray-800">
        {/* Logo / Header */}
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('publicTitle')}</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t('publicSubtitle')}</p>
        </div>

        {seasonOpen === false && (
          <div className="mb-4 rounded-md bg-yellow-50 p-4 text-sm text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
            {t('seasonNotOpen')}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Gender toggle */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('selectGender')}
            </label>
            <div className="flex gap-2">
              {[{ key: 'H' as const, label: t('genderMen') }, { key: 'D' as const, label: t('genderWomen') }].map(g => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => { setGender(g.key); setSelectedTeamId('') }}
                  className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                    gender === g.key
                      ? 'bg-blue-600 text-white'
                      : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          {/* Team selection */}
          {gender && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('matchingTeam')}
              </label>
              <div className="flex flex-wrap gap-2">
                {filteredTeams.map(team => (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => setSelectedTeamId(team.id)}
                    className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      selectedTeamId === team.id
                        ? 'bg-blue-600 text-white'
                        : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {team.name}
                    {team.league && (
                      <span className="ml-1 text-xs opacity-75">({team.league})</span>
                    )}
                  </button>
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
      </div>
    </div>
  )
}
