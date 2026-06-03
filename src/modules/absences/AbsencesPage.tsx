import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardList, Upload, CalendarClock, ChevronDown, ChevronRight } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useAdminMode } from '../../hooks/useAdminMode'
import { useCollection } from '../../lib/query'
import { useMutation } from '../../hooks/useMutation'
import { useRealtime } from '../../hooks/useRealtime'
import { relId, asObj } from '../../utils/relations'
import { useTeamAbsences } from '../../hooks/useTeamAbsences'
import TeamMultiSelect from '../../components/TeamMultiSelect'
import { teamNameToColorKey } from '../../utils/teamColors'
import EmptyState from '../../components/EmptyState'
import ConfirmDialog from '@/components/ConfirmDialog'
import AbsenceCard from './AbsenceCard'
import AbsenceForm from './AbsenceForm'
import AbsenceImportModal from './AbsenceImportModal'
import TeamAbsenceView from './TeamAbsenceView'
import AbsenceMemberFilter from './AbsenceMemberFilter'
import { buildMemberOptions } from './absenceMemberOptions'
import WeeklyUnavailabilityCard from './WeeklyUnavailabilityCard'
import WeeklyUnavailabilityForm from './WeeklyUnavailabilityForm'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import WeeklyDayHeaderCells from './WeeklyDayHeaderCells'
import TabBar from '../../components/TabBar'
import type { Absence, Member, Team } from '../../types'
import { TourPageButton } from '../guide/TourPageButton'

type ViewType = 'absences' | 'weekly'
type Scope = 'mine' | 'team'

