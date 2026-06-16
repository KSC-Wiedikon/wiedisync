import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
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
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">{t('generateSlots')}</h2>

      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">{t('slotGenerationDescription')}</p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <button
          onClick={onGenerate}
          disabled={generating || seasonStatus === 'closed'}
          className={`shrink-0 rounded-md px-6 py-2.5 text-sm font-medium min-h-11 disabled:opacity-50 ${
            hasSlots
              ? 'bg-gold-400 text-brand-900 hover:bg-gold-500'
              : 'bg-green-600 text-white hover:bg-green-700'
          }`}
        >
          {generating ? t('generatingSlots') : hasSlots ? t('regenerateSlots') : t('generateSlots')}
        </button>

        {/* Per-team available-slot summary (next to the button) */}
        {hasSlots && summary.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
            <span className="font-semibold text-gray-700 dark:text-gray-200">{t('slotsTotal', { count: totalAvailable })}</span>
            {summary.map((r) => (
              <span key={r.name} className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">
                {r.name} <span className="font-semibold">{r.available}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {genResult && (
        <div className="mt-3 rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-900/30 dark:text-green-300">
          {t('slotsGenerated', { count: genResult.total_created })}
        </div>
      )}
    </div>
  )
}
