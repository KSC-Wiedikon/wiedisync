import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { useTeamMembers } from '../../hooks/useTeamMembers'
import { asObj } from '../../utils/relations'
import type { Member, Team } from '../../types'

export interface FinePickSelection {
  /** `null` = fine the team itself (migration 350) — no individual member owes it. */
  memberId: string | null
  memberName: string
  teamId: string
  teamName: string
}

type FineTarget = 'member' | 'team'

interface Props {
  open: boolean
  onClose: () => void
  /** Teams the leader may fine for (their coached/TR teams, or all for admins). */
  teams: Team[]
  /** Called with the chosen member+team; the caller then opens IssueFineModal. */
  onPicked: (sel: FinePickSelection) => void
}

/**
 * Standalone "Issue fine" entry point: pick a team then a member — or the team
 * itself — then hand off to IssueFineModal for category/amount/reason.
 * Complements the roster's automatic late-sign-in prompt, which was previously
 * the only way to fine. Roster read via useTeamMembers (single-level
 * member_teams fetch — the M2M-safe path).
 */
export default function IssueFinePickerModal({ open, onClose, teams, onPicked }: Props) {
  const { t } = useTranslation(['fines', 'common'])
  // Mounted only while open (see FinesPage), so useState gives a fresh selection
  // each time — no reset effect needed.
  const [target, setTarget] = useState<FineTarget>('member')
  const [teamId, setTeamId] = useState('')
  const [memberId, setMemberId] = useState('')

  // Roster is only needed when fining an individual — skip the fetch entirely
  // for a team-level fine.
  const { members, isLoading } = useTeamMembers(
    target === 'member' && teamId ? teamId : undefined,
  )

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

  // Group the team dropdown by sport — the club runs two parallel team sets and
  // a flat A–Z list interleaves them (H1 next to "Herren 1"). `teams.sport` is
  // nullable in Postgres, so an unset one gets its own "Other" group rather
  // than being silently filed under volleyball.
  const teamGroups = useMemo(() => {
    const bySport = new Map<string, Team[]>()
    for (const tm of teams) {
      const sport = tm.sport === 'volleyball' || tm.sport === 'basketball' ? tm.sport : 'other'
      const list = bySport.get(sport)
      if (list) list.push(tm)
      else bySport.set(sport, [tm])
    }
    // Volleyball first (the club's founding sport, and the larger set), then
    // basketball. Teams inside a group keep the caller's sort.
    return (['volleyball', 'basketball', 'other'] as const)
      .map((sport) => ({ sport, label: t(`common:${sport}`), teams: bySport.get(sport) ?? [] }))
      .filter((g) => g.teams.length > 0)
  }, [teams, t])

  const teamName = teams.find((tm) => String(tm.id) === teamId)?.name ?? ''
  const canContinue = !!teamId && (target === 'team' || !!memberId)

  function handleContinue() {
    if (!teamId) return
    if (target === 'team') {
      onPicked({ memberId: null, memberName: '', teamId, teamName: String(teamName) })
      return
    }
    const m = memberOptions.find((o) => o.id === memberId)
    if (!m) return
    onPicked({ memberId: m.id, memberName: m.name, teamId, teamName: String(teamName) })
  }

  return (
    <Modal open={open} onClose={onClose} title={t('fines:issueFine')}>
      <div className="space-y-4">
        {/* Who owes it: a member, or the team as a whole (forfait, missing scorer…). */}
        <fieldset>
          <legend className="text-xs font-medium text-muted-foreground">
            {t('fines:targetLabel')}
          </legend>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            {(['member', 'team'] as const).map((opt) => (
              <label
                key={opt}
                className={`flex min-h-[44px] flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  target === opt
                    ? 'border-amber-500 bg-amber-50 text-amber-900 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-200'
                    : 'border-input bg-card text-foreground/85 hover:bg-accent'
                }`}
              >
                <input
                  type="radio"
                  name="fine-target"
                  value={opt}
                  checked={target === opt}
                  onChange={() => { setTarget(opt); setMemberId('') }}
                  className="h-4 w-4 accent-amber-600"
                />
                {opt === 'member' ? t('fines:targetMember') : t('fines:targetTeam')}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block text-xs font-medium text-muted-foreground">
          {t('fines:colTeam')}
          <select
            value={teamId}
            onChange={(e) => { setTeamId(e.target.value); setMemberId('') }}
            className="mt-1 h-11 w-full sm:h-9 rounded-lg border border-input bg-card px-3 text-sm text-foreground dark:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">{t('fines:pickTeamPlaceholder')}</option>
            {teamGroups.map((g) => (
              <optgroup key={g.sport} label={g.label}>
                {g.teams.map((tm) => (
                  <option key={tm.id} value={String(tm.id)}>{tm.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        {target === 'member' ? (
          <label className="block text-xs font-medium text-muted-foreground">
            {t('fines:colMember')}
            <select
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              disabled={!teamId || isLoading}
              className="mt-1 h-11 w-full disabled:opacity-50 sm:h-9 rounded-lg border border-input bg-card px-3 text-sm text-foreground dark:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">
                {!teamId ? t('fines:pickTeamFirst') : isLoading ? t('common:loading') : t('fines:pickMemberPlaceholder')}
              </option>
              {memberOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
            {t('fines:targetTeamHint')}
          </p>
        )}

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
