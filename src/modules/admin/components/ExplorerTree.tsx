// src/modules/admin/components/ExplorerTree.tsx
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Users, Trophy, Calendar, Dumbbell, Target } from 'lucide-react'
import type { BucketKey, CacheShape, ExplorerEntity } from './explorerHelpers'
import {
  memberLabel, teamLabel, eventLabel, trainingLabel, gameLabel,
  highlightMatch,
} from './explorerHelpers'
import { rankEntities } from '../hooks/useExplorerSearch'

interface Props {
  cache: CacheShape
  selectedType: BucketKey | null
  selectedId: string | null
  query: string
  onSelect: (type: BucketKey, id: string) => void
}

const BUCKET_ICONS = {
  members: Users,
  teams: Trophy,
  events: Calendar,
  trainings: Dumbbell,
  games: Target,
} as const

const BUCKETS: BucketKey[] = ['members', 'teams', 'events', 'trainings', 'games']

type Sport = 'volleyball' | 'basketball' | 'other'
const SPORTS: Sport[] = ['volleyball', 'basketball', 'other']

/** Classify an entity into volleyball / basketball / other based on cache lookups. */
function sportForEntity(type: BucketKey, id: string, cache: CacheShape): Sport {
  switch (type) {
    case 'teams': {
      const team = cache.teams.find((tm) => String(tm.id) === id)
      const s = (team as unknown as { sport?: string } | undefined)?.sport
      if (s === 'volleyball' || s === 'basketball') return s
      return 'other'
    }
    case 'members': {
      const teamIds = cache.memberTeams.get(id) ?? []
      for (const tid of teamIds) {
        const team = cache.teams.find((tm) => String(tm.id) === tid)
        const sp = (team as unknown as { sport?: string } | undefined)?.sport
        if (sp === 'volleyball' || sp === 'basketball') return sp
      }
      return 'other'
    }
    case 'trainings': {
      const tr = cache.trainings.find((x) => String(x.id) === id)
      if (!tr) return 'other'
      const teamId = String((tr as unknown as { team?: unknown }).team ?? '')
      const team = cache.teams.find((tm) => String(tm.id) === teamId)
      const s = (team as unknown as { sport?: string } | undefined)?.sport
      if (s === 'volleyball' || s === 'basketball') return s
      return 'other'
    }
    case 'games': {
      const g = cache.games.find((x) => String(x.id) === id)
      if (!g) return 'other'
      for (const field of ['kscw_team', 'home_team', 'away_team'] as const) {
        const teamId = String((g as unknown as Record<string, unknown>)[field] ?? '')
        const team = cache.teams.find((tm) => String(tm.id) === teamId)
        const s = (team as unknown as { sport?: string } | undefined)?.sport
        if (s === 'volleyball' || s === 'basketball') return s
      }
      return 'other'
    }
    case 'events': {
      const ev = cache.events.find((x) => String(x.id) === id)
      if (!ev) return 'other'
      const teamsField = (ev as unknown as { teams?: unknown[] }).teams
      if (!Array.isArray(teamsField) || teamsField.length === 0) return 'other'
      for (const j of teamsField) {
        const teamsId = String((j as { teams_id?: unknown })?.teams_id ?? '')
        const team = cache.teams.find((tm) => String(tm.id) === teamsId)
        const s = (team as unknown as { sport?: string } | undefined)?.sport
        if (s === 'volleyball' || s === 'basketball') return s
      }
      return 'other'
    }
  }
}

