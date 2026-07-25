import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, ArrowRight, X } from 'lucide-react'
import type { Member, Team, MemberTeam, LicenceType, ScorerDelegation } from '../../../types'
import { memberDisplayName, memberFirstName } from '../../../utils/relations'

interface DelegationModalProps {
  role: ScorerDelegation['role']
  roleLabel: string
  gameLabel: string
  dutyTeamId: string
  members: Member[]
  teams: Team[]
  memberTeams: MemberTeam[]
  currentUserId: string
  onDelegate: (toMemberId: string, toTeamId: string) => void
  onClose: () => void
}

const ROLE_LICENCE_MAP: Record<string, LicenceType | LicenceType[]> = {
  scorer: 'scorer_vb',
  scorer_scoreboard: 'scorer_vb',
  bb_scorer: 'otr1_bb',
  bb_timekeeper: 'otr1_bb',
  // The 24s desk needs OTR2 or any OTN. `otn_bb` is the coarse legacy flag kept
  // by migration 228 — it is ORed with, never replaced by, the two levels, so
  // its current holders keep their eligibility.
  bb_24s_official: ['otr2_bb', 'otn_bb', 'otn1_bb', 'otn2_bb'],
}

function getMemberTeamId(memberId: string, memberTeams: MemberTeam[]): string | undefined {
  return memberTeams.find((mt) => mt.member === memberId)?.team
}

export default function DelegationModal({
  role,
  roleLabel,
  gameLabel,
  dutyTeamId,
  members,
  teams,
  memberTeams,
  currentUserId,
  onDelegate,
  onClose,
}: DelegationModalProps) {
  const { t, i18n } = useTranslation('scorer')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<{ memberId: string; teamId: string; sameTeam: boolean } | null>(null)

  // Build team membership map
  const memberTeamMap = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const mt of memberTeams) {
      if (!map.has(mt.member)) map.set(mt.member, [])
      map.get(mt.member)!.push(mt.team)
    }
    return map
  }, [memberTeams])

  const guestsOnDutyTeam = useMemo(() => {
    const guests = new Set<string>()
    for (const mt of memberTeams) {
      if (mt.team === dutyTeamId && (mt.guest_level ?? 0) > 0) {
        guests.add(mt.member)
      }
    }
    return guests
  }, [memberTeams, dutyTeamId])

  // Filter eligible members by licence
  const eligibleMembers = useMemo(() => {
    const requiredLicence = ROLE_LICENCE_MAP[role]
    return members.filter((m) => {
      if (m.id === currentUserId) return false
      if (!m.kscw_membership_active || guestsOnDutyTeam.has(m.id)) return false
      if (requiredLicence) {
        const licences = Array.isArray(requiredLicence) ? requiredLicence : [requiredLicence]
        if (!licences.some((l) => m[l])) return false
      }
      return true
    })
  }, [members, role, currentUserId, guestsOnDutyTeam])

  // Split into same-team and cross-team
  const { sameTeamMembers, crossTeamMembers } = useMemo(() => {
    const dutyTeamMemberIds = new Set(
      memberTeams.filter((mt) => mt.team === dutyTeamId).map((mt) => mt.member),
    )
    const same: Member[] = []
    const cross: Member[] = []
    for (const m of eligibleMembers) {
      if (dutyTeamMemberIds.has(m.id)) same.push(m)
      else cross.push(m)
    }
    const collator = new Intl.Collator(i18n.language)
    const sortFn = (a: Member, b: Member) =>
      collator.compare(`${a.last_name} ${memberFirstName(a)}`, `${b.last_name} ${memberFirstName(b)}`)
    same.sort(sortFn)
    cross.sort(sortFn)
    return { sameTeamMembers: same, crossTeamMembers: cross }
  }, [eligibleMembers, memberTeams, dutyTeamId])

  // Apply search filter
  const q = search.toLowerCase().trim()
  const filteredSame = q ? sameTeamMembers.filter((m) => memberDisplayName(m).toLowerCase().includes(q)) : sameTeamMembers
  const filteredCross = q ? crossTeamMembers.filter((m) => memberDisplayName(m).toLowerCase().includes(q)) : crossTeamMembers
  const hasResults = filteredSame.length > 0 || filteredCross.length > 0

  const teamNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const team of teams) map.set(team.id, team.name)
    return map
  }, [teams])

  function handleSelect(member: Member, sameTeam: boolean) {
    const teamId = sameTeam ? dutyTeamId : (getMemberTeamId(member.id, memberTeams) ?? '')
    setSelected({ memberId: member.id, teamId, sameTeam })
  }

  function handleConfirm() {
    if (!selected) return
    onDelegate(selected.memberId, selected.teamId)
  }

  const selectedMember = selected ? members.find((m) => m.id === selected.memberId) : null
  const selectedName = selectedMember ? memberDisplayName(selectedMember) : ''

  function renderMemberRow(member: Member, sameTeam: boolean) {
    const isSelected = selected?.memberId === member.id
    const memberTeamIds = memberTeamMap.get(member.id) ?? []
    const teamNames = memberTeamIds.map((id) => teamNameMap.get(id)).filter(Boolean)

    return (
      <button
        key={member.id}
        onClick={() => handleSelect(member, sameTeam)}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors ${
          isSelected
            ? 'bg-brand-50 ring-2 ring-brand-500 dark:bg-brand-900/30 dark:ring-brand-400'
            : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {memberDisplayName(member)}
          </div>
          {teamNames.length > 0 && (
            <div className="text-xs text-gray-500 dark:text-gray-400">{teamNames.join(', ')}</div>
          )}
        </div>
        {/* No per-row "needs confirmation" pill: every delegation (teammate or
            external) must be accepted by the recipient (migration 121), so it
            conveyed nothing. The confirm step states the request is pending. */}
        <ArrowRight className="h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" />
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative max-h-[90vh] w-full overflow-hidden rounded-t-2xl bg-white shadow-xl dark:bg-gray-800 sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t('delegateTitle')}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {roleLabel} · {gameLabel}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label={t('cancelAction')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Confirmation step */}
        {selected ? (
          <div className="p-4">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t('delegateConfirmTitle')}
            </h4>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {t('delegateConfirmPending', { name: selectedName })}
            </p>
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => setSelected(null)}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                {t('cancelAction')}
              </button>
              <button
                onClick={handleConfirm}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
              >
                <ArrowRight className="h-4 w-4" />
                {t('delegate')}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('searchMember')}
                  className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-500"
                  autoFocus
                />
              </div>
            </div>

            {/* Member list */}
            <div className="max-h-[50vh] overflow-y-auto overscroll-contain p-2">
              {!hasResults && (
                <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                  {t('noMembersFound')}
                </p>
              )}

              {filteredSame.length > 0 && (
                <div className="mb-2">
                  <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {t('delegateSameTeam')}
                  </p>
                  {filteredSame.map((m) => renderMemberRow(m, true))}
                </div>
              )}

              {filteredCross.length > 0 && (
                <div>
                  <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {t('delegateCrossTeam')}
                  </p>
                  {filteredCross.map((m) => renderMemberRow(m, false))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
