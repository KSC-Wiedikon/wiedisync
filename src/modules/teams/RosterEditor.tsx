import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useParams, Link, Navigate } from 'react-router-dom'
import { User, X } from 'lucide-react'
import { logActivity } from '../../utils/logActivity'
import { coercePositions, getPositionI18nKey, getPositionInitial, getPositionsForSport, getSelectablePositions, isNonPlayingStaff } from '../../utils/memberPositions'
import { useAuth } from '../../hooks/useAuth'
import { useTeamMembers } from '../../hooks/useTeamMembers'
import { useMutation } from '../../hooks/useMutation'
import { useCollection } from '../../lib/query'
import TeamChip from '../../components/TeamChip'
import ConfirmDialog from '@/components/ConfirmDialog'
import InviteExternalUserModal from './InviteExternalUserModal'
import TeamSponsorsEditor from './TeamSponsorsEditor'
import TrainingForm from '../trainings/TrainingForm'
import FinesSettings from '../fines/FinesSettings'
import EmptyState from '../../components/EmptyState'
import { getFileUrl } from '../../utils/fileUrl'
import { getCurrentSeason } from '../../utils/dateHelpers'
import type { Team, Member, MemberPosition, MemberTeam, TeamSettings } from '../../types'
import { Button } from '../../components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { fetchAllItems, fetchItems, updateRecord, uploadFile } from '../../lib/api'
import { asObj, relId } from '../../utils/relations'
import { useReportPageLoading } from '../../hooks/usePageReady'

type LeadershipRole = 'coach' | 'captain' | 'team_responsible'

function displayName(m: Member): string {
  return [m.last_name, m.first_name].filter(Boolean).join(' ') || '—'
}

const ROLE_I18N: Record<LeadershipRole, string> = {
  coach: 'roleCoach',
  captain: 'roleCaptain',
  team_responsible: 'roleTeamResponsible',
}

const ROLE_COLORS: Record<LeadershipRole, string> = {
  coach: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  captain: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  team_responsible: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
}


