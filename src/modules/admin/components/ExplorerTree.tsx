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
import { buildMemberGroups, countMembers, type MemberGroupNode } from './memberGroups'
import type { Member } from '../../../types'

interface Props {
  cache: CacheShape
  /**
   * Every member the page loaded, with the header's member filters NOT applied.
   * ⚠ Only the register-status groups (honorary / passive / former / …) read
   * this. The page filters default to `kscw_membership_active = yes`, so
   * building "Former members" from the filtered list would render it
   * permanently empty and make the club look like nobody has ever left.
   */
  allMembers: ReadonlyArray<Member>
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

/** Buckets still grouped by a single sport. Members moved to `memberGroups`. */
type EntityBucket = Exclude<BucketKey, 'members'>
type Sport = 'volleyball' | 'basketball' | 'other'
const SPORTS: Sport[] = ['volleyball', 'basketball', 'other']

/**
 * Classify a non-member entity into volleyball / basketball / other.
 *
 * ⚠ These all resolve through a real `teams.sport` FK, which is why they never
 * had the members bucket's problem: a member has no sport column at all, so
 * reading one relation (`member_teams`, players only) filed every coach and
 * every team-less section member under "Other". Members are grouped by
 * `buildMemberGroups` now — do not add a `members` case back here.
 */
function sportForEntity(type: EntityBucket, id: string, cache: CacheShape): Sport {
  switch (type) {
    case 'teams': {
      const team = cache.teams.find((tm) => String(tm.id) === id)
      const s = (team as unknown as { sport?: string } | undefined)?.sport
      if (s === 'volleyball' || s === 'basketball') return s
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

const ITEM_LIMIT = 200

export default function ExplorerTree({
  cache, allMembers, selectedType, selectedId, query, onSelect,
}: Props) {
  const { t } = useTranslation(['admin', 'common'])
  // Expanded keys: 'members' = bucket open, 'members:sport:volleyball' = group
  // open. Group keys come from memberGroups and are unique tree-wide.
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

  // Member entities come from the UNFILTERED list so search can find somebody
  // the current filters hide — "where is Hans?" is a fair question to ask of a
  // database. Which groups they then appear in is decided below.
  const memberEntities: ExplorerEntity[] = useMemo(
    () => allMembers.map((m) => ({
      type: 'members' as const,
      id: String(m.id),
      label: memberLabel(m),
      sublabel: m.email ?? undefined,
    })),
    [allMembers],
  )

  const otherEntities: ExplorerEntity[] = useMemo(
    () => [
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

  const matchedMembers = useMemo(
    () => (query ? rankEntities(memberEntities, query, 500) : memberEntities),
    [memberEntities, query],
  )
  const matchedOthers = useMemo(
    () => (query ? rankEntities(otherEntities, query, 500) : otherEntities),
    [otherEntities, query],
  )

  /** id → entity, so a group's member ids can be rendered without re-deriving labels. */
  const memberById = useMemo(() => {
    const map = new Map<string, ExplorerEntity>()
    matchedMembers.forEach((e) => map.set(e.id, e))
    return map
  }, [matchedMembers])

  const memberGroups = useMemo(() => {
    const matchedIds = new Set(matchedMembers.map((e) => e.id))
    // The header's member filters are already applied to `cache.members`.
    const filteredIds = new Set(cache.members.map((m) => String(m.id)))
    const inSearch = allMembers.filter((m) => matchedIds.has(String(m.id)))
    return buildMemberGroups(
      inSearch.filter((m) => filteredIds.has(String(m.id))),
      inSearch,
      cache,
    )
  }, [allMembers, cache, matchedMembers])

  const entityGroups = useMemo(() => {
    const g: Record<EntityBucket, Record<Sport, ExplorerEntity[]>> = {
      teams: { volleyball: [], basketball: [], other: [] },
      events: { volleyball: [], basketball: [], other: [] },
      trainings: { volleyball: [], basketball: [], other: [] },
      games: { volleyball: [], basketball: [], other: [] },
    }
    matchedOthers.forEach((e) => {
      const bucket = e.type as EntityBucket
      g[bucket][sportForEntity(bucket, e.id, cache)].push(e)
    })
    return g
  }, [matchedOthers, cache])

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

  /** A group's own label — an i18n key, or a raw name (team, OTR1) as-is. */
  const groupLabel = (node: MemberGroupNode): string =>
    node.raw ?? (node.labelKey ? t(node.labelKey) : node.key)

  function renderItem(e: ExplorerEntity, depth: number) {
    const isActive = selectedType === e.type && selectedId === e.id
    return (
      <li key={`${e.type}-${e.id}`}>
        <button
          type="button"
          onClick={() => onSelect(e.type, e.id)}
          style={{ paddingLeft: 20 + depth * 12 }}
          className={
            // block + break-words: long game/training labels wrap instead of
            // overflowing the clipped sidebar on mobile.
            'block w-full break-words rounded-md px-2 py-1 text-left ' +
            (isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted')
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
  }

  function renderItems(items: ExplorerEntity[], depth: number) {
    return (
      <ul className="mt-0.5">
        {items.slice(0, ITEM_LIMIT).map((e) => renderItem(e, depth))}
        {items.length > ITEM_LIMIT && (
          <li
            className="px-2 py-1 text-xs text-muted-foreground"
            style={{ paddingLeft: 20 + depth * 12 }}
          >
            {t('explorerTreeMore', { count: items.length - ITEM_LIMIT })}
          </li>
        )}
      </ul>
    )
  }

  /** Collapsible header shared by sport sub-groups and member groups. */
  function renderGroupHeader(key: string, label: string, count: number, depth: number, open: boolean) {
    return (
      <button
        type="button"
        onClick={() => toggleKey(key)}
        style={{ paddingLeft: 8 + depth * 12 }}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <span className="break-words text-left">{label}</span>
        <span className="ml-auto shrink-0 font-normal">{count}</span>
      </button>
    )
  }

  function renderMemberNode(node: MemberGroupNode, depth: number) {
    const count = countMembers(node)
    // A search auto-opens everything: the point of typing is to see the hits,
    // not to be told which of twenty collapsed groups they are hiding in.
    const open = expanded.has(node.key) || !!query
    return (
      <li key={node.key}>
        {renderGroupHeader(node.key, groupLabel(node), count, depth, open)}
        {open && (
          node.children
            ? <ul className="mt-0.5">{node.children.map((c) => renderMemberNode(c, depth + 1))}</ul>
            : renderItems(
                (node.memberIds ?? []).map((id) => memberById.get(id)).filter((e): e is ExplorerEntity => !!e),
                depth + 1,
              )
        )}
      </li>
    )
  }

  return (
    <nav className="h-full overflow-y-auto px-2 py-2 text-sm">
      {BUCKETS.map((b) => {
        const Icon = BUCKET_ICONS[b]
        // ⚠ Members are counted DISTINCT, not as the sum of the groups: a
        // player-coach on the Vorstand is in three of them, and a bucket header
        // reading 1,900 for a 700-person club is worse than no number at all.
        const totalCount = b === 'members'
          ? new Set(memberGroups.flatMap(function ids(n: MemberGroupNode): string[] {
              return n.memberIds ?? (n.children ?? []).flatMap(ids)
            })).size
          : SPORTS.reduce((n, s) => n + entityGroups[b as EntityBucket][s].length, 0)
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
              b === 'members'
                ? <ul className="mt-0.5">{memberGroups.map((n) => renderMemberNode(n, 0))}</ul>
                : (
                  <ul className="mt-0.5">
                    {SPORTS.map((sport) => {
                      const items = entityGroups[b as EntityBucket][sport]
                      if (items.length === 0) return null
                      const subKey = `${b}:${sport}`
                      const subExpanded = expanded.has(subKey) || !!query
                      return (
                        <li key={sport}>
                          {renderGroupHeader(subKey, sportLabel(sport), items.length, 0, subExpanded)}
                          {subExpanded && renderItems(items, 1)}
                        </li>
                      )
                    })}
                  </ul>
                )
            )}
          </div>
        )
      })}
    </nav>
  )
}
