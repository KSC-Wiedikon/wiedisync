import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertTriangle, Phone, ClipboardList } from 'lucide-react'
import { kscwApi } from '../../../lib/api'
import { formatDate, formatTime } from '../../../utils/dateHelpers'
import {
  useMyDuties,
  type MyDuty,
  DUTY_ROLE_LABEL_KEYS,
  DUTY_BANNER_LEAD_MS,
  DUTY_EVENT_DURATION_MS,
  DUTY_EMERGENCY_LEAD_MS,
  DUTY_EMERGENCY_GRACE_MS,
} from '../../../hooks/useMyDuties'

type Leader = { id: number; name: string; role: 'coach' | 'responsible'; phone: string | null; email: string | null }

// Passed as a lazy useState initializer (a reference, not an inline call) so the
// render body stays pure and the effect never calls setState synchronously.
const nowMs = () => Date.now()

/**
 * Homepage banner for the games the logged-in member is on duty for. Shows from
 * one week before until the game ends (yellow). Within 60' of kickoff it also
 * shows the "Emergency: contact team leaders" button, which reveals the playing
 * team's Coach/TR contact and alerts the club (POST duty-leader-contact).
 */
export default function MyDutyBanner() {
  const { duties } = useMyDuties()

  // Live clock: lazy-initialised to the current time, refreshed every 30s so the
  // banner + emergency button appear/expire without a reload.
  const [now, setNow] = useState(nowMs)
  useEffect(() => {
    const id = setInterval(() => setNow(nowMs()), 30_000)
    return () => clearInterval(id)
  }, [])

  const visible = duties.filter(
    (d) => d.startMs != null && now >= d.startMs - DUTY_BANNER_LEAD_MS && now <= d.startMs + DUTY_EVENT_DURATION_MS,
  )
  if (visible.length === 0) return null

  return (
    <div className="mb-6 space-y-3 lg:flex lg:flex-col lg:items-center">
      {visible.map((duty) => (
        <DutyBannerCard key={`${duty.game.id}-${duty.role}`} duty={duty} now={now} />
      ))}
    </div>
  )
}

function DutyBannerCard({ duty, now }: { duty: MyDuty; now: number }) {
  const { t } = useTranslation('scorer')
  const [revealed, setRevealed] = useState<Leader[] | null>(null)
  const [busy, setBusy] = useState(false)
  const { game, role, startMs } = duty

  const showEmergency =
    startMs != null && now >= startMs - DUTY_EMERGENCY_LEAD_MS && now <= startMs + DUTY_EMERGENCY_GRACE_MS
  const roleLabel = t(DUTY_ROLE_LABEL_KEYS[role] ?? role)
  const matchup = `${game.home_team} – ${game.away_team}`
  const when = `${game.date ? formatDate(game.date) : ''}${game.time ? ` · ${formatTime(game.time)}` : ''}`

  async function onEmergency() {
    setBusy(true)
    try {
      const res = await kscwApi<{ leaders: Leader[] }>(`/games/${game.id}/duty-leader-contact`, { method: 'POST' })
      setRevealed(res.leaders ?? [])
      toast.success(t('dutyEmergencySent'))
    } catch {
      toast.error(t('dutyEmergencyError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full rounded-xl border border-amber-300 bg-amber-50 p-4 lg:max-w-2xl dark:border-amber-700/60 dark:bg-amber-900/20">
      <div className="flex items-start gap-3">
        <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            {t('dutyBannerTitle', { role: roleLabel })}
          </h3>
          <p className="mt-1 break-words text-sm text-amber-800 dark:text-amber-200/90">{matchup}</p>
          <p className="text-xs text-amber-700/90 dark:text-amber-300/80">{when}</p>

          {showEmergency && revealed === null && (
            <button
              type="button"
              onClick={onEmergency}
              disabled={busy}
              className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-60 dark:bg-red-600 dark:hover:bg-red-500"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {t('dutyEmergencyButton')}
            </button>
          )}

          {revealed !== null && (
            <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
              <p className="mb-2 text-xs font-semibold text-red-700 dark:text-red-300">{t('dutyEmergencyRevealed')}</p>
              {revealed.length === 0 ? (
                <p className="text-sm text-gray-600 dark:text-gray-400">{t('dutyEmergencyNoLeaders')}</p>
              ) : (
                <ul className="space-y-2">
                  {revealed.map((l) => (
                    <li key={l.id} className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-gray-100">
                        {l.name}
                        <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                          {l.role === 'coach' ? t('roleCoach') : t('roleResponsible')}
                        </span>
                      </span>
                      <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600 dark:text-gray-400">
                        {l.phone && (
                          <a href={`tel:${l.phone}`} className="flex items-center gap-1 font-medium hover:text-brand-600 dark:hover:text-brand-400">
                            <Phone className="h-3 w-3" />{l.phone}
                          </a>
                        )}
                        {l.email && (
                          <a href={`mailto:${l.email}`} className="font-medium hover:text-brand-600 dark:hover:text-brand-400">{l.email}</a>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