export default function RosterEditor() {
  const { t } = useTranslation('teams')
  const { teamSlug } = useParams<{ teamSlug: string }>()
  const { isCoachOf } = useAuth()
  const season = getCurrentSeason()
  const { data: allMembersRaw } = useCollection<Member>('members', { filter: { kscw_membership_active: { _eq: true } }, all: true, sort: ['last_name'], fields: ['id', 'first_name', 'last_name', 'photo', 'number', 'position'] })
  const allMembers = allMembersRaw ?? []
  const { create, remove } = useMutation<MemberTeam>('member_teams')

  const [team, setTeam] = useState<Team | null>(null)
  const [search, setSearch] = useState('')
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [editingNumber, setEditingNumber] = useState<string | null>(null)
  const [numberValue, setNumberValue] = useState('')
  const [editingPosition, setEditingPosition] = useState<string | null>(null)
  const [localOverrides, setLocalOverrides] = useState<Record<string, { position?: MemberPosition[]; number?: number }>>({})
  const [guestOverrides, setGuestOverrides] = useState<Record<string, number>>({})
  const [uploadingPicture, setUploadingPicture] = useState(false)
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const teamId = team?.id
  // Persist the position-normalization auto-heal only here, and only once the
  // viewer is confirmed a coach of this team (the same gate as the redirect
  // below). Read-only surfaces must not PATCH members.position — see
  // useTeamMembers + the 2026-06-20 error-log audit.
  const { members, isLoading, refetch } = useTeamMembers(teamId, season, {
    persistNormalization: !!team && isCoachOf(team.id),
  })

  // Report to app boot gate — see usePageReady.tsx. Must run on every render, so
  // it sits above the early Navigate/spinner returns below.
  useReportPageLoading(!team || isLoading)

  useEffect(() => {
    if (!teamSlug) return
    fetchItems<Team>('teams', {
      // Scope to the active (current-season) team — post-rollover there are two
      // same-name rows; without active=true we'd edit last season's archived
      // roster. See INFRA.md → Season rollover.
      filter: { _and: [{ name: { _eq: teamSlug } }, { active: { _eq: true } }] },
      limit: 1,
      // Expand M2M aliases — bare `coach`/`team_responsible` come back as
      // junction row IDs that flattenMemberIds would mis-interpret as
      // member IDs (ghost-staff bug, 2026-05-12).
      fields: ['*', 'coach.members_id', 'team_responsible.members_id'],
    })
      .then((items) => setTeam(items[0] ?? null))
      .catch(() => setTeam(null))
  }, [teamSlug])

  if (team && !isCoachOf(team.id)) {
    return <Navigate to={`/teams/${teamSlug}`} replace />
  }

  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      const ma = asObj<Member>(a.member)
      const mb = asObj<Member>(b.member)
      if (!ma || !mb) return 0
      return (ma.last_name ?? '').localeCompare(mb.last_name ?? '') || (ma.first_name ?? '').localeCompare(mb.first_name ?? '')
    })
  }, [members])

  const rosterMemberIds = new Set(members.map((mt) => relId(mt.member)))
  const searchLower = search.toLowerCase()
  const availableMembers = allMembers.filter(
    (m) =>
      !rosterMemberIds.has(m.id) &&
      (displayName(m).toLowerCase().includes(searchLower) ||
        m.first_name?.toLowerCase().includes(searchLower) ||
        m.last_name?.toLowerCase().includes(searchLower)),
  )

  const [addingId, setAddingId] = useState<string | null>(null)

  async function handleAdd(memberId: string) {
    if (!teamId || addingId) return
    setAddingId(memberId)
    try {
      const existing = await fetchAllItems<{ id: string }>('member_teams', {
        filter: { _and: [{ member: { _eq: memberId } }, { team: { _eq: teamId } }] },
        fields: ['id'],
      })
      if (!existing.length) {
        try {
          await create({ member: memberId, team: teamId, season }, { silentOnUnique: true })
        } catch (err) {
          if (!/has to be unique/i.test(err instanceof Error ? err.message : '')) throw err
        }
      }
      const member = allMembers.find(m => m.id === memberId)
      toast.success(t('memberAdded', { name: displayName(member ?? {} as Member) }))
      setSearch('')
      refetch()
    } catch {
      toast.error(t('common:errorSaving'))
    } finally {
      setAddingId(null)
    }
  }

  async function handleRemove() {
    if (!removingId) return
    try {
      await remove(removingId)
      setRemovingId(null)
      refetch()
    } catch {
      toast.error(t('common:errorSaving'))
    }
  }


  const toggleRole = useCallback(async (memberId: string, role: LeadershipRole) => {
    if (!team) return
    const currentId = relId(team[role])
    const isCurrent = currentId === String(memberId)
    // captain is M2O (single FK) — set to member ID or null
    const nextValue = isCurrent ? null : memberId
    try {
      await updateRecord('teams', team.id, { [role]: nextValue })
      logActivity('update', 'teams', team.id, { [role]: nextValue })
      setTeam((prev) => prev ? { ...prev, [role]: nextValue } : prev)
    } catch {
      toast.error(t('common:errorSaving'))
    }
  }, [team, t])

  async function saveNumber(memberId: string) {
    const num = numberValue ? parseInt(numberValue, 10) : 0
    setLocalOverrides((prev) => ({ ...prev, [memberId]: { ...prev[memberId], number: num } }))
    setEditingNumber(null)
    try {
      await updateRecord('members', memberId, { number: num })
      logActivity('update', 'members', memberId, { number: num })
    } catch {
      setLocalOverrides((prev) => { const next = { ...prev }; delete next[memberId]?.number; return next })
      toast.error(t('common:errorSaving'))
    }
  }

  async function savePosition(memberId: string, positions: MemberPosition[]) {
    setLocalOverrides((prev) => ({ ...prev, [memberId]: { ...prev[memberId], position: positions } }))
    try {
      await updateRecord('members', memberId, { position: positions })
      logActivity('update', 'members', memberId, { position: positions })
    } catch {
      setLocalOverrides((prev) => { const next = { ...prev }; delete next[memberId]?.position; return next })
      toast.error(t('common:errorSaving'))
    }
  }

  async function handlePictureUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !team) return
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t('pictureTooLarge'))
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setUploadingPicture(true)
    try {
      // Upload to /files first (multipart), then set the FK on the team.
      // Passing FormData straight to updateRecord() is a silent no-op: the
      // Directus SDK's updateItem JSON.stringifies the body, and
      // JSON.stringify(FormData) === '{}' → empty PATCH that "succeeds" but
      // saves nothing. File fields must go through POST /files.
      const { id: fileId } = await uploadFile(file)
      const updated = await updateRecord<Team>('teams', team.id, { team_picture: fileId })
      logActivity('update', 'teams', team.id, { team_picture: updated.team_picture })
      setTeam((prev) => prev ? { ...prev, team_picture: updated.team_picture } : prev)
      toast.success(t('common:saved'))
    } catch {
      toast.error(t('errorUploadingPicture'))
    }
    setUploadingPicture(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handlePictureRemove() {
    if (!team) return
    setUploadingPicture(true)
    try {
      await updateRecord('teams', team.id, { team_picture: null })
      logActivity('update', 'teams', team.id, { team_picture: null })
      setTeam((prev) => prev ? { ...prev, team_picture: '' } : prev)
      toast.success(t('common:saved'))
    } catch {
      toast.error(t('common:errorSaving'))
    }
    setUploadingPicture(false)
  }

  if (!team || isLoading) {
    return null
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Link to="/teams" className="hover:text-gray-700 dark:text-gray-300">{t('title')}</Link>
        <span>/</span>
        <Link to={`/teams/${teamSlug}`} className="hover:text-gray-700 dark:text-gray-300">
          {team?.full_name ?? 'Team'}
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100">{t('editRoster')}</span>
      </div>

      <div className="flex items-center gap-3">
        {team && <TeamChip team={team.name} />}
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('editRoster')}</h1>
      </div>

      {/* Team picture */}
      <div className="mt-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('teamPicture')}</h2>
        <div className="mt-3 flex items-center gap-4">
          {team?.team_picture ? (
            <img
              src={getFileUrl('teams', team.id, team.team_picture)}
              alt={team.full_name}
              className="h-24 w-36 rounded-lg object-cover border dark:border-gray-700"
            />
          ) : (
            <div className="flex h-24 w-36 items-center justify-center rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 text-sm">
              {t('teamPicture')}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600">
              {uploadingPicture ? '...' : t('uploadPicture')}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png"
                onChange={handlePictureUpload}
                className="hidden"
                disabled={uploadingPicture}
              />
            </label>
            {team?.team_picture && (
              <button
                onClick={handlePictureRemove}
                disabled={uploadingPicture}
                className="text-sm text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
              >
                {t('removePicture')}
              </button>
            )}
            <span className="text-xs text-gray-400 dark:text-gray-500">{t('pictureHint')}</span>
          </div>
        </div>
      </div>

      {/* Current roster */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('currentRoster', { count: members.length })}
        </h2>

        {members.length === 0 ? (
          <EmptyState icon={<User className="h-10 w-10" />} title={t('noMembers')} description={t('noMembersDescription')} />
        ) : (
          <div className="mt-4 rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-200 dark:border-gray-700">
                  <TableHead className="w-10 hidden sm:table-cell" />
                  <TableHead className="text-gray-500 dark:text-gray-400">{t('common:name')}</TableHead>
                  <TableHead className="w-12 text-center text-gray-500 dark:text-gray-400">#</TableHead>
                  <TableHead className="text-gray-500 dark:text-gray-400">{t('positionCol')}</TableHead>
                  <TableHead className="w-16 text-center text-gray-500 dark:text-gray-400">K&nbsp;/&nbsp;G</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedMembers.map((mt) => {
                  const member = asObj<Member>(mt.member)
                  if (!member) return null
                  const initials = `${member.first_name?.[0] ?? ''}${member.last_name?.[0] ?? ''}`.toUpperCase()
                  const isCaptain = team ? relId(team.captain) === String(member.id) : false
                  const overrides = localOverrides[String(member.id)]
                  const memberPositions = coercePositions(overrides?.position ?? member.position)
                  const memberNumber = overrides?.number ?? member.number
                  const nonPlaying = isNonPlayingStaff(member.id, team, memberPositions)
                  const selectablePositions = getSelectablePositions(team?.sport, memberPositions)
                  const mtId = String(mt.id)
                  const guestLevel = guestOverrides[mtId] ?? (mt.guest_level as number) ?? 0

                  const numberEl = nonPlaying ? (
                    <span className="flex h-7 w-10 mx-auto items-center justify-center text-sm text-gray-400 dark:text-gray-500">—</span>
                  ) : editingNumber === member.id ? (
                    <input
                      type="number"
                      value={numberValue}
                      onChange={(e) => setNumberValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveNumber(member.id)
                        else if (e.key === 'Escape') setEditingNumber(null)
                      }}
                      onBlur={() => saveNumber(member.id)}
                      className="w-12 mx-auto block rounded-md border border-brand-400 bg-white px-1 py-0.5 text-center text-sm font-medium text-gray-900 shadow-sm ring-1 ring-brand-400/30 focus:outline-none dark:border-brand-500 dark:bg-gray-700 dark:text-gray-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      autoFocus
                    />
                  ) : (
                    <button
                      onClick={() => { setEditingNumber(member.id); setNumberValue(String(memberNumber || '')) }}
                      className="flex h-7 w-10 mx-auto items-center justify-center rounded-md border border-gray-200 text-sm font-medium text-gray-500 transition-colors hover:border-brand-400 hover:text-brand-600 dark:border-gray-600 dark:text-gray-400 dark:hover:border-brand-500 dark:hover:text-brand-400"
                      title={t('numberCol')}
                    >
                      {memberNumber || '—'}
                    </button>
                  )

                  const captainEl = (
                    <button
                      onClick={() => toggleRole(member.id, 'captain')}
                      title={t(ROLE_I18N.captain)}
                      className={`rounded px-1.5 py-0.5 text-xs font-medium transition-colors ${
                        isCaptain
                          ? ROLE_COLORS.captain
                          : 'bg-gray-100 text-gray-400 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-500 dark:hover:bg-gray-600'
                      }`}
                    >
                      K
                    </button>
                  )

                  const guestEl = (
                    <button
                      onClick={async () => {
                        const nextLevel = (guestLevel + 1) % 4
                        setGuestOverrides((prev) => ({ ...prev, [mtId]: nextLevel }))
                        try {
                          await updateRecord('member_teams', mtId, { guest_level: nextLevel })
                          logActivity('update', 'member_teams', mtId, { guest_level: nextLevel })
                        } catch {
                          setGuestOverrides((prev) => ({ ...prev, [mtId]: guestLevel }))
                          toast.error(t('common:errorSaving'))
                        }
                      }}
                      title={guestLevel === 0 ? t('guestLevel0') : t('guestLevelTooltip', { level: guestLevel })}
                      className={`rounded px-1.5 py-0.5 text-xs font-medium transition-colors ${
                        guestLevel === 0
                          ? 'bg-gray-100 text-gray-400 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-500 dark:hover:bg-gray-600'
                          : guestLevel === 1
                            ? 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300'
                            : guestLevel === 2
                              ? 'bg-orange-100/70 text-orange-600 dark:bg-orange-900/60 dark:text-orange-400'
                              : 'bg-orange-100/50 text-orange-500 dark:bg-orange-900/40 dark:text-orange-500'
                      }`}
                    >
                      {guestLevel === 0 ? t('guestBadge') : `G${guestLevel}`}
                    </button>
                  )

                  const positionLabelFull = memberPositions
                    .map((p) => (getPositionI18nKey(p) ? t(getPositionI18nKey(p)!) : p))
                    .join(', ') || '—'
                  const positionLabelShort = memberPositions
                    .map((p) => getPositionInitial(p))
                    .join('/') || '—'
                  const positionEl = (
                    <div className="relative">
                      <button
                        onClick={() => setEditingPosition(editingPosition === member.id ? null : member.id)}
                        className="rounded border border-gray-300 px-2 py-1 text-left text-xs text-gray-700 transition-colors hover:border-brand-400 dark:border-gray-600 dark:text-gray-100 dark:hover:border-brand-500 w-12 sm:w-40"
                        title={positionLabelFull}
                      >
                        <span className="sm:hidden font-semibold tracking-wide">{positionLabelShort}</span>
                        <span className="hidden sm:inline truncate">{positionLabelFull}</span>
                      </button>
                      {editingPosition === member.id && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setEditingPosition(null)} />
                          <div className="absolute left-0 z-20 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800">
                            {selectablePositions.map((p) => {
                              const active = memberPositions.includes(p)
                              return (
                                <button
                                  key={p}
                                  onClick={() => {
                                    const next = (active
                                      ? memberPositions.filter((pos) => pos !== p)
                                      : [...memberPositions, p]) as MemberPosition[]
                                    savePosition(member.id, next.length > 0 ? next : ['other'])
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
                                >
                                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${active ? 'border-brand-500 bg-brand-500 text-white' : 'border-gray-300 dark:border-gray-500'}`}>
                                    {active && (
                                      <svg className="h-3 w-3" viewBox="0 0 12 12">
                                        <path d="M10 3L4.5 8.5 2 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    )}
                                  </span>
                                  {getPositionI18nKey(p) ? t(getPositionI18nKey(p)!) : p}
                                </button>
                              )
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )

                  return (
                    <TableRow key={mt.id as string} className="border-gray-200 dark:border-gray-700">
                      <TableCell className="hidden sm:table-cell">
                        {member.photo ? (
                          <img src={getFileUrl('members', member.id, member.photo)} alt="" className="h-8 w-8 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-600 text-xs font-medium text-gray-600 dark:text-gray-300">{initials}</div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-normal text-sm font-medium text-gray-900 dark:text-gray-100 leading-tight">
                        <span className="block sm:inline">{member.last_name}</span>
                        <span className="block sm:inline sm:ml-1 text-gray-600 dark:text-gray-400 sm:text-gray-900 sm:dark:text-gray-100">{member.first_name}</span>
                      </TableCell>
                      <TableCell className="text-center">{numberEl}</TableCell>
                      <TableCell>{positionEl}</TableCell>
                      <TableCell>
                        <div className="flex flex-col items-center gap-1 sm:flex-row sm:gap-1.5">
                          {captainEl}
                          {guestEl}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          onClick={() => setRemovingId(mt.id as string)}
                          className="p-1 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                          title={t('common:remove')}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Add member */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('addPlayer')}</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setInviteModalOpen(true)}
          >
            {t('addExternalUser')}
          </Button>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none"
        />
        {search.length >= 2 && (
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
            {availableMembers.length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{t('noSearchResults')}</p>
            ) : (
              availableMembers.slice(0, 10).map((m) => (
                <button
                  key={m.id}
                  onClick={() => handleAdd(m.id)}
                  disabled={addingId === m.id}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:pointer-events-none"
                >
                  {m.photo ? (
                    <img
                      src={getFileUrl('members', m.id, m.photo)}
                      alt=""
                      className="h-6 w-6 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-600 text-xs text-gray-600 dark:text-gray-300">
                      {m.first_name?.[0]}{m.last_name?.[0]}
                    </div>
                  )}
                  <span>{displayName(m)}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={removingId !== null}
        onClose={() => setRemovingId(null)}
        onConfirm={handleRemove}
        title={t('removeConfirmTitle')}
        message={t('removeConfirmMessage', {
          name: (() => {
            const m = asObj<Member>(members.find((mt) => mt.id === removingId)?.member)
            return m ? displayName(m) : ''
          })(),
        })}
        confirmLabel={t('common:remove')}
        danger
      />

      <InviteExternalUserModal
        open={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        teamId={team?.id ?? ''}
        teamName={team?.full_name ?? team?.name ?? ''}
      />

      {/* Team settings */}
      {team && (
        <TeamSettingsSection team={team} onUpdate={(s) => setTeam((prev) => prev ? { ...prev, features_enabled: s } : prev)} />
      )}

      {/* Team sponsors */}
      {team && <TeamSponsorsEditor team={team} />}
    </div>
  )
}

/* ── iOS-style switch toggle ── */
function SwitchToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center" style={{ minWidth: 44, minHeight: 44 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span className="absolute inset-0 m-auto h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-brand-600 dark:bg-gray-600 dark:peer-checked:bg-brand-600" />
      <span className="absolute left-0.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
    </label>
  )
}

/* ── Setting row with label + hint + control ── */
function SettingRow({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</div>
        <div className="text-xs italic text-gray-500 dark:text-gray-400">{hint}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SocialLinkRow({ label, hint, value, onChange, placeholder }: {
  label: string; hint: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder: string
}) {
  return (
    <div className="px-4 py-3">
      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</div>
      <div className="text-xs italic text-gray-500 dark:text-gray-400">{hint}</div>
      <input
        type="url"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="mt-2 w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        style={{ minHeight: 44 }}
      />
    </div>
  )
}

/* ── Collapsible accordion group ── */
function SettingsGroup({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100"
        style={{ minHeight: 44 }}
      >
        <span>{title}</span>
        <span className="text-gray-400 dark:text-gray-500">{open ? '\u25BC' : '\u25B6'}</span>
      </button>
      {open && <div className="divide-y divide-gray-100 border-t border-gray-200 dark:divide-gray-700 dark:border-gray-700">{children}</div>}
    </div>
  )
}

/* ── Number input with debounced save ── */
function DebouncedNumberInput({ value, onChange, suffix }: { value: number | undefined; onChange: (v: number) => void; suffix?: string }) {
  const [local, setLocal] = useState(String(value ?? ''))
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setLocal(String(value ?? '')) }, [value])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setLocal(v)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const num = parseInt(v, 10)
      if (!isNaN(num)) onChange(num)
    }, 500)
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        value={local}
        onChange={handleChange}
        className="w-14 rounded-md border border-gray-300 bg-white px-1 py-1 text-center text-sm text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        style={{ minHeight: 44 }}
      />
      {suffix && <span className="text-xs text-gray-500 dark:text-gray-400">{suffix}</span>}
    </div>
  )
}

function TeamSettingsSection({ team, onUpdate }: { team: Team; onUpdate: (s: TeamSettings) => void }) {
  const { t } = useTranslation('teams')
  const { update } = useMutation<Team>('teams')
  const settings: TeamSettings = (team.features_enabled as TeamSettings) ?? {}
  const [openForPlayers, setOpenForPlayers] = useState(team.open_for_players ?? false)
  const [recruitingPositions, setRecruitingPositions] = useState<MemberPosition[]>(
    coercePositions(team.recruiting_positions),
  )
  const [showGuests, setShowGuests] = useState(team.show_guests_on_website ?? true)
  const [trialFormOpen, setTrialFormOpen] = useState(false)
  const [socialUrl, setSocialUrl] = useState(team.social_url ?? '')
  const [facebookUrl, setFacebookUrl] = useState(team.facebook_url ?? '')
  const [tiktokUrl, setTiktokUrl] = useState(team.tiktok_url ?? '')
  const socialUrlTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const facebookUrlTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tiktokUrlTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Auto-confirm toggles warn in both directions: turning ON backfills future
  // activities + confirms everyone; turning OFF is forward-only and leaves
  // existing confirmations untouched (not a reset) — both are easy to misread.
  const [autoConfirmPrompt, setAutoConfirmPrompt] = useState<{ kind: 'game' | 'training'; turningOn: boolean } | null>(null)

  const save = async (patch: Partial<TeamSettings>) => {
    const next = { ...settings, ...patch }
    await update(team.id, { features_enabled: next })
    onUpdate(next)
  }

  const toggleBool = (key: keyof TeamSettings) => {
    save({ [key]: !settings[key] })
  }

  const requestAutoConfirmToggle = (kind: 'game' | 'training') => {
    const key = kind === 'game' ? 'game_auto_confirm' : 'training_auto_confirm'
    setAutoConfirmPrompt({ kind, turningOn: settings[key] !== true })
  }

  const setNumber = (key: keyof TeamSettings, v: number) => {
    save({ [key]: v })
  }

  const toggleOpenForPlayers = async () => {
    const next = !openForPlayers
    await update(team.id, { open_for_players: next })
    setOpenForPlayers(next)
  }

  const toggleRecruitingPosition = async (p: MemberPosition) => {
    const next = recruitingPositions.includes(p)
      ? recruitingPositions.filter((x) => x !== p)
      : [...recruitingPositions, p]
    setRecruitingPositions(next)
    await update(team.id, { recruiting_positions: next })
  }

  const toggleShowGuests = async () => {
    const next = !showGuests
    await update(team.id, { show_guests_on_website: next })
    setShowGuests(next)
  }

  const handleUrlChange = (
    field: 'social_url' | 'facebook_url' | 'tiktok_url',
    setter: (v: string) => void,
    timer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  ) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setter(v)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      update(team.id, { [field]: v })
    }, 500)
  }

  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('teamSettings')}</h2>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('teamSettingsDescription')}</p>

      <div className="mt-3 space-y-3">
        {/* Website */}
        <SettingsGroup title={t('settingsWebsite')}>
          <SettingRow label={t('featureOpenForPlayers')} hint={t('featureOpenForPlayersHint')}>
            <SwitchToggle checked={openForPlayers} onChange={toggleOpenForPlayers} />
          </SettingRow>
          {openForPlayers && (
            <div className="space-y-1.5 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('recruitingPositionsLabel')}</div>
                <div className="text-xs italic text-gray-500 dark:text-gray-400">{t('recruitingPositionsHint')}</div>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {getPositionsForSport(team.sport)
                  .filter((p) => p !== 'guest' && p !== 'other')
                  .map((p) => {
                    const active = recruitingPositions.includes(p)
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => toggleRecruitingPosition(p)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          active
                            ? 'border-brand-500 bg-brand-500 text-white'
                            : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-500 dark:text-gray-300 dark:hover:bg-gray-700'
                        }`}
                      >
                        {getPositionI18nKey(p) ? t(getPositionI18nKey(p)!) : p}
                      </button>
                    )
                  })}
              </div>
            </div>
          )}
          {openForPlayers && (
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('trialTrainingLabel')}</div>
                <div className="text-xs italic text-gray-500 dark:text-gray-400">{t('trialTrainingHint')}</div>
              </div>
              <div className="shrink-0">
                <Button type="button" variant="outline" size="sm" onClick={() => setTrialFormOpen(true)}>
                  {t('newTrialTraining')}
                </Button>
              </div>
            </div>
          )}
          <SettingRow label={t('showGuestsOnWebsite')} hint={t('showGuestsOnWebsiteHint')}>
            <SwitchToggle checked={showGuests} onChange={toggleShowGuests} />
          </SettingRow>
          <SocialLinkRow
            label={t('instagramUrl')}
            hint={t('instagramUrlHint')}
            value={socialUrl}
            onChange={handleUrlChange('social_url', setSocialUrl, socialUrlTimer)}
            placeholder="https://instagram.com/..."
          />
          <SocialLinkRow
            label={t('facebookUrl')}
            hint={t('facebookUrlHint')}
            value={facebookUrl}
            onChange={handleUrlChange('facebook_url', setFacebookUrl, facebookUrlTimer)}
            placeholder="https://facebook.com/..."
          />
          <SocialLinkRow
            label={t('tiktokUrl')}
            hint={t('tiktokUrlHint')}
            value={tiktokUrl}
            onChange={handleUrlChange('tiktok_url', setTiktokUrl, tiktokUrlTimer)}
            placeholder="https://tiktok.com/@..."
          />
        </SettingsGroup>

        {/* Features */}
        <SettingsGroup title={t('settingsFeatures')}>
          <SettingRow label={t('featureTasks')} hint={t('featureTasksHint')}>
            <SwitchToggle checked={settings.tasks === true} onChange={() => toggleBool('tasks')} />
          </SettingRow>
          <SettingRow label={t('featureCarpool')} hint={t('featureCarpoolHint')}>
            <SwitchToggle checked={settings.carpool === true} onChange={() => toggleBool('carpool')} />
          </SettingRow>
          <SettingRow label={t('featurePolls')} hint={t('featurePollsHint')}>
            <SwitchToggle checked={settings.polls === true} onChange={() => toggleBool('polls')} />
          </SettingRow>
          <SettingRow label={t('featureShowRsvpTime')} hint={t('featureShowRsvpTimeHint')}>
            <SwitchToggle checked={settings.show_rsvp_time === true} onChange={() => toggleBool('show_rsvp_time')} />
          </SettingRow>
          <SettingRow label={t('featureAutoDeclineTentative')} hint={t('featureAutoDeclineTentativeHint')}>
            <SwitchToggle checked={settings.auto_decline_tentative === true} onChange={() => toggleBool('auto_decline_tentative')} />
          </SettingRow>
        </SettingsGroup>

        {/* Game Defaults */}
        <SettingsGroup title={t('settingsGameDefaults')}>
          <SettingRow label={t('featureAutoConfirmGame')} hint={t('featureAutoConfirmGameHint')}>
            <SwitchToggle checked={settings.game_auto_confirm === true} onChange={() => requestAutoConfirmToggle('game')} />
          </SettingRow>
          <SettingRow label={t('settingsRequireNoteIfAbsent')} hint={t('settingsRequireNoteHint')}>
            <SwitchToggle checked={settings.game_require_note_if_absent === true} onChange={() => toggleBool('game_require_note_if_absent')} />
          </SettingRow>
          <SettingRow label={t('settingsMinParticipants')} hint={t('settingsMinParticipantsGameHint')}>
            <DebouncedNumberInput value={settings.game_min_participants} onChange={(v) => setNumber('game_min_participants', v)} />
          </SettingRow>
          <SettingRow label={t('settingsRespondByDays')} hint={t('settingsRespondByGameHint')}>
            <DebouncedNumberInput value={settings.game_respond_by_days} onChange={(v) => setNumber('game_respond_by_days', v)} suffix={t('settingsRespondByDaysSuffix')} />
          </SettingRow>
        </SettingsGroup>

        {/* Training Defaults */}
        <SettingsGroup title={t('settingsTrainingDefaults')}>
          <SettingRow label={t('featureAutoConfirmTraining')} hint={t('featureAutoConfirmTrainingHint')}>
            <SwitchToggle checked={settings.training_auto_confirm === true} onChange={() => requestAutoConfirmToggle('training')} />
          </SettingRow>
          <SettingRow label={t('settingsAutoCancelOnMin')} hint={t('settingsAutoCancelOnMinHint')}>
            <SwitchToggle checked={settings.training_auto_cancel_on_min === true} onChange={() => toggleBool('training_auto_cancel_on_min')} />
          </SettingRow>
          <SettingRow label={t('settingsRequireNoteIfAbsent')} hint={t('settingsRequireNoteHint')}>
            <SwitchToggle checked={settings.training_require_note_if_absent === true} onChange={() => toggleBool('training_require_note_if_absent')} />
          </SettingRow>
          <SettingRow label={t('settingsMinParticipants')} hint={t('settingsMinParticipantsTrainingHint')}>
            <DebouncedNumberInput value={settings.training_min_participants} onChange={(v) => setNumber('training_min_participants', v)} />
          </SettingRow>
          <SettingRow label={t('settingsRespondByDays')} hint={t('settingsRespondByTrainingHint')}>
            <DebouncedNumberInput value={settings.training_respond_by_days} onChange={(v) => setNumber('training_respond_by_days', v)} suffix={t('settingsRespondByDaysSuffix')} />
          </SettingRow>
        </SettingsGroup>

        {/* Fines */}
        <FinesSettings teamId={team.id} />
      </div>

      {autoConfirmPrompt && (
        <ConfirmDialog
          open
          onClose={() => setAutoConfirmPrompt(null)}
          onConfirm={() => toggleBool(autoConfirmPrompt.kind === 'game' ? 'game_auto_confirm' : 'training_auto_confirm')}
          title={t(autoConfirmPrompt.turningOn ? 'autoConfirmOnTitle' : 'autoConfirmOffTitle')}
          message={t(`${autoConfirmPrompt.kind}AutoConfirm${autoConfirmPrompt.turningOn ? 'On' : 'Off'}Message`)}
          confirmLabel={t(autoConfirmPrompt.turningOn ? 'autoConfirmOnCta' : 'autoConfirmOffCta')}
        />
      )}

      <TrainingForm
        open={trialFormOpen}
        defaultTeamId={team.id}
        defaultIsTrial
        onSave={() => {
          setTrialFormOpen(false)
          toast.success(t('trialTrainingCreated'))
        }}
        onCancel={() => setTrialFormOpen(false)}
      />
    </div>
  )
}
