import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/button'
import { fetchAllItems } from '../../../lib/api'
import type { Team, TeamSlotConfig } from '../../../types'

interface Props {
  teams: Team[]
  config: TeamSlotConfig
  onUpdate: (config: TeamSlotConfig) => Promise<void>
}

interface HallSlotLite {
  id: number
  day_of_week: number
  start_time: string
  end_time: string
  hall: { name?: string } | null
  teams: { teams_id: number }[]
}

// day_of_week: 0 = Sunday (matches the generator's getUTCDay()).
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const hm = (s: string) => String(s || '').slice(0, 5)
const isStandardHall = (name: string) => /döltschi|doltschi|kwi/.test(name.toLowerCase())

export default function TeamSlotConfigPanel({ teams, config, onUpdate }: Props) {
  const { t } = useTranslation('gameScheduling')
  const [hallSlots, setHallSlots] = useState<HallSlotLite[]>([])

  useEffect(() => {
    fetchAllItems<HallSlotLite>('hall_slots', {
      fields: ['id', 'day_of_week', 'start_time', 'end_time', 'hall.name', 'teams.teams_id'],
    })
      .then(setHallSlots)
      .catch(() => {})
  }, [])

  // team id -> its hall slots (expand the M2M, don't filter by it — see M2M caveats).
  const slotsByTeam = useMemo(() => {
    const m = new Map<string, HallSlotLite[]>()
    for (const s of hallSlots) {
      for (const j of s.teams || []) {
        const k = String(j?.teams_id ?? j)
        if (!m.has(k)) m.set(k, [])
        m.get(k)!.push(s)
      }
    }
    return m
  }, [hallSlots])

  // Mirrors the backend: a team's own 21:30 Döltschi/KWI slot, else the
  // club-wide Spielhalle Friday fallback.
  const resolveStandard = (teamId: string | number) => {
    const own = (slotsByTeam.get(String(teamId)) || []).filter(
      (s) => hm(s.end_time) === '21:30' && isStandardHall(s.hall?.name || ''),
    )
    if (own.length) {
      return {
        label: own.map((s) => `${DAY[s.day_of_week]} ${hm(s.start_time)}–${hm(s.end_time)} · ${s.hall?.name}`).join(', '),
        fallback: false,
      }
    }
    return { label: 'Spielhalle · Fri 19:00 · Döltschi 1', fallback: true }
  }

  // Sources are additive: a team can have the Standard slot AND the Saturday
  // pool. Read the new `sources` array, falling back to the legacy single
  // `source`; no config at all = both on (the default).
  const resolveSources = (tc: TeamSlotConfig[string] | undefined): Set<string> => {
    if (Array.isArray(tc?.sources)) return new Set(tc.sources)
    if (tc?.source === 'manual') return new Set()
    if (tc?.source) return new Set([tc.source])
    return new Set(['hall_slot', 'spielsamstag'])
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {teams.map((team) => {
          const active = resolveSources(config[team.id])
          const std = resolveStandard(team.id)
          const standardOn = active.has('hall_slot')
          return (
            <div
              key={team.id}
              className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-700/50"
            >
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {team.name}
                {team.full_name && (
                  <span className="ml-1 font-normal text-gray-500 dark:text-gray-400">· {team.full_name}</span>
                )}
              </div>

              {/* Resolved Standard slot — struck through when the Standard toggle is off */}
              <div className={`mt-1.5 text-xs ${standardOn ? 'text-gray-600 dark:text-gray-300' : 'text-gray-400 line-through dark:text-gray-500'}`}>
                <span className="font-medium">{t('latestSlot')}:</span>{' '}
                <span className={std.fallback ? 'italic text-amber-600 dark:text-amber-400' : ''}>{std.label}</span>
              </div>

              <div className="mt-2.5 flex items-center gap-1">
                {(['hall_slot', 'spielsamstag'] as const).map((source) => {
                  const selected = active.has(source)
                  return (
                    <Button
                      key={source}
                      type="button"
                      size="sm"
                      variant={selected ? 'default' : 'outline'}
                      onClick={() => handleToggle(team.id, source)}
                      aria-pressed={selected}
                      className="h-7 px-2.5 text-xs"
                    >
                      {source === 'hall_slot' ? t('latestSlot') : t('spielsamstagMode')}
                    </Button>
                  )
                })}
                {active.size === 0 && (
                  <span className="ml-1 text-xs italic text-gray-400 dark:text-gray-500">{t('sourceManual')}</span>
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
