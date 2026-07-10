import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Member, Team, LicenceType } from '../../../types'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { Phone, Mail, Hand, ArrowRightLeft, Clock, Check } from 'lucide-react'
import TeamSelect from '../../../components/TeamSelect'
import { formatDateTimeCompact } from '../../../utils/dateHelpers'

interface AssignmentEditorProps {
  label: string
  requiredLicence?: LicenceType | LicenceType[]
  teamValue: string
  personValue: string
  members: Member[]
  teams: Team[]
  teamMemberIds: Map<string, Set<string>>
  /** Sport of this duty — scopes person-first team derivation to this sport. */
  sport: 'volleyball' | 'basketball'
  onTeamChange: (teamId: string) => void
  onPersonChange: (memberId: string) => void
  disabled: boolean
  showContact?: boolean
  selfAssignButton?: boolean
  onSelfAssign?: () => void
  /** Set of member IDs who are guests on any team */
  guestMemberIds?: Set<string>
  /** Whether the editor should show admin controls (dropdowns) */
  canEdit: boolean
  /** Whether the current user is the assigned member for this role */
  isCurrentUserAssigned?: boolean
  /** Callback to open delegation modal */
  onDelegate?: () => void
  /** Pending outgoing delegation target name */
  pendingDelegationName?: string
  /** Whether the game's duty is confirmed */
  dutyConfirmed?: boolean
  /** Who confirmed this duty + when (migration 123) — shown only when showConfirmedBy. */
  confirmedByName?: string | null
  confirmedAt?: string | null
  /** Admins only: reveal the "Confirmed by …" line. */
  showConfirmedBy?: boolean
  /** Callback to hide/collapse this assignment row */
  onHide?: () => void
  /** Hide the team dropdown (person-only) — for extra roles that share a duty
   *  team already chosen by another role (e.g. BB timekeeper/24s under the same
   *  duty team as the scorer). Person-first still works (derives + sets the team). */
  hideTeam?: boolean
}

