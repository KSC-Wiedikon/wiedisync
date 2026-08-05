// src/modules/admin/components/ExplorerDetail.tsx
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Eye } from 'lucide-react'
import { API_URL } from '../../../lib/api'
import type { BucketKey, CacheShape } from './explorerHelpers'
import {
  memberLabel, teamLabel, eventLabel, trainingLabel, gameLabel,
  formatShortDate, formatShortDateTime,
} from './explorerHelpers'
import ExplorerSectionCard from './ExplorerSectionCard'
import ExplorerMemberFields from './ExplorerMemberFields'
import { useRelatedEntities, type SectionKey } from '../hooks/useRelatedEntities'
import { useAuth } from '../../../hooks/useAuth'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'

interface Props {
  cache: CacheShape
  type: BucketKey | null
  id: string | null
  onSelect: (type: BucketKey, id: string) => void
  onBack?: () => void
}

function capitalize(s: string | null | undefined): string {
  if (!s) return '—'
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Section title i18n keys — shared across the member / training / game detail
// views (each renders a subset of these sections).
const SECTION_LABEL_KEY: Record<SectionKey, string> = {
  participations: 'explorerSectionParticipations',
  absences: 'explorerSectionAbsences',
  refereeExpenses: 'explorerSectionRefereeExpenses',
  scorerDelegations: 'explorerSectionScorerDelegations',
  hallSlots: 'explorerSectionHallSlots',
  inactiveMembers: 'explorerSectionInactiveMembers',
}

export default function ExplorerDetail({ cache, type, id, onSelect, onBack }: Props) {
  const onNavigate = onSelect
  const { t } = useTranslation('admin')
  const { t: tCommon } = useTranslation('common')
  const related = useRelatedEntities()
  const { isGlobalAdmin, isVorstand, isVbAdmin, isBbAdmin, canImpersonate, isImpersonating, startImpersonation } = useAuth()
  const showRestrictedSections = isGlobalAdmin || isVorstand
  // Admin + Vorstand + sport admins get the inline edit affordance; Directus
  // policy makes the final call (PATCH 403s for everyone else even if the
  // button were shown — note Vorstand is read-only at the policy layer).
  const canEditMember = isGlobalAdmin || isVorstand || isVbAdmin || isBbAdmin

  const entity = useMemo(() => {
    if (!type || !id) return null
    switch (type) {
      case 'members': return cache.members.find((m) => String(m.id) === id) ?? null
      case 'teams': return cache.teams.find((tm) => String(tm.id) === id) ?? null
      case 'events': return cache.events.find((e) => String(e.id) === id) ?? null
      case 'trainings': return cache.trainings.find((tr) => String(tr.id) === id) ?? null
      case 'games': return cache.games.find((g) => String(g.id) === id) ?? null
    }
  }, [cache, type, id])

  if (!type || !id || !entity) {
    return (
      <div className="flex h-full items-center justify-center px-4 py-8 text-center text-muted-foreground">
        {t('explorerEmptyState')}
      </div>
    )
  }

  // 2026-05-12 audit #18: pin `type` to the explorer's known buckets before
  // building the Directus admin URL. The switch above already guarantees
  // `entity` is null for unknown types, but the explicit allow-list is a
  // cheap forecloses future API responses where `type` could carry
  // path-traversal chars.
  const ALLOWED_TYPES = new Set(['members', 'teams', 'events', 'trainings', 'games'])
  if (!ALLOWED_TYPES.has(type)) return null
  const directusUrl = `${API_URL}/admin/content/${encodeURIComponent(type)}/${encodeURIComponent(id)}`
  const title = titleFor(type, entity, cache)

  return (
    <div className="h-full overflow-y-auto px-4 py-3 md:px-6 md:py-4">
      {/* Mobile back */}
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mb-2 text-sm text-muted-foreground hover:text-foreground md:hidden"
        >
          ← {t('explorerBackToTree')}
        </button>
      )}

      {/* Title + directus link */}
      <h1 className="text-xl font-bold text-primary">{title}</h1>
      <div className="mb-4 flex items-center gap-3 text-xs text-muted-foreground">
        <span>{t(`explorerBucket${type.charAt(0).toUpperCase()}${type.slice(1)}` as never)} · #{id}</span>
        <a
          href={directusUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded border border-primary px-2 py-0.5 text-primary hover:bg-primary hover:text-primary-foreground"
        >
          <ExternalLink className="h-3 w-3" />
          {t('explorerOpenInDirectus')}
        </a>
        {type === 'members' && canImpersonate && !isImpersonating && (
          <button
            type="button"
            onClick={() => { void startImpersonation(String(id)) }}
            className="inline-flex items-center gap-1 rounded border border-orange-500 px-2 py-0.5 text-orange-600 hover:bg-orange-500 hover:text-white dark:text-orange-400"
          >
            <Eye className="h-3 w-3" />
            {t('explorerViewAsMember')}
          </button>
        )}
      </div>

      {/* Fields + sections per type */}
      {type === 'members' && renderMember(entity as never, cache, onNavigate, related, t, showRestrictedSections, canEditMember)}
      {type === 'teams' && renderTeam(entity as never, cache, onNavigate, related, t, tCommon)}
      {type === 'events' && renderEvent(entity as never, cache, onNavigate, related, t)}
      {type === 'trainings' && renderTraining(entity as never, cache, onNavigate, related, t)}
      {type === 'games' && renderGame(entity as never, cache, onNavigate, related, t, showRestrictedSections)}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 py-0.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-words text-foreground">{children}</span>
    </div>
  )
}

