import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { useTeamMembers } from '../../hooks/useTeamMembers'
import { asObj } from '../../utils/relations'
import type { Member, Team } from '../../types'

export interface FinePickSelection {
  memberId: string
  memberName: string
  teamId: string
  teamName: string
}

interface Props {
  open: boolean
  onClose: () => void
  /** Teams the leader may fine for (their coached/TR teams, or all for admins). */
  teams: Team[]
  /** Called with the chosen member+team; the caller then opens IssueFineModal. */
  onPicked: (sel: FinePickSelection) => void
}

/**
 * Standalone "Issue fine" entry point: pick a team then a member, then hand off
 * to IssueFineModal for category/amount/reason. Complements the roster's
 * automatic late-sign-in prompt, which was previously the only way to fine.
 * Roster read via useTeamMembers (single-level member_teams fetch — the
 * M2M-safe path).
 */
export default function IssueFinePickerModal({ open, onClose, teams, onPicked }: Props) {
  const { t } = useTranslation(['fines', 'common'])
  // Mounted only while open (see FinesPage), so useState gives a fresh selection
  // each time — no reset effect needed.
  const [teamId, setTeamId] = useState('')
  const [memberId, setMemberId] = useState('')

  const { members, isLoading } = useTeamMembers(teamId || undefined)

  const memberOptions = useMemo(
    () =>
      members
        .map((mt) => asObj<Member>(mt.member))
        .filter((m): m is Member => !!m)
        .map((m) => ({
          id: String(m.id),
          name: `${m.last_name ?? ''} ${m.nickname || m.first_name || ''}`.trim() || `#${m.id}`,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [members],
  )

  const teamName = teams.find((tm) => String(tm.id) === teamId)?.name ?? ''
  const canContinue = !!teamId && !!memberId

  function handleContinue() {
    const m = memberOptions.find((o) => o.id === memberId)
    if (!teamId || !m) return
    onPicked({ memberId: m.id, memberName: m.name, teamId, teamName: String(teamName) })
  }

  return (
    <Modal open={open} onClose={onClose} title={t('fines:issueFine')}>
      <div className="space-y-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('fines:colTeam')}
          <select
            value={teamId}
            onChange={(e) => { setTeamId(e.target.value); setMemberId('') }}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">{t('fines:pickTeamPlaceholder')}</option>
            {teams.map((tm) => (
              <option key={tm.id} value={String(tm.id)}>{tm.name}</option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('fines:colMember')}
          <select
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            disabled={!teamId || isLoading}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">
              {!teamId ? t('fines:pickTeamFirst') : isLoading ? t('common:loading') : t('fines:pickMemberPlaceholder')}
            </option>
            {memberOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t('common:cancel')}
          </Button>
          <Button type="button" size="sm" disabled={!canContinue} onClick={handleContinue}>
            {t('fines:pickContinue')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