export default function AssignmentEditor({
  label,
  requiredLicence,
  teamValue,
  personValue,
  members,
  teams,
  teamMemberIds,
  sport,
  onTeamChange,
  onPersonChange,
  disabled,
  showContact,
  selfAssignButton,
  onSelfAssign,
  guestMemberIds,
  canEdit,
  isCurrentUserAssigned,
  onDelegate,
  pendingDelegationName,
  dutyConfirmed,
  confirmedByName,
  confirmedAt,
  showConfirmedBy,
  onHide,
  hideTeam,
}: AssignmentEditorProps) {
  const { t, i18n } = useTranslation('scorer')

  // Person-first support: teams of THIS sport, and each member's sport teams —
  // so picking a person can auto-derive their duty team (ask if in several).
  const sportTeamIds = useMemo(
    () => new Set(teams.filter((tm) => tm.sport === sport).map((tm) => tm.id)),
    [teams, sport],
  )
  const memberSportTeams = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const [teamId, set] of teamMemberIds) {
      if (!sportTeamIds.has(teamId)) continue
      for (const mid of set) {
        const arr = m.get(mid)
        if (arr) arr.push(teamId)
        else m.set(mid, [teamId])
      }
    }
    return m
  }, [teamMemberIds, sportTeamIds])

  const filteredMembers = useMemo(() => {
    let list = members.filter((m) => m.kscw_membership_active && !guestMemberIds?.has(m.id))
    if (requiredLicence) {
      const licences = Array.isArray(requiredLicence) ? requiredLicence : [requiredLicence]
      list = list.filter((m) => licences.some((l) => m[l]))
    }
    if (teamValue) {
      // Team chosen → only that team's members.
      const teamMembers = teamMemberIds.get(teamValue)
      if (teamMembers) {
        list = list.filter((m) => teamMembers.has(m.id))
      }
    } else {
      // Person-first → any licence-eligible member who is in a team of this sport
      // (so their duty team can be derived on pick).
      list = list.filter((m) => memberSportTeams.has(m.id))
    }
    // Ensure the currently assigned person is always in the list
    if (personValue && !list.some((m) => m.id === personValue)) {
      const assigned = members.find((m) => m.id === personValue)
      if (assigned) list.push(assigned)
    }
    return list.sort((a, b) =>
      `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, i18n.language),
    )
  }, [members, requiredLicence, teamValue, teamMemberIds, memberSportTeams, personValue, guestMemberIds, i18n.language])

  // Picking a person with no duty team yet auto-fills their team; if they're in
  // more than one team of this sport, ask which one covers this duty.
  const [teamPrompt, setTeamPrompt] = useState<{ memberId: string; teamIds: string[] } | null>(null)
  function handlePersonPick(memberId: string) {
    if (teamValue || !memberId) { onPersonChange(memberId); return }
    const tids = memberSportTeams.get(memberId) ?? []
    if (tids.length === 1) { onTeamChange(tids[0]); onPersonChange(memberId) }
    else if (tids.length > 1) { setTeamPrompt({ memberId, teamIds: tids }) }
    else { onPersonChange(memberId) }
  }
  function resolveTeamPrompt(teamId: string) {
    if (!teamPrompt) return
    onTeamChange(teamId)
    onPersonChange(teamPrompt.memberId)
    setTeamPrompt(null)
  }
  const promptName = teamPrompt
    ? (() => { const m = members.find((x) => x.id === teamPrompt.memberId); return m ? `${m.first_name} ${m.last_name}` : '' })()
    : ''

  const assignedPerson = useMemo(() => {
    if (!personValue) return null
    return members.find((m) => m.id === personValue) ?? null
  }, [members, personValue])

  const assignedName = assignedPerson
    ? `${assignedPerson.first_name} ${assignedPerson.last_name}`
    : ''

  const teamName = teamValue ? teams.find((t) => t.id === teamValue)?.name ?? '' : ''

  return (
    <div className="space-y-1.5">
      {(label || onHide) && (
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">{label}</span>
        {onHide && (
          <button
            onClick={onHide}
            className="rounded p-0.5 text-gray-300 transition-colors hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400"
            title={t('hide')}
            aria-label={t('hide')}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      )}

      {/* Admin view: full dropdowns */}
      {canEdit ? (
        <>
          {/* Stacked: duty team on top, person beneath it (two rows) so the two
              fields never read as one — the person dropdown is searchable. */}
          <div className="space-y-2">
            {!hideTeam && (
            <TeamSelect
              value={teamValue}
              onChange={(v) => {
                onTeamChange(v)
                // Keep the assigned person only if they're also in the new team;
                // switching to a team that doesn't include them resets the person.
                if (personValue) {
                  const newMembers = v ? teamMemberIds.get(v) : undefined
                  if (!newMembers || !newMembers.has(personValue)) onPersonChange('')
                }
              }}
              teams={teams}
              disabled={disabled}
              aria-label={`${label} – ${t('selectTeam')}`}
              placeholder={t('selectTeam')}
            />
            )}
            {/* Person is always pickable: with a team it lists that team's members;
                without one, any licence-eligible member of this sport — picking
                then auto-fills their duty team (asking if they're in several). */}
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <SearchableSelect
                  value={personValue}
                  onChange={handlePersonPick}
                  disabled={disabled}
                  options={filteredMembers.map((m) => ({ value: m.id, label: `${m.first_name} ${m.last_name}` }))}
                  placeholder={t('selectPerson')}
                />
              </div>
              {personValue && onDelegate && !disabled && (
                <button
                  data-tour="delegation"
                  onClick={onDelegate}
                  className="flex min-h-[44px] items-center justify-center rounded-lg px-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                  title={t('delegate')}
                  aria-label={t('delegate')}
                >
                  <ArrowRightLeft className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </>
      ) : (
        /* Regular user view: read-only with action buttons */
        <>
          {personValue ? (
            <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-700">
              {teamName && (
                <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-xs font-semibold text-gray-700 dark:bg-gray-600 dark:text-gray-200">
                  {teamName}
                </span>
              )}
              <span className="flex flex-1 items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-white">
                {assignedName}
                {dutyConfirmed && (
                  <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                )}
              </span>
              {isCurrentUserAssigned && onDelegate && (
                <button
                  data-tour="delegate-duty"
                  onClick={onDelegate}
                  className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-3 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-100 dark:bg-brand-900/20 dark:text-brand-400 dark:hover:bg-brand-900/40"
                >
                  <ArrowRightLeft className="h-4 w-4" />
                  {t('delegate')}
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2.5 text-sm dark:bg-gray-700">
              {teamName && (
                <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-xs font-semibold text-gray-700 dark:bg-gray-600 dark:text-gray-200">
                  {teamName}
                </span>
              )}
              <span className="flex-1 text-gray-400 dark:text-gray-500">{t('unassigned')}</span>
              {selfAssignButton && (
                <button
                  onClick={onSelfAssign}
                  className="flex min-h-[44px] shrink-0 animate-pulse items-center gap-1.5 rounded-lg bg-green-50 px-3 py-2.5 text-sm font-medium text-green-700 transition-colors hover:animate-none hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/40"
                >
                  <Hand className="h-4 w-4" />
                  {t('selfAssign')}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Pending delegation indicator */}
      {pendingDelegationName && (
        <div className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
          <Clock className="h-3.5 w-3.5" />
          {t('delegatePendingOutgoing', { name: pendingDelegationName })}
        </div>
      )}

      {/* Contact info */}
      {showContact && assignedPerson && ((!assignedPerson.hide_phone && assignedPerson.phone) || (!assignedPerson.hide_email && assignedPerson.email)) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-400">
          {!assignedPerson.hide_phone && assignedPerson.phone && (
            <a href={`tel:${assignedPerson.phone}`} className="flex items-center gap-1.5 transition-colors hover:text-brand-600 dark:hover:text-brand-400">
              <Phone className="h-3 w-3" />
              {assignedPerson.phone}
            </a>
          )}
          {!assignedPerson.hide_email && assignedPerson.email && (
            <a href={`mailto:${assignedPerson.email}`} className="flex items-center gap-1.5 transition-colors hover:text-brand-600 dark:hover:text-brand-400">
              <Mail className="h-3 w-3" />
              {assignedPerson.email}
            </a>
          )}
        </div>
      )}

      {/* Who took this duty + when — admins only (migration 123) */}
      {showConfirmedBy && assignedPerson && (confirmedByName || confirmedAt) && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {t('confirmedBy')}: {[confirmedByName, confirmedAt ? formatDateTimeCompact(confirmedAt) : null].filter(Boolean).join(' · ')}
        </p>
      )}

      {/* Multi-team picker: the chosen person is in >1 team of this sport — ask
          which one is the duty team for this game. */}
      {teamPrompt && (
        <div role="dialog" aria-modal="true" aria-label={t('pickDutyTeamTitle')} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setTeamPrompt(null)}>
          <div className="mx-4 w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('pickDutyTeamTitle')}</h3>
            <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400">{t('pickDutyTeamBody', { name: promptName })}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {teamPrompt.teamIds.map((tid) => (
                <button
                  key={tid}
                  onClick={() => resolveTeamPrompt(tid)}
                  className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-800 transition-colors hover:border-brand-500 hover:bg-brand-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-brand-900/20"
                >
                  {teams.find((tm) => tm.id === tid)?.name ?? tid}
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button onClick={() => setTeamPrompt(null)} className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700">
                {t('cancelAction')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
