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
 *
 * Loading: inside the window a placeholder holds the buttons' place, so they do not
 * push the modal down when the answer lands (the check can take a second). The answer
 * is kept with the game it is for: a modal switched to another game never shows the
 * previous game's buttons with the new game's link.
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
  const [info, setInfo] = useState<{ gameId: string; canScore: boolean; channel: string; live: boolean } | null>(null)

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
        setInfo({ gameId, canScore: r.can_score, channel: r.channel, live: r.row?.status === 'live' || r.row?.status === 'final' })
      })
      // No entry — the modal works without it; settles the placeholder.
      .catch(() => { if (!cancelled) setInfo({ gameId, canScore: false, channel: '', live: false }) })
    return () => { cancelled = true }
  }, [enabled, gameId])

  const current = info && info.gameId === gameId ? info : null
  if (!enabled) return null
  if (!current) {
    return <div className="h-10 rounded-lg bg-muted motion-safe:animate-pulse" aria-busy="true" />
  }
  if (!current.canScore && !current.live) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {current.canScore && (
        <Button asChild className="flex-1">
          <Link to={`/live/score/${gameId}`}><Radio />{t('liveScoring')}</Link>
        </Button>
      )}
      {current.live && (
        <Button asChild variant="outline" className="flex-1">
          <Link to={`/live?channel=${current.channel}`}><Eye />{t('watchLive')}</Link>
        </Button>
      )}
    </div>
  )
}