export default function AbsencesPage() {
  const { t } = useTranslation('absences')
  const { user, isCoach, memberTeamIds, coachTeamIds } = useAuth()
  const { effectiveIsAdmin, effectiveIsCoach, effectiveIsVorstand } = useAdminMode()
  const [viewType, setViewType] = useState<ViewType>('absences')
  const [scope, setScope] = useState<Scope>('mine')
  const [selectedTeams, setSelectedTeams] = useState<string[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editingAbsence, setEditingAbsence] = useState<Absence | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [weeklyFormOpen, setWeeklyFormOpen] = useState(false)
  const [editingWeekly, setEditingWeekly] = useState<Absence | null>(null)
  const [showOlder, setShowOlder] = useState(false)

  const { data: allTeamsRaw } = useCollection<Team>('teams', { filter: { active: { _eq: true } }, sort: ['name'], limit: 50 })
  const allTeams = useMemo(() => allTeamsRaw ?? [], [allTeamsRaw])

  const visibleTeamIds = useMemo(() => {
    if (effectiveIsAdmin || effectiveIsVorstand) return undefined
    return [...new Set([...memberTeamIds, ...coachTeamIds])]
  }, [effectiveIsAdmin, effectiveIsVorstand, memberTeamIds, coachTeamIds])

  const effectiveTeamIds = useMemo(() => {
    if (selectedTeams.length > 0) return selectedTeams
    if (visibleTeamIds) return visibleTeamIds
    return allTeams.map((t) => t.id)
  }, [selectedTeams, visibleTeamIds, allTeams])

  // Options for the multi-team filter (admins see all active teams; coaches/members
  // are limited to their own). Mirrors TeamFilter's option-building.
  const teamFilterOptions = useMemo(() => {
    const base = visibleTeamIds
      ? allTeams.filter((tm) => visibleTeamIds.includes(tm.id))
      : allTeams
    return base
      .filter((tm) => tm.sport === 'volleyball' || tm.sport === 'basketball')
      .map((tm) => ({ value: tm.id, label: tm.name, colorKey: teamNameToColorKey(tm.name, tm.sport) }))
  }, [allTeams, visibleTeamIds])

  // ── Personal absences (excludes weekly) ────────────────────────
  const { data: myAbsencesRaw, refetch } = useCollection<Absence>('absences', {
    filter: user ? { _and: [{ member: { _eq: user.id } }, { _or: [{ type: { _null: true } }, { type: { _neq: 'weekly' } }] }] } : { id: { _eq: -1 } },
    sort: ['-start_date'],
    limit: 50,
    fields: ['*', 'member.*'],
  })
  const myAbsences = myAbsencesRaw ?? []
  const today = new Date().toISOString().slice(0, 10)
  const upcomingAbsences = myAbsences.filter((a) => (a.end_date ?? '9999-12-31') >= today)
  const pastAbsences = myAbsences.filter((a) => a.end_date && a.end_date < today)

  // ── Personal weeklies ──────────────────────────────────────────
  const { data: myWeeklyRaw, refetch: refetchWeekly } = useCollection<Absence>('absences', {
    filter: user ? { _and: [{ member: { _eq: user.id } }, { type: { _eq: 'weekly' } }] } : { id: { _eq: -1 } },
    sort: ['-start_date'],
    limit: 50,
    fields: ['*', 'member.*'],
  })
  const myWeekly = myWeeklyRaw ?? []

  const { remove } = useMutation<Absence>('absences')

  useRealtime('absences', () => {
    refetch()
    refetchWeekly()
  })

  async function handleDelete() {
    if (!deletingId) return
    await remove(deletingId)
    setDeletingId(null)
    refetch()
    refetchWeekly()
  }

  function handleEdit(absence: Absence) {
    setEditingAbsence(absence)
    setFormOpen(true)
  }

  function handleFormSave() {
    setFormOpen(false)
    setEditingAbsence(null)
    refetch()
  }

  function handleWeeklyEdit(absence: Absence) {
    setEditingWeekly(absence)
    setWeeklyFormOpen(true)
  }

  function handleWeeklyFormSave() {
    setWeeklyFormOpen(false)
    setEditingWeekly(null)
    refetchWeekly()
  }

  const hasTeams = memberTeamIds.length > 0 || coachTeamIds.length > 0 || effectiveIsAdmin
  const isTeamScope = scope === 'team' && hasTeams
  const isCoachOrResponsible = coachTeamIds.length > 0 || effectiveIsCoach || effectiveIsAdmin || effectiveIsVorstand
  const canCreateForTeam = isTeamScope && isCoachOrResponsible
  const canEditOwn = (a: Absence) => relId(a.member) === String(user?.id) || isCoach || effectiveIsCoach

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900 sm:text-2xl dark:text-gray-100">{t('title')}</h1>
            <TourPageButton />
          </div>
        </div>
        <div className="flex gap-2">
          {viewType === 'absences' && scope === 'mine' && (
            <Button data-tour="import-absences" variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              {t('importAbsences')}
            </Button>
          )}
          {(scope === 'mine' || canCreateForTeam) && (
            viewType === 'weekly' ? (
              <Button onClick={() => { setEditingWeekly(null); setWeeklyFormOpen(true) }}>
                {isTeamScope ? t('newWeeklyForMember') : t('newWeekly')}
              </Button>
            ) : (
              <Button data-tour="new-absence" onClick={() => { setEditingAbsence(null); setFormOpen(true) }}>
                {isTeamScope ? t('newAbsenceForMember') : t('newAbsence')}
              </Button>
            )
          )}
        </div>
      </div>

      {/* Two-axis toggle: viewType (Absences | Unavailabilities) × scope (Mine | Team) */}
      <div className="mt-6 space-y-2">
        <TabBar
          tabs={[
            { key: 'absences' as const, label: t('viewAbsences') },
            { key: 'weekly' as const, label: t('viewUnavailabilities') },
          ]}
          active={viewType}
          onChange={setViewType}
        />
        {hasTeams && (
          <TabBar
            tabs={[
              { key: 'mine' as const, label: t('scopeMine') },
              { key: 'team' as const, label: t('scopeTeam') },
            ]}
            active={scope}
            onChange={setScope}
          />
        )}
      </div>

      {/* ─── Content quadrant ─── */}
      {!isTeamScope && viewType === 'absences' && (
        <div className="mt-6" data-tour="my-absences">
          {myAbsences.length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="h-10 w-10" />}
              title={t('noAbsences')}
              description={t('noAbsencesDescription')}
            />
          ) : (
            <div className="space-y-3">
              {upcomingAbsences.length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-gray-500 dark:text-gray-400">{t('colReason')}</TableHead>
                        <TableHead className="hidden md:table-cell text-gray-500 dark:text-gray-400">{t('colWhen')}</TableHead>
                        <TableHead className="hidden sm:table-cell text-gray-500 dark:text-gray-400">{t('colAffects')}</TableHead>
                        <TableHead className="w-32 text-right" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {upcomingAbsences.map((a) => (
                        <AbsenceCard key={a.id} absence={a} onEdit={handleEdit} onDelete={setDeletingId} canEdit={canEditOwn(a)} />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {upcomingAbsences.length === 0 && pastAbsences.length > 0 && (
                <p className="text-sm text-muted-foreground">{t('noUpcomingAbsences')}</p>
              )}
              {pastAbsences.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowOlder(!showOlder)}
                    className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
                  >
                    {showOlder ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    {t('showOlderAbsences', { count: pastAbsences.length })}
                  </button>
                  {showOlder && (
                    <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 mt-2">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-gray-500 dark:text-gray-400">{t('colReason')}</TableHead>
                            <TableHead className="hidden md:table-cell text-gray-500 dark:text-gray-400">{t('colWhen')}</TableHead>
                            <TableHead className="hidden sm:table-cell text-gray-500 dark:text-gray-400">{t('colAffects')}</TableHead>
                            <TableHead className="w-32 text-right" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pastAbsences.map((a) => (
                            <AbsenceCard key={a.id} absence={a} onEdit={handleEdit} onDelete={setDeletingId} canEdit={canEditOwn(a)} />
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!isTeamScope && viewType === 'weekly' && (
        <div className="mt-6" data-tour="weekly-unavailability">
          {myWeekly.length === 0 ? (
            <EmptyState
              icon={<CalendarClock className="h-10 w-10" />}
              title={t('noWeeklyAbsences')}
              description={t('noWeeklyAbsencesDescription')}
            />
          ) : (
            <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
              <Table>
                <TableHeader>
                  <TableRow>
                    <WeeklyDayHeaderCells />
                    <TableHead className="hidden md:table-cell text-gray-500 dark:text-gray-400">{t('colWhen')}</TableHead>
                    <TableHead className="hidden sm:table-cell text-gray-500 dark:text-gray-400">{t('colAffects')}</TableHead>
                    <TableHead className="w-32 text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myWeekly.map((a) => (
                    <WeeklyUnavailabilityCard
                      key={a.id}
                      absence={a}
                      onEdit={handleWeeklyEdit}
                      onDelete={setDeletingId}
                      canEdit={canEditOwn(a)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {isTeamScope && viewType === 'absences' && (
        <div className="mt-6" data-tour="team-absences">
          {teamFilterOptions.length > 0 && (
            <TeamMultiSelect
              options={teamFilterOptions}
              selected={selectedTeams}
              onChange={setSelectedTeams}
              placeholder={t('common:allTeams')}
            />
          )}
          <div className="mt-4">
            <TeamAbsenceView
              teamIds={effectiveTeamIds}
              onEdit={handleEdit}
              onDelete={setDeletingId}
              canEdit
            />
          </div>
        </div>
      )}

      {isTeamScope && viewType === 'weekly' && (
        <div className="mt-6" data-tour="team-weekly">
          {teamFilterOptions.length > 0 && (
            <TeamMultiSelect
              options={teamFilterOptions}
              selected={selectedTeams}
              onChange={setSelectedTeams}
              placeholder={t('common:allTeams')}
            />
          )}
          <div className="mt-4">
            <TeamWeeklySection
              teamIds={effectiveTeamIds}
              onEdit={handleWeeklyEdit}
              onDelete={setDeletingId}
              currentUserId={String(user?.id ?? '')}
              isCoachLike={isCoach || effectiveIsCoach}
            />
          </div>
        </div>
      )}

      <AbsenceForm
        open={formOpen}
        absence={editingAbsence}
        onSave={handleFormSave}
        onCancel={() => { setFormOpen(false); setEditingAbsence(null) }}
        forTeam={isTeamScope}
        teamIds={effectiveTeamIds}
      />

      <WeeklyUnavailabilityForm
        open={weeklyFormOpen}
        absence={editingWeekly}
        onSave={handleWeeklyFormSave}
        onCancel={() => { setWeeklyFormOpen(false); setEditingWeekly(null) }}
        forTeam={isTeamScope}
        teamIds={effectiveTeamIds}
      />

      <AbsenceImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onComplete={() => { setImportOpen(false); refetch() }}
      />

      <ConfirmDialog
        open={deletingId !== null}
        onClose={() => setDeletingId(null)}
        onConfirm={handleDelete}
        title={viewType === 'weekly' ? t('deleteWeeklyTitle') : t('deleteTitle')}
        message={viewType === 'weekly' ? t('deleteWeeklyMessage') : t('deleteMessage')}
        confirmLabel={t('common:delete')}
        danger
      />
    </div>
  )
}

/**
 * Team-scoped weekly unavailabilities. Reuses useTeamAbsences (which fetches all
 * absence types for the team) and filters client-side to type='weekly'. Date
 * range is wide because weeklies are open-ended schedules, not point-in-time events.
 */
function TeamWeeklySection({
  teamIds,
  onEdit,
  onDelete,
  currentUserId,
  isCoachLike,
}: {
  teamIds: string[]
  onEdit: (a: Absence) => void
  onDelete: (id: string) => void
  currentUserId: string
  isCoachLike: boolean
}) {
  const { t } = useTranslation('absences')
  const today = new Date().toISOString().slice(0, 10)
  const farFuture = (() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() + 2)
    return d.toISOString().slice(0, 10)
  })()
  const { absences, memberMap, isLoading } = useTeamAbsences(teamIds, today, farFuture)
  const [excludedMembers, setExcludedMembers] = useState<Set<string>>(new Set())

  const allWeeklies = useMemo(
    () => absences.filter((a) => a.type === 'weekly'),
    [absences],
  )
  const memberOptions = useMemo(
    () => buildMemberOptions(allWeeklies, memberMap, t('common:unknown')),
    [allWeeklies, memberMap, t],
  )
  const weeklies = useMemo(
    () => allWeeklies.filter((a) => !excludedMembers.has(relId(a.member))),
    [allWeeklies, excludedMembers],
  )

  if (isLoading) {
    return <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">{t('common:loading')}</div>
  }
  if (allWeeklies.length === 0) {
    return (
      <EmptyState
        icon={<CalendarClock className="h-10 w-10" />}
        title={t('noTeamWeeklies')}
        description={t('noTeamWeekliesDescription')}
      />
    )
  }

  return (
    <div className="space-y-4">
      <AbsenceMemberFilter
        options={memberOptions}
        excluded={excludedMembers}
        onChange={setExcludedMembers}
      />
      {weeklies.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noMembersMatchFilter')}</p>
      ) : (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-gray-500 dark:text-gray-400">{t('colMember')}</TableHead>
            <WeeklyDayHeaderCells />
            <TableHead className="hidden md:table-cell text-gray-500 dark:text-gray-400">{t('colWhen')}</TableHead>
            <TableHead className="hidden sm:table-cell text-gray-500 dark:text-gray-400">{t('colAffects')}</TableHead>
            <TableHead className="w-32 text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {weeklies.map((a) => {
            const m = asObj<Member>(a.member) ?? memberMap[relId(a.member)]
            const memberName = [m?.first_name, m?.last_name].filter(Boolean).join(' ') || t('common:unknown')
            const canEdit = relId(a.member) === currentUserId || isCoachLike
            return (
              <WeeklyUnavailabilityCard
                key={a.id}
                absence={a}
                showMemberName={memberName !== ''}
                onEdit={onEdit}
                onDelete={onDelete}
                canEdit={canEdit}
              />
            )
          })}
        </TableBody>
      </Table>
    </div>
      )}
    </div>
  )
}
