import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchItem } from '../../../lib/api'
import type { Poll } from '../../../types'
import PollCard from '../../polls/PollCard'

type Props = { pollId: string | number }

export default function PollMessage({ pollId }: Props) {
  const { t } = useTranslation('messaging')
  const [poll, setPoll] = useState<Poll | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const p = await fetchItem<Poll>('polls', String(pollId))
        if (alive) setPoll(p)
      } catch {
        if (alive) setPoll(null)
      } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [pollId])

  if (loading) return <div className="text-xs text-muted-foreground">{t('loading')}</div>
  if (!poll) return <div className="text-xs text-destructive">{t('pollLoadError')}</div>
  // PollCard requires canManage + onClose + onDelete. For Plan 04 we render
  // read-only; canManage=false hides management UI, no-op callbacks are safe.
  return <PollCard poll={poll} canManage={false} onClose={() => {}} onDelete={() => {}} />
}
