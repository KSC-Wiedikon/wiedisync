import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { GameSchedulingSlot, Team } from '../../../types'

interface Props {
  seasonStatus: 'setup' | 'open' | 'closed'
  generating: boolean
  genResult: { total_created: number } | null
  /** True once slots already exist for the season → button becomes a yellow "Regenerate". */
  hasSlots: boolean
  slots: GameSchedulingSlot[]
  teams: Team[]
  onGenerate: () => Promise<void>
}

export default function SlotGenerationPanel({ seasonStatus, generating, genResult, hasSlots, slots, teams, onGenerate }: Props) {
  const { t } = useTranslation('gameScheduling')

  // Available game slots per team (the offerable count), for an at-a-glance
  // summary next to the button.
  const summary = useMemo(() => {
    const avail = new Map<string, number>()
    for (const s of slots) {
      if (s.status !== 'available') continue
      const k = String(s.kscw_team)
      avail.set(k, (avail.get(k) || 0) + 1)
    }
    return teams
      .map((tm) => ({ name: tm.name, available: avail.get(String(tm.id)) || 0 }))
      .filter((r) => r.available > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [slots, teams])
  const totalAvailable = summary.reduce((n, r) => n + r.available, 0)

  return (
    <div className="rounded-2xl border border-hairline bg-card shadow-card p-4">
      <h2 className="mb-4 text-base font-semibold tracking-tight text-foreground">{t('generateSlots')}</h2>

      <p className="mb-4 text-sm text-muted-foreground">{t('slotGenerationDescription')}</p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Button
          onClick={onGenerate}
          disabled={generating || seasonStatus === 'closed'}
          className={`shrink-0 px-6 ${
            hasSlots
              ? 'bg-gold-400 text-brand-900 hover:bg-gold-500'
              : 'bg-green-600 text-white hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700'
          }`}
        >
          {generating ? t('generatingSlots') : hasSlots ? t('regenerateSlots') : t('generateSlots')}
        </Button>

        {/* Per-team available-slot summary (next to the button) */}
        {hasSlots && summary.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground/85">{t('slotsTotal', { count: totalAvailable })}</span>
            {summary.map((r) => (
              <span key={r.name} className="rounded bg-muted px-1.5 py-0.5">
                {r.name} <span className="font-semibold">{r.available}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {genResult && (
        <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900/60 dark:bg-green-900/30 dark:text-green-300">
          {t('slotsGenerated', { count: genResult.total_created })}
        </div>
      )}
    </div>
  )
}
