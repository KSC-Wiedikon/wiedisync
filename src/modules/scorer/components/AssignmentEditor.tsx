import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Member, Team, LicenceType } from '../../../types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Phone, Mail, Hand, ArrowRightLeft, Clock, Check } from 'lucide-react'
import TeamSelect from '../../../components/TeamSelect'

interface AssignmentEditorProps {
  label: string
  requiredLicence?: LicenceType | LicenceType[]
  teamValue: string
  personValue: string
  members: Member[]
  teams: Team[]
  teamMemberIds: Map<string, Set<string>>
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
  /** Callback to hide/collapse this assignment row */
  onHide?: () => void
}

export default function AssignmentEditor({
  label,
  requiredLicence,
  teamValue,
  personValue,
  members,
  teams,
  teamMemberIds,
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
  onHide,
}: AssignmentEditorProps) {
  const { t, i18n } = useTranslation('scorer')

  const filteredMembers = useMemo(() => {
    let list = members.filter((m) => m.kscw_membership_active && !guestMemberIds?.has(m.id))
    if (requiredLicence) {
      const licences = Array.isArray(requiredLicence) ? requiredLicence : [requiredLicence]
      list = list.filter((m) => licences.some((l) => m[l]))
    }
    if (teamValue) {
      const teamMembers = teamMemberIds.get(teamValue)
      if (teamMembers) {
        list = list.filter((m) => teamMembers.has(m.id))
      }
    }
    // Ensure the currently assigned person is always in the list
    if (personValue && !list.some((m) => m.id === personValue)) {
      const assigned = members.find((m) => m.id === personValue)
      if (assigned) list.push(assigned)
    }
    return list.sort((a, b) =>
      `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, i18n.language),
    )
  }, [members, requiredLicence, teamValue, teamMemberIds, personValue, guestMemberIds])

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

      {/* Admin view: full dropdowns */}
      {canEdit ? (
        <>
          <div className={`grid gap-2 ${teamValue ? (personValue && onDelegate && !disabled ? 'grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]' : 'grid-cols-[minmax(0,2fr)_minmax(0,3fr)]') : ''}`}>
            <TeamSelect
              value={teamValue}
              onChange={(v) => {
                onTeamChange(v)
                if (personValue) onPersonChange('')
              }}
              teams={teams}
              disabled={disabled}
              aria-label={`${label} – ${t('selectTeam')}`}
              placeholder={t('selectTeam')}
            />
            {teamValue && (
              <Select value={personValue} onValueChange={onPersonChange} disabled={disabled}>
                <SelectTrigger className="min-h-[44px]" aria-label={`${label} – ${t('selectPerson')}`}>
                  <SelectValue placeholder={t('selectPerson')} />
                </SelectTrigger>
                <SelectContent>
                  {filteredMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.first_name} {m.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
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
    </div>
  )
}
