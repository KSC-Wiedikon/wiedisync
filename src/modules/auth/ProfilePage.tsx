import { useState, useMemo, useEffect } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, X, Clock } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useCollection } from '../../lib/query'
import { kscwApi } from '../../lib/api'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import StatusBadge from '../../components/StatusBadge'
import TeamChip from '../../components/TeamChip'
import { getFileUrl } from '../../utils/fileUrl'
import { coercePositions, getPositionI18nKey } from '../../utils/memberPositions'
import { memberName, flattenMemberIds } from '../../utils/relations'
import { formatDate, getCurrentSeason, toISODate } from '../../utils/dateHelpers'
import ProfileEditModal from './ProfileEditModal'
import DeleteAccountModal from './DeleteAccountModal'
import TeamRequestModal from './TeamRequestModal'
import Modal from '@/components/Modal'
import MessagingSettingsCard from '../messaging/pages/MessagingSettingsCard'
import type { MemberTeam, Team, Absence, LicenceType, Fine } from '../../types'
import { formatFineAmount } from '../../hooks/useFines'
import { licencesOf } from '../../types'
import { updateRecord, deleteRecord } from '../../lib/api'
import { asObj } from '../../utils/relations'

const LICENCE_LABELS: Record<LicenceType, string> = {
  scorer_vb: 'licenceScorer',
  referee_vb: 'licenceReferee',
  otr1_bb: 'licenceOTR1',
  otr2_bb: 'licenceOTR2',
  otn_bb: 'licenceOTN',
  referee_bb: 'licenceRefereeBB',
}

type ExpandedMemberTeam = MemberTeam & { team: Team | string }

