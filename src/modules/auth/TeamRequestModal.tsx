import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import SearchableSelect from '@/components/ui/SearchableSelect'
import TeamChip from '../../components/TeamChip'
import { useAuth } from '../../hooks/useAuth'
import { useCollection } from '../../lib/query'
import type { Team, MemberTeam } from '../../types'
import { createRecord, deleteRecord } from '../../lib/api'
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
  const { t } = useTranslation(['auth', 'common'])
  const { user } = useAuth()
  const [selectedTeam, setSelectedTeam] = useState('')
  const [selectedSport, setSelectedSport] = useState<Team['sport'] | ''>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [confirmLeaveId, setConfirmLeaveId] = useState<string | null>(null)
  const [leavingId, setLeavingId] = useState<string | null>(null)

  // Current-season teams the user is on — the "leave" source list. Gated on
  // teams.active, not member_teams.season: a season-stamp guard empties this
  // list between the Jun-1 cutover and the rollover, and the member then cannot
  // remove themselves from a team (nor can the coach, RosterEditor being blank
  // for the same reason).
  const {
    data: myTeamsRaw,
    isLoading: myTeamsLoading,
    isError: myTeamsError,
    isPlaceholderData: myTeamsPlaceholder,
    refetch: refetchMyTeams,
  } = useCollection<ExpandedMemberTeam>('member_teams', {
    filter: user
      ? { _and: [{ member: { _eq: user.id } }, { team: { active: { _eq: true } } }] }
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

  // Filter out teams user is already on or has pending requests for, plus
  // teams of the other gender (teams.gender, migration 172): a female player
  // never sees men's teams and vice versa. Mixed/unknown teams and members
  // without a recorded sex are never filtered.
  const userSex = user?.sex ?? null
  const availableTeams = useMemo(
    () => allTeams.filter((tm) =>
      !currentTeamIds.includes(tm.id) &&
      !pendingTeamIds.includes(tm.id) &&
      (!userSex || !tm.gender || tm.gender === 'mixed' || tm.gender === userSex),
    ),
    [allTeams, currentTeamIds, pendingTeamIds, userSex],
  )

  // Sport step: which sports actually have joinable teams. Single-sport
  // clubsides skip the step (auto-selected).
  const sports = useMemo(
    () => (['volleyball', 'basketball'] as const).filter(
      (s) => availableTeams.some((tm) => tm.sport === s),
    ),
    [availableTeams],
  )
  const effectiveSport = selectedSport || (sports.length === 1 ? sports[0] : '')
  const sportTeams = useMemo(
    () => availableTeams.filter((tm) => tm.sport === effectiveSport),
    [availableTeams, effectiveSport],
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
      // deleteRecord already captured the error; surface it so a failed leave
      // isn't mistaken for success (was a silent swallow).
      toast.error(t('leaveTeamError'))
    } finally {
      setLeavingId(null)
    }
  }

  function handleClose() {
    setSelectedTeam('')
    setSelectedSport('')
    setError('')
    setConfirmLeaveId(null)
    onClose()
  }

  // The member_teams fetch only starts when the modal opens, and "not fetched
  // yet" arrives as the same [] as "on no teams" — so the first frame of
  // "Manage teams" used to paint the join half alone, reading as "you are on
  // no teams, nothing to leave", and then one RTT later insert the chip list
  // ABOVE the join controls, sliding the sport toggles under a finger already
  // reaching for them. Hold a skeleton for that frame instead.
  //
  // ⚠ `isError` is the escape hatch: on a failed fetch TanStack leaves `data`
  // undefined with `isLoading` false, so a `=== undefined` gate on its own
  // would never release. On error we fall through to the old behaviour (no
  // leave section) rather than a permanent skeleton — the query cache's global
  // handler already reports the failure.
  // `isPlaceholderData` covers the other direction: `keepPreviousData` is a
  // global default (lib/query.tsx), so an acting-member swap would otherwise
  // show the previous member's teams as if they were yours.
  const myTeamsPending =
    showLeave && !!user && !myTeamsError &&
    (myTeamsLoading || myTeamsPlaceholder || myTeamsRaw === undefined)
  const showLeaveSection = showLeave && !myTeamsPending && myTeams.length > 0

  return (
    <Modal open={open} onClose={handleClose} title={t(showLeave ? 'manageTeamsTitle' : 'addTeamTitle')}>
      <div className="space-y-5">
        {/* Leave a team — skeleton until the membership list has actually loaded,
            so the join controls start at roughly their final Y. */}
        {myTeamsPending && (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {t('yourTeams')}
            </p>
            <div className="divide-y divide-border/60 rounded-xl border border-hairline">
              <div className="px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <span aria-hidden="true" className="inline-block h-[22px] w-24 animate-pulse rounded-full bg-stone-200/80 dark:bg-muted" />
                  <span aria-hidden="true" className="ml-auto inline-block h-4 w-16 animate-pulse rounded bg-stone-200/80 dark:bg-muted" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Leave a team */}
        {showLeaveSection && (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {t('yourTeams')}
            </p>
            <div className="divide-y divide-border/60 rounded-xl border border-hairline">
              {myTeams.map((mt) => {
                const team = asObj<Team>(mt.team)
                const name = team?.name ?? String(mt.team)
                const confirming = confirmLeaveId === mt.id
                return (
                  <div key={mt.id} className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <TeamChip team={name} size="sm" />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmLeaveId(confirming ? null : mt.id)}
                        className="ml-auto shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/30 dark:hover:text-red-300"
                      >
                        {t('leaveTeam')}
                      </Button>
                    </div>
                    {confirming && (
                      <div className="mt-2.5 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-950/40">
                        <p className="text-xs text-muted-foreground">
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
          {(showLeaveSection || myTeamsPending) && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {t('addTeamTitle')}
            </p>
          )}
          <p className="text-sm text-muted-foreground">{t('addTeamDescription')}</p>

          {availableTeams.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noTeamsAvailable')}</p>
          ) : (
            <>
              {sports.length > 1 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t('selectSport')}</p>
                  <div className="flex gap-2">
                    {sports.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => { setSelectedSport(s); setSelectedTeam('') }}
                        className={
                          'min-h-11 flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ' +
                          (effectiveSport === s
                            ? 'border-selected bg-selected text-selected-foreground'
                            : 'border-border bg-card text-muted-foreground hover:bg-accent')
                        }
                      >
                        {t(`common:${s}`)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {effectiveSport && (
                sportTeams.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('noTeamsAvailable')}</p>
                ) : (
                  <SearchableSelect
                    label={t('selectTeam')}
                    placeholder={t('selectTeamPlaceholder')}
                    value={selectedTeam}
                    onChange={setSelectedTeam}
                    options={sportTeams.map((tm) => ({
                      value: tm.id,
                      label: tm.full_name || tm.name,
                    }))}
                  />
                )
              )}
            </>
          )}

          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
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
