import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import SearchableSelect from '@/components/ui/SearchableSelect'
import TeamChip from '../../components/TeamChip'
import { useAuth } from '../../hooks/useAuth'
import { useCollection } from '../../lib/query'
import type { Team, MemberTeam } from '../../types'
import { createRecord, deleteRecord } from '../../lib/api'
import { getCurrentSeason } from '../../utils/dateHelpers'
import { asObj } from '../../utils/relations'

interface TeamRequestModalProps {
  open: boolean
  onClose: () => void
  /** Called after a join request is sent (parents typically close + refetch). */
  onComplete: () => void
  currentTeamIds: string[]
  /**
   * Show the "leave a team" section (default true). ProfilePage passes false
   * because it already exposes inline per-team leave buttons in its team tree.
   */
  showLeave?: boolean
  /**
   * Called after a membership change that should NOT close the modal
   * (i.e. leaving a team) so the parent can refresh its team lists/counts.
   */
  onChange?: () => void
}

interface TeamRequest {
  id: string
  member: string
  team: Team | string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
}

type ExpandedMemberTeam = MemberTeam & { team: Team | string }

export default function TeamRequestModal({
  open,
  onClose,
  onComplete,
  currentTeamIds,
  showLeave = true,
  onChange,
}: TeamRequestModalProps) {
  const { t } = useTranslation('auth')
  const { user } = useAuth()
  const [selectedTeam, setSelectedTeam] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [confirmLeaveId, setConfirmLeaveId] = useState<string | null>(null)
  const [leavingId, setLeavingId] = useState<string | null>(null)

  // Current-season teams the user is on — the "leave" source list.
  const { data: myTeamsRaw, refetch: refetchMyTeams } = useCollection<ExpandedMemberTeam>('member_teams', {
    filter: user
      ? { _and: [{ member: { _eq: user.id } }, { season: { _eq: getCurrentSeason() } }] }
      : { id: { _eq: -1 } },
    fields: ['*', 'team.*'],
    limit: 20,
    enabled: open && showLeave && !!user,
  })
  const myTeams = myTeamsRaw ?? []

  // Fetch all active teams
  const { data: allTeamsRaw } = useCollection<Team>('teams', {
    filter: { active: { _eq: true } },
    sort: ['name'],
    limit: 50,
  })
  const allTeams = allTeamsRaw ?? []

  // Fetch existing pending requests for this user
  const { data: pendingRequestsRaw } = useCollection<TeamRequest>('team_requests', {
    filter: user ? { _and: [{ member: { _eq: user.id } }, { status: { _eq: 'pending' } }] } : { id: { _eq: -1 } },
    limit: 50,
  })
  const pendingRequests = pendingRequestsRaw ?? []

  const pendingTeamIds = useMemo(
    () => pendingRequests.map((r) => r.team),
    [pendingRequests],
  )

  // Filter out teams user is already on or has pending requests for
  const availableTeams = useMemo(
    () => allTeams.filter((tm) => !currentTeamIds.includes(tm.id) && !pendingTeamIds.includes(tm.id)),
    [allTeams, currentTeamIds, pendingTeamIds],
  )

  async function handleSubmit() {
    if (!selectedTeam || !user) return
    setSubmitting(true)
    setError('')

    try {
      await createRecord('team_requests', {
        member: user.id,
        team: selectedTeam,
        status: 'pending',
      })
      setSelectedTeam('')
      onComplete()
    } catch {
      setError(t('teamRequestError'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLeave(mtId: string) {
    setLeavingId(mtId)
    try {
      await deleteRecord('member_teams', mtId)
      setConfirmLeaveId(null)
      refetchMyTeams()
      onChange?.()
    } catch {
      // error already captured by deleteRecord
    } finally {
      setLeavingId(null)
    }
  }

  function handleClose() {
    setSelectedTeam('')
    setError('')
    setConfirmLeaveId(null)
    onClose()
  }

  const showLeaveSection = showLeave && myTeams.length > 0

  return (
    <Modal open={open} onClose={handleClose} title={t(showLeave ? 'manageTeamsTitle' : 'addTeamTitle')}>
      <div className="space-y-5">
        {/* Leave a team */}
        {showLeaveSection && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t('yourTeams')}
            </p>
            <div className="divide-y divide-gray-100 rounded-lg border dark:divide-gray-700 dark:border-gray-700">
              {myTeams.map((mt) => {
                const team = asObj<Team>(mt.team)
                const name = team?.name ?? String(mt.team)
                const confirming = confirmLeaveId === mt.id
                return (
                  <div key={mt.id} className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <TeamChip team={name} size="sm" />
                      <button
                        onClick={() => setConfirmLeaveId(confirming ? null : mt.id)}
                        className="ml-auto text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      >
                        {t('leaveTeam')}
                      </button>
                    </div>
                    {confirming && (
                      <div className="mt-2.5 rounded-md bg-red-50 p-3 dark:bg-red-950/20">
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          {t('leaveTeamConfirm', { team: name })}
                        </p>
                        <div className="mt-2 flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setConfirmLeaveId(null)}>
                            {t('common:cancel')}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleLeave(mt.id)}
                            loading={leavingId === mt.id}
                            disabled={leavingId === mt.id}
                          >
                            {t('leaveTeam')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Join a team */}
        <div className="space-y-3">
          {showLeaveSection && (
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t('addTeamTitle')}
            </p>
          )}
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('addTeamDescription')}</p>

          {availableTeams.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('noTeamsAvailable')}</p>
          ) : (
            <SearchableSelect
              label={t('selectTeam')}
              placeholder={t('selectTeamPlaceholder')}
              value={selectedTeam}
              onChange={setSelectedTeam}
              options={availableTeams.map((tm) => ({
                value: tm.id,
                label: tm.full_name || tm.name,
              }))}
            />
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <Button variant="ghost" onClick={handleClose}>
            {t('common:cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!selectedTeam || submitting} loading={submitting}>
            {t('sendRequest')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