export default function ProfilePage() {
  const { user, coachTeamIds, primarySport } = useAuth()
  const { t } = useTranslation('auth')
  const { t: tt } = useTranslation('teams')
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [teamRequestOpen, setTeamRequestOpen] = useState(false)
  const [leavingTeam, setLeavingTeam] = useState<{ id: string; name: string } | null>(null)
  const [leaving, setLeaving] = useState(false)

  const { data: memberTeamsRaw, refetch: refetchMemberTeams } = useCollection<ExpandedMemberTeam>('member_teams', {
    // Current-season only — archived same-name teams from prior seasons would
    // otherwise show as duplicate rows the user could "leave".
    filter: user ? { _and: [{ member: { _eq: user.id } }, { season: { _eq: getCurrentSeason() } }] } : undefined,
    fields: ['*', 'team.*'],
    limit: 20,
    enabled: !!user,
  })
  const memberTeams = memberTeamsRaw ?? []

  // Pending team requests
  interface TeamRequest { id: string; member: string; team: Team | string; status: string }
  const { data: pendingRequestsRaw, refetch: refetchRequests } = useCollection<TeamRequest>('team_requests', {
    filter: user ? { _and: [{ member: { _eq: user.id } }, { status: { _eq: 'pending' } }] } : undefined,
    fields: ['*', 'team.*'],
    limit: 20,
    enabled: !!user,
  })
  const pendingRequests = pendingRequestsRaw ?? []

  const currentTeamIds = useMemo(
    () => memberTeams.map((mt) => asObj<Team>(mt.team)?.id ?? (mt.team as string)),
    [memberTeams],
  )

  async function handleCancelRequest(requestId: string) {
    try {
      await updateRecord('team_requests', requestId, { status: 'cancelled' })
      refetchRequests()
    } catch {
      // ignore
    }
  }

  async function handleLeaveTeam() {
    if (!leavingTeam) return
    setLeaving(true)
    try {
      await deleteRecord('member_teams', leavingTeam.id)
      setLeavingTeam(null)
      refetchMemberTeams()
    } catch {
      // ignore — error already captured by deleteRecord
    } finally {
      setLeaving(false)
    }
  }

  // Fetch extra VM data from sv_vm_check (LAS, foreigner, federation, FdO, dates)
  // via the dedicated /kscw/sv-licence/me endpoint. Direct sv_vm_check.read is
  // revoked for KSCW Member because Directus 11 emits invalid `CASE WHEN 1` SQL
  // when a row filter is applied to this collection.
  interface VmCheck { id: string; licence_category: string | null; licence_activated: boolean | null; licence_validated: boolean | null; is_locally_educated: boolean | null; is_foreigner: boolean | null; federation: string | null; nationality_code: string | null }
  const [vmCheck, setVmCheck] = useState<VmCheck | null>(null)
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    kscwApi('/sv-licence/me')
      .then((r) => { if (!cancelled) setVmCheck((r as { data: VmCheck | null })?.data ?? null) })
      .catch(() => { if (!cancelled) setVmCheck(null) })
    return () => { cancelled = true }
  }, [user?.id])

  const today = toISODate(new Date())

  const { data: activeAbsencesRaw } = useCollection<Absence>('absences', {
    filter: user ? { _and: [{ member: { _eq: user.id } }, { end_date: { _gte: today } }] } : undefined,
    sort: ['start_date'],
    limit: 20,
    enabled: !!user,
  })
  const activeAbsences = activeAbsencesRaw ?? []

  // Open fines summary (visible to the member themselves).
  const { data: openFinesRaw } = useCollection<Fine>('fines', {
    filter: user ? { _and: [{ member: { _eq: user.id } }, { status: { _eq: 'open' } }] } : undefined,
    fields: ['id', 'amount', 'currency'],
    enabled: !!user,
    all: true,
  })
  const openFines = openFinesRaw ?? []
  const openFineTotal = openFines.reduce((acc, f) => acc + (Number(f.amount) || 0), 0)

  if (!user) return <Navigate to="/login" replace />

  const initials = `${user.first_name?.[0] ?? ''}${user.last_name?.[0] ?? ''}`.toUpperCase()
  const positions = coercePositions(user.position)

  return (
    <div>
      {/* Header card */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        {/* Top: avatar + name + edit */}
        <div className="flex items-center gap-4">
          {user.photo ? (
            <img
              src={getFileUrl('members', user.id, user.photo)}
              alt={memberName(user)}
              className="h-16 w-16 rounded-full object-cover ring-2 ring-brand-500/20 dark:ring-brand-400/30"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-lg font-bold text-brand-600 ring-2 ring-brand-500/20 dark:bg-brand-900/30 dark:text-brand-400 dark:ring-brand-400/30">
              {initials}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold text-gray-900 dark:text-gray-100">{memberName(user) || '—'}</h1>
            {(user.number > 0 || positions.length > 0) && (
              <div className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                {user.number > 0 && (
                  <p className="font-semibold text-gray-700 dark:text-gray-300">#{user.number}</p>
                )}
                {positions.length > 0 && (
                  <p>{positions.map((p) => (getPositionI18nKey(p) ? tt(getPositionI18nKey(p)!) : p)).join(', ')}</p>
                )}
              </div>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditOpen(true)}
            className="shrink-0"
          >
            {t('editProfile')}
          </Button>
        </div>

        {/* Teams & Roles */}
        {(memberTeams.length > 0 || user.role.length > 0) && (
          <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700">
            {memberTeams.length > 0 && (
              <div className="flex flex-col">
                <span className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('teams')}</span>
                {memberTeams.map((mt, i) => {
                  const team = asObj<Team>(mt.team)
                  const teamRoles: string[] = [tt('rolePlayer')]
                  if (team) {
                    const tid = String(team.id)
                    if (coachTeamIds.includes(tid)) teamRoles.push(tt('roleCoach'))
                    if (flattenMemberIds(team.captain).includes(String(user.id))) teamRoles.push(tt('roleCaptain'))
                  }
                  const isLast = i === memberTeams.length - 1
                  return (
                    <div key={mt.id} className="flex items-stretch">
                      {/* Vertical connector line */}
                      <div className="flex w-5 flex-col items-center">
                        <div className={`w-px flex-1 ${i === 0 ? 'bg-transparent' : 'bg-gray-300 dark:bg-gray-600'}`} />
                        <div className="h-2 w-2 shrink-0 rounded-full bg-gray-300 dark:bg-gray-500" />
                        <div className={`w-px flex-1 ${isLast ? 'bg-transparent' : 'bg-gray-300 dark:bg-gray-600'}`} />
                      </div>
                      {/* Horizontal connector + content */}
                      <div className="flex flex-1 items-center gap-2.5 py-1.5">
                        <div className="w-4 border-t border-gray-300 dark:border-gray-600" />
                        <Link to={`/teams/${team?.name ?? mt.team}`} className="flex shrink-0">
                          <TeamChip team={team?.name ?? '?'} size="sm" />
                        </Link>
                        <span className="text-xs text-gray-600 dark:text-gray-400">
                          {teamRoles.join(' · ')}
                        </span>
                        <button
                          onClick={() => setLeavingTeam({ id: mt.id, name: team?.name ?? String(mt.team) })}
                          className="ml-auto rounded-full p-0.5 text-gray-400 hover:bg-gray-100 hover:text-red-500 dark:hover:bg-gray-700 dark:hover:text-red-400"
                          title={t('leaveTeam')}
                          aria-label={t('leaveTeam')}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Pending team requests */}
            {pendingRequests.length > 0 && (
              <div className="mt-1 space-y-1">
                {pendingRequests.map((req) => (
                  <div key={req.id} className="flex items-center gap-2.5 py-1.5 pl-5">
                    <Clock className="h-3.5 w-3.5 text-amber-500" />
                    <TeamChip team={asObj<Team>(req.team)?.name ?? '?'} size="sm" />
                    <span className="text-xs text-amber-600 dark:text-amber-400">{t('pendingApproval')}</span>
                    <button
                      onClick={() => handleCancelRequest(req.id)}
                      className="ml-auto rounded-full p-0.5 text-gray-400 hover:bg-gray-100 hover:text-red-500 dark:hover:bg-gray-700 dark:hover:text-red-400"
                      title={t('common:cancel')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add Team button */}
            <button
              onClick={() => setTeamRequestOpen(true)}
              className="mt-1 flex items-center gap-1.5 py-1.5 pl-5 text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('addTeam')}
            </button>

            {user.role.length > 0 && (
              <div className={memberTeams.length > 0 ? 'mt-2 border-t border-gray-100 pt-2 dark:border-gray-700' : ''}>
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('roles')}</span>
                <div className="flex flex-col border-l-2 border-gray-300 pl-3 dark:border-gray-600">
                  {[...user.role].sort((a, b) => {
                    const order = ['user', 'coach', 'team_responsible', 'vb_admin', 'bb_admin', 'vorstand', 'admin', 'superuser', 'superadmin']
                    return (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b))
                  }).map((r) => (
                    <div key={r} className="flex items-center gap-2.5 py-1">
                      <div className="w-4 border-t border-gray-300 dark:border-gray-600" />
                      <StatusBadge status={r} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Contact Info */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('contact')}</h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('contactPrivacyNotice')}</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center gap-2">
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('email')}</p>
              {user.hide_email && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">{t('hidden')}</span>
              )}
            </div>
            <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">{user.email || '—'}</p>
          </div>
          <div className="rounded-lg border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center gap-2">
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('phone')}</p>
              {user.hide_phone && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">{t('hidden')}</span>
              )}
            </div>
            <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">{user.phone || '—'}</p>
          </div>
          <div className="rounded-lg border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center gap-2">
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('birthdate')}</p>
              {user.birthdate_visibility === 'hidden' && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">{t('hidden')}</span>
              )}
              {user.birthdate_visibility === 'year_only' && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">{t('yearOnly')}</span>
              )}
            </div>
            <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
              {user.birthdate ? formatDate(user.birthdate) : '—'}
            </p>
          </div>
          <div className="rounded-lg border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('licences')}</p>
            {(() => {
              const lics = licencesOf(user)
              return lics.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {lics.map((l) => (
                    <span key={l} className="inline-flex rounded-full bg-gold-100 px-2.5 py-0.5 text-xs font-medium text-gold-900 dark:bg-gold-400/20 dark:text-gold-300">
                      {tt(LICENCE_LABELS[l])}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">—</p>
              )
            })()}
          </div>
        </div>
      </div>

      {/* Swiss Volley Licence Info — volleyball members only */}
      {(primarySport === 'volleyball' || primarySport === 'both') && user.license_nr && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Swiss Volley</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('svSyncInfo')}</p>
          <div className="mt-3">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('licence')}</span>
            <div className="space-y-2.5">
              {/* Licence card — absence-card style */}
              <div className="rounded-lg border bg-white dark:border-gray-700 dark:bg-gray-800">
                {/* Top row: badge + licence nr + status checks */}
                <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                  {vmCheck?.licence_category && (
                    <span className="inline-flex rounded-full bg-gold-100 px-2.5 py-0.5 text-xs font-medium text-gold-900 dark:bg-gold-400/20 dark:text-gold-300">
                      {vmCheck.licence_category}
                    </span>
                  )}
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {t('licenseNr')}: {user.license_nr}
                  </span>
                  {/* LAS / Foreigner / FdO badges */}
                  {vmCheck?.is_locally_educated && (
                    <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
                      {t('svLas')}
                    </span>
                  )}
                  {vmCheck?.is_foreigner && (
                    <span className="inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">
                      {t('svForeigner')}
                    </span>
                  )}
                  {vmCheck?.nationality_code && vmCheck.nationality_code !== 'SUI' && (
                    <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                      FdO: {vmCheck.nationality_code}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-3">
                    {vmCheck?.federation && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">{vmCheck.federation}</span>
                    )}
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('activated')}</span>
                      {vmCheck?.licence_activated == null
                        ? <span className="text-sm text-gray-400">—</span>
                        : vmCheck.licence_activated
                          ? <span className="text-sm text-green-600 dark:text-green-400">&#10003;</span>
                          : <span className="text-sm text-red-500 dark:text-red-400">&#10007;</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('validated')}</span>
                      {vmCheck?.licence_validated == null
                        ? <span className="text-sm text-gray-400">—</span>
                        : vmCheck.licence_validated
                          ? <span className="text-sm text-green-600 dark:text-green-400">&#10003;</span>
                          : <span className="text-sm text-red-500 dark:text-red-400">&#10007;</span>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <MessagingSettingsCard />

      {/* Open fines strip */}
      {openFines.length > 0 && (
        <div className="mt-6">
          <Link
            to="/fines"
            className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-900/20 dark:hover:bg-amber-900/30"
          >
            <div>
              <div className="text-sm font-medium text-amber-900 dark:text-amber-200">
                {t('outstandingFines', { amount: formatFineAmount(openFineTotal) })}
              </div>
              <div className="text-xs text-amber-700 dark:text-amber-300">
                {t('outstandingFinesCount', { count: openFines.length })}
              </div>
            </div>
            <span className="text-sm text-amber-700 dark:text-amber-300">→</span>
          </Link>
        </div>
      )}

      {/* Active Absences */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('activeAbsences')}</h2>
          <Link
            to="/absences"
            className="text-sm text-brand-600 hover:text-brand-800 dark:text-gold-400 dark:hover:text-gold-300"
          >
            {t('showAll')}
          </Link>
        </div>
        {activeAbsences.length > 0 ? (
          <div className="mt-3 space-y-2">
            {activeAbsences.slice(0, 5).map((a) => (
              <div key={a.id} className="rounded-lg border bg-white dark:border-gray-700 dark:bg-gray-800">
                <div className="flex items-center gap-3 px-4 py-3">
                  <StatusBadge status={a.reason} />
                  {a.reason_detail && (
                    <span className="text-sm text-gray-500 dark:text-gray-400">{a.reason_detail}</span>
                  )}
                </div>
                <div className="border-t border-gray-100 px-4 py-2 dark:border-gray-700">
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {formatDate(a.start_date)}
                    {a.start_date !== a.end_date && ` — ${formatDate(a.end_date)}`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{t('noActiveAbsences')}</p>
        )}
      </div>

      {/* Danger Zone */}
      <div className="mt-8 rounded-2xl border border-red-200 bg-red-50/30 p-5 dark:border-red-900/40 dark:bg-red-950/10">
        <h2 className="text-base font-semibold text-red-600 dark:text-red-400">{t('dangerZone')}</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t('deleteAccountDescription')}</p>
        <div className="mt-4">
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
            {t('deleteAccount')}
          </Button>
        </div>
      </div>

      <ProfileEditModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
      />
      <TeamRequestModal
        open={teamRequestOpen}
        onClose={() => setTeamRequestOpen(false)}
        onComplete={() => {
          setTeamRequestOpen(false)
          refetchRequests()
        }}
        currentTeamIds={currentTeamIds}
      />
      <DeleteAccountModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        userEmail={user.email}
      />
      <Modal open={!!leavingTeam} onClose={() => setLeavingTeam(null)} title={t('leaveTeamTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('leaveTeamConfirm', { team: leavingTeam?.name ?? '' })}
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setLeavingTeam(null)}>
              {t('common:cancel')}
            </Button>
            <Button variant="destructive" onClick={handleLeaveTeam} loading={leaving} disabled={leaving}>
              {t('leaveTeam')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