function titleFor(type: BucketKey, entity: Record<string, unknown>, cache: CacheShape): string {
  const teamName = (tid: string) => cache.teams.find((tm) => String(tm.id) === tid)?.name ?? tid
  switch (type) {
    case 'members': return memberLabel(entity as never)
    case 'teams': return teamLabel(entity as never)
    case 'events': return eventLabel(entity as never)
    case 'trainings': return trainingLabel(entity as never, teamName)
    case 'games': return gameLabel(entity as never, teamName)
  }
}

type TFn = (key: string, opts?: Record<string, unknown>) => string

// ── Compact table skeleton ─────────────────────────────────────────────
interface ColDef {
  key: string
  label: string
  className?: string
}

function CompactTable({
  cols,
  rows,
}: {
  cols: ColDef[]
  rows: React.ReactNode[][]
}) {
  return (
    <Table className="text-xs">
      <TableHeader>
        <TableRow className="text-left text-muted-foreground hover:bg-transparent">
          {cols.map((c) => (
            <TableHead key={c.key} className={`h-auto px-0 py-1 pr-3 font-medium ${c.className ?? ''}`}>
              {c.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody className="text-foreground">
        {rows.map((cells, i) => (
          <TableRow key={i}>
            {cells.map((cell, j) => (
              <TableCell key={j} className={`p-0 py-1 pr-3 ${cols[j]?.className ?? ''}`}>
                {cell}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function NavBtn({
  type,
  id,
  label,
  onClick,
}: {
  type: BucketKey
  id: string
  label: string
  onClick: (type: BucketKey, id: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(type, id)}
      className="text-primary hover:underline text-left"
    >
      {label}
    </button>
  )
}

// ── Member ────────────────────────────────────────────────────────────
function renderMember(
  m: Record<string, unknown> & { id: string | number },
  cache: CacheShape,
  onNavigate: Props['onSelect'],
  related: ReturnType<typeof useRelatedEntities>,
  t: TFn,
  showRestrictedSections: boolean,
  canEditMember: boolean,
) {
  const memberIdStr = String(m.id)
  // Union of all team associations: player + coach + team-responsible + captain
  const relations = new Map<string, Set<string>>()
  const addRelation = (teamId: string, label: string) => {
    const set = relations.get(teamId) ?? new Set<string>()
    set.add(label)
    relations.set(teamId, set)
  }
  for (const tid of cache.memberTeams.get(memberIdStr) ?? []) addRelation(tid, t('explorerRelationPlayer'))
  for (const tid of cache.memberCoachTeams.get(memberIdStr) ?? []) addRelation(tid, t('explorerFieldCoach'))
  for (const tid of cache.memberTrTeams.get(memberIdStr) ?? []) addRelation(tid, t('explorerFieldTeamResponsible'))
  for (const tm of cache.teams) {
    if (String((tm as unknown as { captain?: unknown }).captain) === memberIdStr) {
      addRelation(String(tm.id), t('explorerFieldCaptain'))
    }
  }
  const memberTeams = [...relations.keys()]
    .map((tid) => cache.teams.find((x) => String(x.id) === tid) ?? null)
    .filter((x): x is NonNullable<typeof x> => x !== null)

  // Vorstand can read absences/participations but not referee_expenses
  const memberSections: SectionKey[] = showRestrictedSections
    ? ['participations', 'absences', 'refereeExpenses']
    : ['participations', 'absences']

  const teamName = (tid: string) => cache.teams.find((x) => String(x.id) === tid)?.name ?? tid

  return (
    <>
      {/* Full-fields view: every readable column, admin-editable inline */}
      <ExplorerMemberFields
        memberId={memberIdStr}
        canEdit={canEditMember}
        reloadKey={cache.loadedAt ?? undefined}
      />

      {/* Teams table */}
      <ExplorerSectionCard title={t('explorerSectionTeams')} count={memberTeams.length} lazy={false}>
        <CompactTable
          cols={[
            { key: 'name', label: t('explorerColName') },
            { key: 'sport', label: t('explorerFieldSport') },
            { key: 'season', label: t('explorerFieldSeason') },
            { key: 'relation', label: t('explorerColRelation') },
          ]}
          rows={memberTeams.map((tm) => [
            <NavBtn type="teams" id={String(tm.id)} label={teamLabel(tm)} onClick={onNavigate} />,
            capitalize(String(tm.sport ?? '')) || '—',
            String(tm.season ?? '—'),
            [...(relations.get(String(tm.id)) ?? [])].join(', ') || '—',
          ])}
        />
      </ExplorerSectionCard>

      {memberSections.map((s) => {
        const state = related.get('members', String(m.id), s)
        return (
          <ExplorerSectionCard
            key={s}
            title={t(SECTION_LABEL_KEY[s])}
            count={state?.data.length ?? null}
            onExpand={() => related.load('members', String(m.id), s)}
            isLoading={state?.loading}
            error={state?.error}
          >
            {s === 'participations' && renderMemberParticipationsTable(state?.data ?? [], cache, onNavigate, teamName, t)}
            {s === 'absences' && renderAbsencesTable(state?.data ?? [], t)}
            {s === 'refereeExpenses' && renderRefereeExpensesTable(state?.data ?? [], t)}
          </ExplorerSectionCard>
        )
      })}
    </>
  )
}

function renderMemberParticipationsTable(
  rows: unknown[],
  cache: CacheShape,
  onNavigate: (type: BucketKey, id: string) => void,
  teamName: (tid: string) => string,
  t: TFn,
) {
  return (
    <CompactTable
      cols={[
        { key: 'activity', label: t('explorerColActivity') },
        { key: 'date', label: t('explorerFieldDate') },
        { key: 'status', label: t('explorerFieldStatus') },
      ]}
      rows={rows.map((row) => {
        const r = row as { activity_type?: string; activity_id?: unknown; status?: string }
        const rawType = String(r.activity_type ?? '')
        const bucketType = (rawType + 's') as BucketKey
        const activityId = String(r.activity_id ?? '')
        const validBuckets: BucketKey[] = ['events', 'trainings', 'games']

        // Singular type label used in fallback rendering when entity is not in the page-load cache
        const typeLabelKey: Partial<Record<BucketKey, string>> = {
          events: 'explorerActivityEvent',
          trainings: 'explorerActivityTraining',
          games: 'explorerActivityGame',
        }
        const typeLabel = typeLabelKey[bucketType] ? t(typeLabelKey[bucketType] as string) : ''

        let entityFound = false
        let activityLabel = typeLabel ? `${typeLabel} #${activityId}` : `#${activityId}`
        let activityDate = ''
        if (bucketType === 'events') {
          const ev = cache.events.find((e) => String(e.id) === activityId)
          if (ev) { entityFound = true; activityLabel = eventLabel(ev); activityDate = formatShortDate(ev.start_date) }
        } else if (bucketType === 'trainings') {
          const tr = cache.trainings.find((x) => String(x.id) === activityId)
          if (tr) { entityFound = true; activityLabel = trainingLabel(tr, teamName); activityDate = formatShortDate(tr.date) }
        } else if (bucketType === 'games') {
          const g = cache.games.find((x) => String(x.id) === activityId)
          if (g) { entityFound = true; activityLabel = gameLabel(g, teamName); activityDate = formatShortDate(g.date) }
        }

        const activityCell = entityFound && validBuckets.includes(bucketType)
          ? <NavBtn type={bucketType} id={activityId} label={activityLabel} onClick={onNavigate} />
          : <span className="text-muted-foreground italic">{activityLabel} {t('explorerActivityRemoved')}</span>

        const status = r.status ?? ''
        const statusLabel = ['confirmed', 'declined', 'tentative', 'waitlisted'].includes(status)
          ? t(`explorerStatus_${status}`)
          : (status ? capitalize(status) : '—')

        return [activityCell, activityDate || '—', statusLabel]
      })}
    />
  )
}

function renderAbsencesTable(rows: unknown[], t: TFn) {
  return (
    <CompactTable
      cols={[
        { key: 'start', label: t('explorerFieldStartDate') },
        { key: 'end', label: t('explorerFieldEndDate') },
        { key: 'reason', label: t('explorerColReason') },
      ]}
      rows={rows.map((row) => {
        const r = row as { start_date?: string; end_date?: string; reason?: string; reason_detail?: string }
        const reason = r.reason_detail ? `${r.reason ?? ''} — ${r.reason_detail}` : (r.reason ?? '—')
        return [
          formatShortDate(r.start_date) || '—',
          formatShortDate(r.end_date) || '—',
          reason,
        ]
      })}
    />
  )
}

function renderRefereeExpensesTable(rows: unknown[], t: TFn) {
  return (
    <CompactTable
      cols={[
        { key: 'date', label: t('explorerFieldDate') },
        { key: 'amount', label: t('explorerColAmount') },
        { key: 'notes', label: t('explorerColNotes') },
      ]}
      rows={rows.map((row) => {
        const r = row as { date_created?: string; amount?: number; notes?: string }
        const notesRaw = r.notes ?? ''
        const notes = notesRaw.length > 60 ? notesRaw.slice(0, 60) + '…' : notesRaw || '—'
        return [
          formatShortDate(r.date_created) || '—',
          r.amount != null ? `CHF ${r.amount.toFixed(2)}` : '—',
          notes,
        ]
      })}
    />
  )
}

// ── Team ──────────────────────────────────────────────────────────────
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

function renderTeam(
  tm: Record<string, unknown> & { id: string | number },
  cache: CacheShape,
  onNavigate: Props['onSelect'],
  related: ReturnType<typeof useRelatedEntities>,
  t: TFn,
  tCommon: TFn,
) {
  const tmId = String(tm.id)
  const members = cache.members.filter((m) =>
    (cache.memberTeams.get(String(m.id)) ?? []).includes(tmId),
  )
  const trainings = cache.trainings.filter((tr) => String((tr as unknown as { team?: unknown }).team) === tmId)
  const games = cache.games.filter((g) =>
    String((g as unknown as { home_team?: unknown }).home_team) === tmId ||
    String((g as unknown as { away_team?: unknown }).away_team) === tmId,
  )

  const teamName = (tid: string) => cache.teams.find((x) => String(x.id) === tid)?.name ?? tid

  // Staff from the page-load junctions (teams_coaches / teams_responsibles).
  // Reverse-lookup so player-coaches surface here too, regardless of roster.
  const coachIds = [...cache.memberCoachTeams.entries()]
    .filter(([, tids]) => tids.includes(tmId))
    .map(([mid]) => mid)
  const trIds = [...cache.memberTrTeams.entries()]
    .filter(([, tids]) => tids.includes(tmId))
    .map(([mid]) => mid)
  const captainRaw = (tm as unknown as { captain?: unknown }).captain
  const captainIds = (Array.isArray(captainRaw) ? captainRaw : captainRaw != null ? [captainRaw] : [])
    .map((c) => String(c))
    .filter((c) => c && c !== 'null')

  const memberChips = (ids: string[]): React.ReactNode => {
    if (ids.length === 0) return '—'
    return (
      <span className="inline-flex flex-wrap gap-x-2 gap-y-0.5">
        {ids.map((mid) => {
          const mem = cache.members.find((x) => String(x.id) === mid)
          return mem
            ? <NavBtn key={mid} type="members" id={mid} label={memberLabel(mem)} onClick={onNavigate} />
            : <span key={mid}>#{mid}</span>
        })}
      </span>
    )
  }

  const slotState = related.get('teams', tmId, 'hallSlots')
  const inactiveState = related.get('teams', tmId, 'inactiveMembers')

  return (
    <>
      <div className="mb-4">
        <Field label={t('explorerFieldSport')}>{capitalize(String(tm.sport ?? ''))}</Field>
        <Field label={t('explorerFieldLeague')}>{String(tm.league || '—')}</Field>
        <Field label={t('explorerFieldSeason')}>{String(tm.season ?? '—')}</Field>
        <Field label={t('explorerFieldActive')}>{tm.active ? '✓' : '—'}</Field>
        <Field label={t('explorerFieldCoach')}>{memberChips(coachIds)}</Field>
        <Field label={t('explorerFieldTeamResponsible')}>{memberChips(trIds)}</Field>
        <Field label={t('explorerFieldCaptain')}>{memberChips(captainIds)}</Field>
      </div>

      {/* Hall slots (lazy) */}
      <ExplorerSectionCard
        title={t('explorerSectionHallSlots')}
        count={slotState?.data.length ?? null}
        onExpand={() => related.load('teams', tmId, 'hallSlots')}
        isLoading={slotState?.loading}
        error={slotState?.error}
      >
        {renderHallSlotsTable(slotState?.data ?? [], t, tCommon)}
      </ExplorerSectionCard>

      {/* Members table (current active roster, from page-load cache). The Role
          column derives each member's capacity on THIS team from the coach/TR
          junctions + captain FK already loaded — so a player-coach reads
          "Player, Coach" instead of looking like a plain player. */}
      <ExplorerSectionCard title={t('explorerSectionMembers')} count={members.length} lazy={false}>
        <CompactTable
          cols={[
            { key: 'name', label: t('explorerColName') },
            { key: 'nr', label: t('explorerColNumber') },
            { key: 'role', label: t('explorerColRole') },
          ]}
          rows={members.map((mem) => {
            const memAny = mem as unknown as { number?: number }
            const mid = String(mem.id)
            const roles = [t('explorerRelationPlayer')]
            if (coachIds.includes(mid)) roles.push(t('explorerFieldCoach'))
            if (trIds.includes(mid)) roles.push(t('explorerFieldTeamResponsible'))
            if (captainIds.includes(mid)) roles.push(t('explorerFieldCaptain'))
            return [
              <NavBtn type="members" id={mid} label={memberLabel(mem)} onClick={onNavigate} />,
              memAny.number != null ? String(memAny.number) : '—',
              roles.join(', '),
            ]
          })}
        />
      </ExplorerSectionCard>

      {/* Inactive members (lazy) — deactivated members still on the roster */}
      <ExplorerSectionCard
        title={t('explorerSectionInactiveMembers')}
        count={inactiveState?.data.length ?? null}
        onExpand={() => related.load('teams', tmId, 'inactiveMembers')}
        isLoading={inactiveState?.loading}
        error={inactiveState?.error}
      >
        {renderInactiveMembersTable(inactiveState?.data ?? [], t)}
      </ExplorerSectionCard>

      {/* Trainings table */}
      <ExplorerSectionCard title={t('explorerBucketTrainings')} count={trainings.length} lazy={false}>
        <CompactTable
          cols={[
            { key: 'date', label: t('explorerFieldDate') },
            { key: 'time', label: t('explorerFieldTime') },
            { key: 'hall', label: t('explorerFieldHall') },
          ]}
          rows={trainings.slice(0, 50).map((tr) => {
            const trAny = tr as unknown as { id: string | number; date?: string; start_time?: string; end_time?: string; hall?: string }
            return [
              <NavBtn
                type="trainings"
                id={String(trAny.id)}
                label={formatShortDate(trAny.date ?? '') || trainingLabel(tr as never, teamName)}
                onClick={onNavigate}
              />,
              `${(trAny.start_time ?? '').slice(0, 5)} – ${(trAny.end_time ?? '').slice(0, 5)}`.trim(),
              trAny.hall ?? '—',
            ]
          })}
        />
      </ExplorerSectionCard>

      {/* Games table */}
      <ExplorerSectionCard title={t('explorerBucketGames')} count={games.length} lazy={false}>
        <CompactTable
          cols={[
            { key: 'date', label: t('explorerFieldDate') },
            { key: 'time', label: t('explorerFieldTime') },
            { key: 'home', label: t('explorerFieldHomeTeam') },
            { key: 'away', label: t('explorerFieldAwayTeam') },
            { key: 'result', label: t('explorerFieldResult') },
            { key: 'hall', label: t('explorerFieldHall') },
          ]}
          rows={games.slice(0, 50).map((g) => {
            const gAny = g as unknown as {
              id: string | number; date?: string; time?: string
              home_team?: unknown; away_team?: unknown
              home_score?: number; away_score?: number; hall?: string
            }
            const homeTeam = cache.teams.find((x) => String(x.id) === String(gAny.home_team))
            const awayTeam = cache.teams.find((x) => String(x.id) === String(gAny.away_team))
            return [
              <NavBtn type="games" id={String(gAny.id)} label={formatShortDate(gAny.date ?? '') || '—'} onClick={onNavigate} />,
              (gAny.time ?? '—').toString().slice(0, 5),
              homeTeam ? teamLabel(homeTeam) : `#${String(gAny.home_team)}`,
              awayTeam ? teamLabel(awayTeam) : `#${String(gAny.away_team)}`,
              `${gAny.home_score ?? '-'} : ${gAny.away_score ?? '-'}`,
              gAny.hall ?? '—',
            ]
          })}
        />
      </ExplorerSectionCard>
    </>
  )
}

function renderHallSlotsTable(rows: unknown[], t: TFn, tCommon: TFn) {
  if (rows.length === 0) return <div className="text-xs text-muted-foreground">—</div>
  return (
    <CompactTable
      cols={[
        { key: 'day', label: t('explorerColDay') },
        { key: 'time', label: t('explorerFieldTime') },
        { key: 'hall', label: t('explorerFieldHall') },
        { key: 'type', label: t('explorerColType') },
      ]}
      rows={rows.map((row) => {
        const r = row as {
          day_of_week?: number; start_time?: string; end_time?: string
          slot_type?: string; hall?: { name?: string } | string | null
        }
        const dayIdx = Number(r.day_of_week)
        const dayLabel = dayIdx >= 0 && dayIdx <= 6 ? tCommon(DAY_KEYS[dayIdx]) : '—'
        const start = (r.start_time ?? '').slice(0, 5)
        const end = (r.end_time ?? '').slice(0, 5)
        const time = start || end ? `${start}–${end}` : '—'
        const hallName = (r.hall && typeof r.hall === 'object' ? r.hall.name : undefined) ?? '—'
        return [dayLabel, time, hallName, capitalize(r.slot_type)]
      })}
    />
  )
}

function renderInactiveMembersTable(rows: unknown[], t: TFn) {
  if (rows.length === 0) return <div className="text-xs text-muted-foreground">—</div>
  // Inactive members aren't in the page-load cache, so render as plain text —
  // navigating to them would land on an empty detail panel.
  return (
    <CompactTable
      cols={[
        { key: 'name', label: t('explorerColName') },
        { key: 'nr', label: t('explorerColNumber') },
      ]}
      rows={rows.map((row) => {
        const r = row as {
          member?: { first_name?: string; last_name?: string; nickname?: string | null; number?: number } | string | null
          guest_level?: number
        }
        const mem = r.member && typeof r.member === 'object' ? r.member : null
        const name = mem
          ? `${mem.last_name ?? ''}, ${mem.nickname || mem.first_name || ''}`.trim().replace(/^,\s*/, '').replace(/,\s*$/, '')
          : '—'
        const guest = Number(r.guest_level) > 0 ? ` (G${Number(r.guest_level)})` : ''
        return [
          <span>{name || '—'}{guest && <span className="text-muted-foreground">{guest}</span>}</span>,
          mem?.number != null ? String(mem.number) : '—',
        ]
      })}
    />
  )
}

/** Group participation rows by status. */
function byStatus(rows: unknown[]): Record<string, unknown[]> {
  const g: Record<string, unknown[]> = { confirmed: [], declined: [], tentative: [], waitlisted: [] }
  rows.forEach((r) => {
    const status = (r as { status?: string }).status ?? 'other'
    ;(g[status] ??= []).push(r)
  })
  return g
}

/** Render grouped participation rows as compact tables (for events, trainings, games). */
function renderGroupedParticipations(
  rows: unknown[],
  cache: CacheShape,
  onNavigate: (type: BucketKey, id: string) => void,
  t: TFn,
) {
  const groups = byStatus(rows)
  const ORDER = ['confirmed', 'declined', 'tentative', 'waitlisted', 'other']
  return (
    <>
      {ORDER.map((status) => {
        const statusRows = groups[status] ?? []
        if (statusRows.length === 0) return null
        return (
          <div key={status} className="mb-3">
            <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
              {t(`explorerStatus_${status}`)} · {statusRows.length}
            </div>
            <CompactTable
              cols={[
                { key: 'member', label: t('explorerColName') },
                { key: 'note', label: t('explorerColNote') },
              ]}
              rows={statusRows.map((row) => {
                const r = row as { id?: string | number; member?: unknown; note?: string }
                const memberId = String(r.member ?? '')
                const member = cache.members.find((mem) => String(mem.id) === memberId)
                const label = member ? memberLabel(member) : `#${memberId}`
                const noteRaw = r.note ?? ''
                const note = noteRaw.length > 40 ? noteRaw.slice(0, 40) + '…' : noteRaw || '—'
                return [
                  <NavBtn type="members" id={memberId} label={label} onClick={onNavigate} />,
                  note,
                ]
              })}
            />
          </div>
        )
      })}
    </>
  )
}

// ── Event ─────────────────────────────────────────────────────────────
function renderEvent(
  e: Record<string, unknown> & { id: string | number },
  cache: CacheShape,
  onNavigate: Props['onSelect'],
  related: ReturnType<typeof useRelatedEntities>,
  t: TFn,
) {
  const state = related.get('events', String(e.id), 'participations')
  return (
    <>
      <div className="mb-4">
        <Field label={t('explorerFieldStartDate')}>{formatShortDateTime(e.start_date as string | null) || '—'}</Field>
        <Field label={t('explorerFieldEndDate')}>{formatShortDateTime(e.end_date as string | null) || '—'}</Field>
        <Field label={t('explorerFieldEventType')}>{String(e.event_type ?? '—')}</Field>
        <Field label={t('explorerFieldParticipationMode')}>{String(e.participation_mode ?? '—')}</Field>
      </div>
      <ExplorerSectionCard
        title={t('explorerSectionParticipations')}
        count={state?.data.length ?? null}
        onExpand={() => related.load('events', String(e.id), 'participations')}
        isLoading={state?.loading}
        error={state?.error}
      >
        {renderGroupedParticipations(state?.data ?? [], cache, onNavigate, t)}
      </ExplorerSectionCard>
    </>
  )
}

// ── Training ──────────────────────────────────────────────────────────
function renderTraining(
  tr: Record<string, unknown> & { id: string | number },
  cache: CacheShape,
  onNavigate: Props['onSelect'],
  related: ReturnType<typeof useRelatedEntities>,
  t: TFn,
) {
  const team = cache.teams.find((tm) => String(tm.id) === String(tr.team))

  return (
    <>
      <div className="mb-4">
        {team && (
          <Field label={t('explorerFieldTeam')}>
            <NavBtn type="teams" id={String(team.id)} label={teamLabel(team)} onClick={onNavigate} />
          </Field>
        )}
        <Field label={t('explorerFieldDate')}>{formatShortDate(tr.date as string | null) || '—'}</Field>
        <Field label={t('explorerFieldTime')}>{`${(String(tr.start_time ?? '')).slice(0, 5)} – ${(String(tr.end_time ?? '')).slice(0, 5)}`}</Field>
        <Field label={t('explorerFieldHall')}>{String(tr.hall ?? '—')}</Field>
      </div>
      {(['participations'] as SectionKey[]).map((s) => {
        const state = related.get('trainings', String(tr.id), s)
        return (
          <ExplorerSectionCard
            key={s}
            title={t(SECTION_LABEL_KEY[s])}
            count={state?.data.length ?? null}
            onExpand={() => related.load('trainings', String(tr.id), s)}
            isLoading={state?.loading}
            error={state?.error}
          >
            {renderGroupedParticipations(state?.data ?? [], cache, onNavigate, t)}
          </ExplorerSectionCard>
        )
      })}
    </>
  )
}

// ── Game ──────────────────────────────────────────────────────────────
function renderGame(
  g: Record<string, unknown> & { id: string | number },
  cache: CacheShape,
  onNavigate: Props['onSelect'],
  related: ReturnType<typeof useRelatedEntities>,
  t: TFn,
  showRestrictedSections: boolean,
) {
  const home = cache.teams.find((tm) => String(tm.id) === String(g.home_team))
  const away = cache.teams.find((tm) => String(tm.id) === String(g.away_team))
  const sectionKeys: SectionKey[] = showRestrictedSections
    ? ['participations', 'scorerDelegations']
    : ['participations']

  // Scoring duties — fields on the game record itself
  const DUTY_FIELDS: { field: string; labelKey: string }[] = [
    { field: 'scorer_member',           labelKey: 'explorerDutyScorer' },
    { field: 'scoreboard_member',       labelKey: 'explorerDutyScoreboard' },
    { field: 'scorer_scoreboard_member',labelKey: 'explorerDutyScorerScoreboard' },
    { field: 'bb_scorer_member',        labelKey: 'explorerDutyBbScorer' },
    { field: 'bb_timekeeper_member',    labelKey: 'explorerDutyBbTimekeeper' },
    { field: 'bb_24s_official',         labelKey: 'explorerDutyBb24s' },
  ]
  const dutyRows = DUTY_FIELDS.flatMap(({ field, labelKey }) => {
    const raw = g[field]
    if (raw == null || raw === '' || raw === 0) return []
    const memberId = String(raw)
    const member = cache.members.find((m) => String(m.id) === memberId)
    const memberCell = member
      ? <NavBtn type="members" id={memberId} label={memberLabel(member)} onClick={onNavigate} />
      : <span>{`#${memberId}`}</span>
    return [[t(labelKey), memberCell] as React.ReactNode[]]
  })

  return (
    <>
      <div className="mb-4">
        <Field label={t('explorerFieldHomeTeam')}>
          {home ? <NavBtn type="teams" id={String(home.id)} label={teamLabel(home)} onClick={onNavigate} /> : `#${String(g.home_team)}`}
        </Field>
        <Field label={t('explorerFieldAwayTeam')}>
          {away ? <NavBtn type="teams" id={String(away.id)} label={teamLabel(away)} onClick={onNavigate} /> : `#${String(g.away_team)}`}
        </Field>
        <Field label={t('explorerFieldDate')}>{formatShortDate(g.date as string | null) || '—'}</Field>
        <Field label={t('explorerFieldTime')}>{String(g.time ?? '—')}</Field>
        <Field label={t('explorerFieldHall')}>{String(g.hall ?? '—')}</Field>
        <Field label={t('explorerFieldResult')}>
          {`${String(g.home_score ?? '-')} : ${String(g.away_score ?? '-')}`}
        </Field>
      </div>

      {/* Scoring duties — inline from game record fields */}
      {dutyRows.length > 0 && (
        <ExplorerSectionCard title={t('explorerSectionScoringDuties')} lazy={false}>
          <CompactTable
            cols={[
              { key: 'role', label: t('explorerColRole') },
              { key: 'member', label: t('explorerColName') },
            ]}
            rows={dutyRows}
          />
        </ExplorerSectionCard>
      )}

      {sectionKeys.map((s) => {
        const state = related.get('games', String(g.id), s)
        return (
          <ExplorerSectionCard
            key={s}
            title={t(SECTION_LABEL_KEY[s])}
            count={state?.data.length ?? null}
            onExpand={() => related.load('games', String(g.id), s)}
            isLoading={state?.loading}
            error={state?.error}
          >
            {s === 'participations' && renderGroupedParticipations(state?.data ?? [], cache, onNavigate, t)}
            {s === 'scorerDelegations' && renderScorerDelegationsTable(state?.data ?? [], cache, onNavigate, t)}
          </ExplorerSectionCard>
        )
      })}
    </>
  )
}

function renderScorerDelegationsTable(
  rows: unknown[],
  cache: CacheShape,
  onNavigate: (type: BucketKey, id: string) => void,
  t: TFn,
) {
  return (
    <CompactTable
      cols={[
        { key: 'original', label: t('explorerColOriginal') },
        { key: 'delegatedTo', label: t('explorerColDelegatedTo') },
        { key: 'date', label: t('explorerFieldDate') },
      ]}
      rows={rows.map((row) => {
        const r = row as { from_member?: unknown; to_member?: unknown; date_created?: string }
        const fromId = String(r.from_member ?? '')
        const toId = String(r.to_member ?? '')
        const fromMember = cache.members.find((m) => String(m.id) === fromId)
        const toMember = cache.members.find((m) => String(m.id) === toId)
        const fromLabel = fromMember ? memberLabel(fromMember) : `#${fromId}`
        const toLabel = toMember ? memberLabel(toMember) : `#${toId}`
        return [
          <NavBtn type="members" id={fromId} label={fromLabel} onClick={onNavigate} />,
          <NavBtn type="members" id={toId} label={toLabel} onClick={onNavigate} />,
          formatShortDate(r.date_created) || '—',
        ]
      })}
    />
  )
}
