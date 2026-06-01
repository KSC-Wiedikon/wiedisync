import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/button'
import type { Team, TeamSlotConfig } from '../../../types'

interface Props {
  teams: Team[]
  config: TeamSlotConfig
  onUpdate: (config: TeamSlotConfig) => Promise<void>
}

export default function TeamSlotConfigPanel({ teams, config, onUpdate }: Props) {
  const { t } = useTranslation('gameScheduling')

  // Sources are additive: a team can have evening slots AND the Saturday pool.
  // Read the new `sources` array, falling back to the legacy single `source`.
  const resolveSources = (tc: TeamSlotConfig[string] | undefined): Set<string> => {
    if (Array.isArray(tc?.sources)) return new Set(tc.sources)            // explicit (incl. [] = manual)
    if (tc?.source === 'manual') return new Set()                          // legacy explicit manual
    if (tc?.source) return new Set([tc.source])                            // legacy single-select
    return new Set(['hall_slot', 'spielsamstag'])                          // default: both on
  }

  const handleToggle = (teamId: string, source: 'hall_slot' | 'spielsamstag') => {
    const next = resolveSources(config[teamId])
    if (next.has(source)) next.delete(source)
    else next.add(source)
    const updated: TeamSlotConfig = {
      ...config,
      [teamId]: { sources: Array.from(next) as ('hall_slot' | 'spielsamstag')[] },
    }
    onUpdate(updated)
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">{t('teamSlotConfig')}</h2>

      <div className="space-y-2">
        {teams.map(team => {
          const active = resolveSources(config[team.id])
          return (
            <div
              key={team.id}
              className="flex items-center justify-between rounded-md border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-600 dark:bg-gray-700"
            >
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {team.name}
                {team.full_name && (
                  <span className="ml-2 text-gray-500 dark:text-gray-400">({team.full_name})</span>
                )}
              </span>

              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  {(['hall_slot', 'spielsamstag'] as const).map(source => {
                    const selected = active.has(source)
                    return (
                      <Button
                        key={source}
                        type="button"
                        size="sm"
                        variant={selected ? 'default' : 'outline'}
                        onClick={() => handleToggle(team.id, source)}
                        aria-pressed={selected}
                        className="h-7 px-3 text-xs"
                      >
                        {source === 'hall_slot' ? t('latestSlot') : t('spielsamstagMode')}
                      </Button>
                    )
                  })}
                </div>
                {active.size === 0 && (
                  <span className="text-xs italic text-gray-400 dark:text-gray-500">{t('sourceManual')}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <dl className="mt-4 space-y-1.5 border-t border-gray-100 pt-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
        <div>
          <dt className="inline font-medium text-gray-700 dark:text-gray-300">{t('latestSlot')}:</dt>{' '}
          <dd className="inline">{t('latestSlotHint')}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-gray-700 dark:text-gray-300">{t('spielsamstagMode')}:</dt>{' '}
          <dd className="inline">{t('spielsamstagModeHint')}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-gray-700 dark:text-gray-300">{t('sourceManual')}:</dt>{' '}
          <dd className="inline">{t('manualHint')}</dd>
        </div>
      </dl>
    </div>
  )
}