export default function ExplorerTree({ cache, selectedType, selectedId, query, onSelect }: Props) {
  const { t } = useTranslation(['admin', 'common'])
  // expanded keys: 'members' = bucket open, 'members:volleyball' = sub-group open
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleKey = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const teamName = useMemo(() => {
    const map = new Map<string, string>()
    cache.teams.forEach((tm) => map.set(String(tm.id), teamLabel(tm)))
    return (id: string) => map.get(id) ?? id
  }, [cache.teams])

  const allEntities: ExplorerEntity[] = useMemo(
    () => [
      ...cache.members.map((m) => ({
        type: 'members' as const,
        id: String(m.id),
        label: memberLabel(m),
        sublabel: m.email ?? undefined,
      })),
      ...cache.teams.map((tm) => ({
        type: 'teams' as const,
        id: String(tm.id),
        label: teamLabel(tm),
        sublabel: tm.full_name,
      })),
      ...cache.events.map((e) => ({
        type: 'events' as const,
        id: String(e.id),
        label: eventLabel(e),
        sublabel: e.start_date ?? undefined,
      })),
      ...cache.trainings.map((tr) => ({
        type: 'trainings' as const,
        id: String(tr.id),
        label: trainingLabel(tr, teamName),
      })),
      ...cache.games.map((g) => ({
        type: 'games' as const,
        id: String(g.id),
        label: gameLabel(g, teamName),
      })),
    ],
    [cache, teamName],
  )

  const matched = useMemo(() => {
    if (!query) return allEntities
    return rankEntities(allEntities, query, 500)
  }, [allEntities, query])

  // Group first by bucket, then by sport
  const groups = useMemo(() => {
    const g: Record<BucketKey, Record<Sport, ExplorerEntity[]>> = {
      members: { volleyball: [], basketball: [], other: [] },
      teams: { volleyball: [], basketball: [], other: [] },
      events: { volleyball: [], basketball: [], other: [] },
      trainings: { volleyball: [], basketball: [], other: [] },
      games: { volleyball: [], basketball: [], other: [] },
    }
    matched.forEach((e) => {
      const sport = sportForEntity(e.type, e.id, cache)
      g[e.type][sport].push(e)
    })
    return g
  }, [matched, cache])

  const labelFor: Record<BucketKey, string> = {
    members: t('explorerBucketMembers'),
    teams: t('explorerBucketTeams'),
    events: t('explorerBucketEvents'),
    trainings: t('explorerBucketTrainings'),
    games: t('explorerBucketGames'),
  }

  const sportLabel = (sport: Sport): string => {
    if (sport === 'volleyball') return t('common:volleyball')
    if (sport === 'basketball') return t('common:basketball')
    return t('explorerSportOther')
  }

  return (
    <nav className="h-full overflow-y-auto px-2 py-2 text-sm">
      {BUCKETS.map((b) => {
        const Icon = BUCKET_ICONS[b]
        const bucketGroups = groups[b]
        const totalCount = SPORTS.reduce((n, s) => n + bucketGroups[s].length, 0)
        const bucketExpanded = expanded.has(b) || !!query

        return (
          <div key={b} className="mb-1">
            {/* Bucket header */}
            <button
              type="button"
              onClick={() => toggleKey(b)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 font-semibold text-foreground hover:bg-muted"
            >
              {bucketExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <Icon className="h-4 w-4" />
              <span>{labelFor[b]}</span>
              <span className="ml-auto text-xs font-normal text-muted-foreground">{totalCount}</span>
            </button>

            {bucketExpanded && (
              <ul className="mt-0.5">
                {SPORTS.map((sport) => {
                  const items = bucketGroups[sport]
                  if (items.length === 0) return null
                  const subKey = `${b}:${sport}`
                  const subExpanded = expanded.has(subKey) || !!query

                  return (
                    <li key={sport}>
                      {/* Sub-group header */}
                      <button
                        type="button"
                        onClick={() => toggleKey(subKey)}
                        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 pl-5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        {subExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        <span>{sportLabel(sport)}</span>
                        <span className="ml-auto font-normal">{items.length}</span>
                      </button>

                      {subExpanded && (
                        <ul className="mt-0.5">
                          {items.slice(0, 200).map((e) => {
                            const isActive = selectedType === e.type && selectedId === e.id
                            return (
                              <li key={`${e.type}-${e.id}`}>
                                <button
                                  type="button"
                                  onClick={() => onSelect(e.type, e.id)}
                                  className={
                                    // block + break-words: long game/training labels wrap
                                    // instead of overflowing the clipped sidebar on mobile.
                                    'block w-full break-words rounded-md px-2 py-1 pl-9 text-left ' +
                                    (isActive
                                      ? 'bg-primary text-primary-foreground'
                                      : 'text-foreground hover:bg-muted')
                                  }
                                >
                                  {highlightMatch(e.label, query).map((seg, i) =>
                                    seg.match ? (
                                      <mark
                                        key={i}
                                        className="rounded-sm bg-yellow-200 px-0.5 text-yellow-900 dark:bg-yellow-800/40 dark:text-yellow-200"
                                      >
                                        {seg.text}
                                      </mark>
                                    ) : (
                                      <span key={i}>{seg.text}</span>
                                    ),
                                  )}
                                </button>
                              </li>
                            )
                          })}
                          {items.length > 200 && (
                            <li className="px-2 py-1 pl-9 text-xs text-muted-foreground">
                              … {items.length - 200} more (narrow the search)
                            </li>
                          )}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </nav>
  )
}
