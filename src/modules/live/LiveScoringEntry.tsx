import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Eye, Radio } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { kscwApi } from '../../lib/api'
import { gameKickoffMs } from '../../utils/dateHelpers'

/**
 * The game modal's door to phone live scoring: "Live scoring" for whoever may score
 * this game (players on the sheet, staff, home duty — the endpoint decides), and
 * "Watch live" for everyone once a score is being published.
 *
 * Asks the endpoint only inside the scoring window (kickoff −60 min … +4 h, the
 * endpoint's own) and only for volleyball: its eligibility check can read the
 * Einsatzliste from Volleymanager, and every game card's modal must not do that.
 */
const BEFORE_MS = 60 * 60 * 1000
const AFTER_MS = 4 * 60 * 60 * 1000

interface Props {
  gameId: string
  date: string | null | undefined
  time: string | null | undefined
  sport: 'volleyball' | 'basketball' | undefined
}

export default function LiveScoringEntry({ gameId, date, time, sport }: Props) {
  const { t } = useTranslation('live')
  const [info, setInfo] = useState<{ canScore: boolean; channel: string; live: boolean } | null>(null)

  // Read once per mount: the modal is short-lived, and the endpoint re-checks anyway.
  const [now] = useState(() => Date.now())
  const kickoff = gameKickoffMs(date, time)
  const inWindow = kickoff != null && now >= kickoff - BEFORE_MS && now <= kickoff + AFTER_MS
  const enabled = sport === 'volleyball' && inWindow

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    kscwApi<{ can_score: boolean; channel: string; row: { status?: string } | null }>(`/live-scoring/game/${gameId}`)
      .then((r) => {
        if (cancelled) return
        setInfo({ canScore: r.can_score, channel: r.channel, live: r.row?.status === 'live' || r.row?.status === 'final' })
      })
      .catch(() => { /* no entry — the modal works without it */ })
    return () => { cancelled = true }
  }, [enabled, gameId])

  if (!enabled || !info || (!info.canScore && !info.live)) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {info.canScore && (
        <Button asChild className="flex-1">
          <Link to={`/live/score/${gameId}`}><Radio />{t('liveScoring')}</Link>
        </Button>
      )}
      {info.live && (
        <Button asChild variant="outline" className="flex-1">
          <Link to={`/live?channel=${info.channel}`}><Eye />{t('watchLive')}</Link>
        </Button>
      )}
    </div>
  )
}
