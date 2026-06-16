import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/button'
import { fetchAllItems } from '../../../lib/api'
import { gameStartForDow } from '../utils/slotTime'
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
  label: string | null
  sport: string | null
  hall: { name?: string } | null
  teams: { teams_id: number }[]
}

// day_of_week is 0 = Monday in the DB (per TrainingForm), so index directly.
const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const hm = (s: string) => String(s || '').slice(0, 5)
const isKwi = (n: string) => /kwi/.test(n.toLowerCase())
const isDoltschi = (n: string) => /döltschi|doltschi/.test(n.toLowerCase())

export default function TeamSlotConfigPanel({ teams, config, onUpdate }: Props) {
  const { t } = useTranslation('gameScheduling')
  const [hallSlots, setHallSlots] = useState<HallSlotLite[]>([])

  useEffect(() => {
    fetchAllItems<HallSlotLite>('hall_slots', {
      fields: ['id', 'day_of_week', 'start_time', 'end_time', 'label', 'sport', 'hall.name', 'teams.teams_id'],
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

  // Mirrors the backend generate-slots: own latest KWI block (ends 21:30);
  // juniors (Under teams) ALWAYS get the shared volleyball Döltschi pool (even
  // when it's not their own slot) PLUS the Spielhalle pool (both); non-juniors
  // take the Döltschi pool only if assigned, else fall back to Spielhalle.
  // A Döltschi date is ONE slot (time + hall 1/2 irrelevant) → all of a day's
  // Döltschi slots merge into a single "Döltschi" entry (union time window).
  const resolveStandard = (team: { id: string | number; name: string }) => {
    const mine = slotsByTeam.get(String(team.id)) || []
    const kwiOwn = mine.filter((s) => hm(s.end_time) === '21:30' && isKwi(s.hall?.name || ''))
    const usesDoltschi = mine.some((s) => s.sport === 'volleyball' && isDoltschi(s.hall?.name || ''))
    const isJr = /u\d/i.test(team.name || '')
    const fmt = (s: HallSlotLite) => `${DAY[s.day_of_week]} ${gameStartForDow(s.day_of_week, s.start_time)} · ${s.hall?.name}`

    // One merged "Döltschi" entry per day: a Döltschi date is a single slot
    // regardless of time (19:00 / 20:30) or hall (Döltschi 1 or 2). Show the
    // union window (earliest start – latest end) of that day's Döltschi slots.
    const doltschiLabels: string[] = []
    if (usesDoltschi || isJr) {
      const byDay = new Map<number, HallSlotLite[]>()
      for (const s of hallSlots) {
        if (s.sport !== 'volleyball' || !isDoltschi(s.hall?.name || '')) continue
        const arr = byDay.get(s.day_of_week) || []
        arr.push(s)
        byDay.set(s.day_of_week, arr)
      }
      for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
        const slots = byDay.get(day)!
        const start = slots.map((s) => hm(s.start_time)).sort()[0]
        doltschiLabels.push(`${DAY[day]} ${gameStartForDow(day, start)} · Döltschi`)
      }
    }
    const hasPool = doltschiLabels.length > 0

    const sh = hallSlots.filter((s) => (s.label || '').toLowerCase() === 'spielhalle')
    const labels = [...kwiOwn.map(fmt), ...doltschiLabels]
    // Juniors also get Spielhalle (both); others only as a fallback when empty.
    if (isJr) labels.push(...sh.map((s) => `Spielhalle · ${fmt(s)}`))
    else if (labels.length === 0) labels.push(...sh.map((s) => `Spielhalle · ${fmt(s)}`))
    if (labels.length) {
      return { labels: [...new Set(labels)], fallback: kwiOwn.length === 0 && !hasPool }
    }
    return { labels: ['—'], fallback: true }
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
          const std = resolveStandard(team)
          const standardOn = active.has('hall_slot')
          const saturdayOn = active.has('spielsamstag')
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
              <div className={`mt-1.5 text-xs ${standardOn ? 'text-gray-600 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'}`}>
                <span className="font-medium">{t('latestSlot')}:</span>
                <ul className={`mt-0.5 space-y-0.5 ${standardOn ? '' : 'line-through'}`}>
                  {std.labels.map((l, i) => (
                    <li key={i} className={std.fallback ? 'italic text-amber-600 dark:text-amber-400' : ''}>{l}</li>
                  ))}
                </ul>
              </div>

              {/* Resolved Spielsamstag slots — struck through when the Saturday toggle is off */}
              {/* Spielsamstag source — the label alone (struck through when the toggle is off) */}
              <div className={`mt-1.5 text-xs font-medium ${saturdayOn ? 'text-gray-600 dark:text-gray-300' : 'text-gray-400 line-through dark:text-gray-500'}`}>
                {t('spielsamstage')}
              </div>

              <div className="mt-2.5">
                <div className="grid max-w-[14rem] grid-cols-2 gap-1">
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
                        className="h-11 sm:h-7 w-full px-2.5 text-xs"
                      >
                        {source === 'hall_slot' ? t('latestSlot') : t('spielsamstagMode')}
                      </Button>
                    )
                  })}
                </div>
                {active.size === 0 && (
                  <span className="mt-1 block text-xs italic text-gray-400 dark:text-gray-500">{t('sourceManual')}</span>
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
