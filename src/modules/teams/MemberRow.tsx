import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { logActivity } from '../../utils/logActivity'
import { coercePositions, getPositionI18nKey, getSelectablePositions, isNonPlayingStaff } from '../../utils/memberPositions'
import StatusBadge from '../../components/StatusBadge'
import { getFileUrl } from '../../utils/fileUrl'
import ImageLightbox from '../../components/ImageLightbox'
import type { ExpandedMemberTeam } from '../../hooks/useTeamMembers'
import type { Team, Member, MemberTeam } from '../../types'
import { cn } from '@/lib/utils'
import { asObj, memberName, flattenMemberIds } from '../../utils/relations'
import { formatDate } from '../../utils/dateHelpers'
import { Button } from '../../components/ui/button'
import { updateRecord } from '../../lib/api'

interface MemberRowProps {
  memberTeam: ExpandedMemberTeam
  teamId: string
  teamSlug: string
  team?: Team | null
  canEdit?: boolean
  isAdmin?: boolean
  /** When false, the role column renders a read-only badge (no inline dropdown) — e.g. the coaches
   * table, where staff roles are managed via the "Manage staff" modal instead. Defaults to true. */
  canEditRole?: boolean
  showContact?: boolean
  /** Render a dedicated guest-level column (used by the Guests table) so the badge lines up. */
  showGuestColumn?: boolean
  onTeamUpdate?: (updated: Partial<Team>) => void
  onExtendShell?: (memberId: string) => void
  isEditing?: boolean
}

export const roleColors: Record<string, { bg: string; text: string }> = {
  captain: { bg: '#fef3c7', text: '#92400e' },
  coach: { bg: '#dbeafe', text: '#1e40af' },
  team_responsible: { bg: '#ede9fe', text: '#5b21b6' },
}

type LeadershipRole = 'coach' | 'captain' | 'team_responsible'
const LEADERSHIP_ROLES: LeadershipRole[] = ['coach', 'captain', 'team_responsible']
const roleI18nKeys: Record<LeadershipRole, string> = {
  coach: 'roleCoach',
  captain: 'roleCaptain',
  team_responsible: 'roleTeamResponsible',
}

export function getMemberRole(memberId: string | number, team?: Team | null): string | null {
  if (!team) return null
  const id = String(memberId)
  if (flattenMemberIds(team.coach).includes(id)) return 'coach'
  if (flattenMemberIds(team.captain).includes(id)) return 'captain'
  if (flattenMemberIds(team.team_responsible).includes(id)) return 'team_responsible'
  return null
}

export default function MemberRow({ memberTeam, teamId: _teamId, teamSlug, team, canEdit, isAdmin, canEditRole = true, showContact = true, showGuestColumn = false, onTeamUpdate, onExtendShell, isEditing }: MemberRowProps) {
  const { t } = useTranslation('teams')
  const member = asObj<Member>(memberTeam.member)
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [lightboxOpen, setLightboxOpen] = useState(false)

  if (!member) return null

  const displayName = [member.last_name, member.first_name].filter(Boolean).join(' ') || memberName(member) || '—'
  const memberPositions = coercePositions(member.position)
  const nonPlaying = isNonPlayingStaff(member.id, team, memberPositions)
  const selectablePositions = getSelectablePositions(team?.sport, memberPositions)
  const initials = `${member.first_name?.[0] ?? ''}${member.last_name?.[0] ?? ''}`.toUpperCase()
  const role = getMemberRole(member.id, team)

  const birthdateDisplay = (() => {
    if (member.birthdate_visibility === 'hidden' || !member.birthdate) return null
    if (member.birthdate_visibility === 'year_only') return new Date(member.birthdate).getFullYear().toString()
    return formatDate(member.birthdate)
  })()

  async function saveField(field: string, value: string | number | string[]) {
    try {
      await updateRecord('members', member!.id, { [field]: value })
      logActivity('update', 'members', member!.id, { [field]: value })
      // Update the local member to reflect change immediately
      const memberRef = asObj<Member>(memberTeam.member)
      if (memberRef) {
        ;(memberRef as Record<string, unknown>)[field] = value
      }
    } catch {
      // ignore
    }
    setEditingField(null)
  }

  async function toggleRole(roleKey: LeadershipRole) {
    if (!team || !onTeamUpdate) return
    const current = flattenMemberIds(team[roleKey])
    const has = current.includes(String(member!.id))
    const nextIds = has
      ? current.filter((id) => id !== member!.id)
      : [...current, member!.id]
    const junctionPayload = nextIds.map((id) => ({ members_id: id }))
    try {
      await updateRecord('teams', team.id, { [roleKey]: junctionPayload })
      logActivity('update', 'teams', team.id, { [roleKey]: nextIds })
      onTeamUpdate({ [roleKey]: junctionPayload })
    } catch {
      // ignore
    }
  }

  function startEdit(field: string, currentValue: string | number) {
    setEditingField(field)
    setEditValue(String(currentValue ?? ''))
  }

  function getPositionLabelList(positions: string[]) {
    if (positions.length === 0) return '—'
    return positions
      .map((p) => (getPositionI18nKey(p) ? t(getPositionI18nKey(p)!) : p))
      .join(', ')
  }

  function handleKeyDown(e: React.KeyboardEvent, field: string) {
    if (e.key === 'Enter') {
      const val = field === 'number' ? (editValue ? parseInt(editValue, 10) : 0) : editValue
      saveField(field, val)
    } else if (e.key === 'Escape') {
      setEditingField(null)
    }
  }

  return (
    <tr className={cn('border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700', member.shell && 'border-l-2 border-l-amber-400 bg-amber-400/5')}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {member.photo ? (
            <>
              <img
                src={getFileUrl('members', member.id, member.photo)}
                alt={displayName}
                className="h-8 w-8 cursor-pointer rounded-full object-cover"
                onClick={() => setLightboxOpen(true)}
              />
              <ImageLightbox
                src={getFileUrl('members', member.id, member.photo)}
                alt={displayName}
                open={lightboxOpen}
                onClose={() => setLightboxOpen(false)}
              />
            </>
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600 dark:text-gray-400">
              {initials}
            </div>
          )}
          <Link
            to={`/teams/player/${member.id}?from=${teamSlug}`}
            className="text-sm font-medium text-gray-900 hover:text-brand-600 dark:text-gray-100"
          >
            {displayName}
          </Link>
          {!showGuestColumn && ((memberTeam as MemberTeam).guest_level ?? 0) > 0 && (
            <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${
              (memberTeam as MemberTeam).guest_level === 1 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
              : (memberTeam as MemberTeam).guest_level === 2 ? 'bg-orange-100/70 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400'
              : 'bg-orange-100/50 text-orange-500 dark:bg-orange-900/10 dark:text-orange-500'
            }`}>
              G{(memberTeam as MemberTeam).guest_level}
            </span>
          )}
        </div>
        {member.shell && (
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-xs text-amber-500 dark:text-amber-400">
              {t('shellAccount')}
              {member.shell_expires && (
                <>
                  {' · '}
                  {t('expiresIn', {
                    days: Math.max(0, Math.ceil(
                      (new Date(member.shell_expires).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                    ))
                  })}
                </>
              )}
            </span>
            {isEditing && onExtendShell && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-amber-500 dark:text-amber-400 h-auto py-0 px-1"
                onClick={() => onExtendShell(member.id)}
              >
                {t('extend')}
              </Button>
            )}
          </div>
        )}
      </td>

      {/* Guest level — own column so the badge lines up across rows (Guests table only) */}
      {showGuestColumn && (
        <td className="px-4 py-3">
          {((memberTeam as MemberTeam).guest_level ?? 0) > 0 && (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              (memberTeam as MemberTeam).guest_level === 1 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
              : (memberTeam as MemberTeam).guest_level === 2 ? 'bg-orange-100/70 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400'
              : 'bg-orange-100/50 text-orange-500 dark:bg-orange-900/10 dark:text-orange-500'
            }`}>
              G{(memberTeam as MemberTeam).guest_level}
            </span>
          )}
        </td>
      )}

      {/* Number — editable by coach, hidden for non-playing staff */}
      <td className="px-4 py-3 text-center text-sm text-gray-500 dark:text-gray-400">
        {nonPlaying ? (
          <span>—</span>
        ) : canEdit && editingField === 'number' ? (
          <input
            type="number"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, 'number')}
            onBlur={() => saveField('number', editValue ? parseInt(editValue, 10) : 0)}
            className="w-14 rounded-md border border-brand-400 bg-white px-1.5 py-0.5 text-center text-sm font-medium text-gray-900 shadow-sm ring-1 ring-brand-400/30 focus:outline-none dark:border-brand-500 dark:bg-gray-700 dark:text-gray-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            autoFocus
          />
        ) : (
          <span
            className={canEdit ? 'inline-flex h-7 w-10 cursor-pointer items-center justify-center rounded-md border border-transparent font-medium transition-colors hover:border-brand-400 hover:text-brand-600 dark:hover:border-brand-500 dark:hover:text-brand-400' : ''}
            onClick={canEdit ? () => startEdit('number', member.number) : undefined}
          >
            {member.number || '—'}
          </span>
        )}
      </td>

      {/* Position — editable by coach (checkbox dropdown) */}
      <td className="hidden px-4 py-3 text-sm text-gray-500 sm:table-cell dark:text-gray-400">
        {canEdit ? (
          <div className="relative">
            <button
              onClick={() => setEditingField(editingField === 'position' ? null : 'position')}
              className="cursor-pointer rounded px-1.5 py-0.5 text-left transition-colors hover:text-brand-600"
            >
              {getPositionLabelList(memberPositions)}
            </button>
            {editingField === 'position' && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setEditingField(null)} />
                <div className="absolute left-0 z-20 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800">
                  {selectablePositions.map((p) => {
                    const active = memberPositions.includes(p)
                    return (
                      <button
                        key={p}
                        onClick={() => {
                          const next = active
                            ? memberPositions.filter((pos) => pos !== p)
                            : [...memberPositions, p]
                          saveField('position', next.length > 0 ? next : ['other'])
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
        ) : (
          <span>{getPositionLabelList(memberPositions)}</span>
        )}
      </td>

      {showContact && (
        <td className="hidden px-4 py-3 text-sm text-gray-500 md:table-cell dark:text-gray-400">
          {member.hide_email ? '—' : (member.email || '—')}
        </td>
      )}
      {showContact && (
        <td className="hidden px-4 py-3 text-sm text-gray-500 md:table-cell dark:text-gray-400">
          {member.hide_phone ? '—' : (member.phone || '—')}
        </td>
      )}
      {showContact && (
        <td className="hidden px-4 py-3 text-sm text-gray-500 lg:table-cell dark:text-gray-400">
          {birthdateDisplay || '—'}
        </td>
      )}

      {/* Role — editable by admin only (read-only badge in the coaches table; managed via Manage staff) */}
      <td className="px-4 py-3">
        {isAdmin && canEditRole ? (
          <div className="relative">
            <button
              onClick={() => setEditingField(editingField === 'role' ? null : 'role')}
              className="flex items-center gap-1 text-xs"
            >
              {role ? (
                <StatusBadge status={role} colorMap={roleColors} />
              ) : (
                <span className="text-gray-400 hover:text-brand-600">+</span>
              )}
            </button>
            {editingField === 'role' && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setEditingField(null)} />
                <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800">
                  {LEADERSHIP_ROLES.map((r) => {
                    const active = flattenMemberIds(team?.[r]).includes(String(member.id))
                    return (
                      <button
                        key={r}
                        onClick={() => toggleRole(r)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
                      >
                        <span className={`flex h-4 w-4 items-center justify-center rounded border ${active ? 'border-brand-500 bg-brand-500 text-white' : 'border-gray-300 dark:border-gray-500'}`}>
                          {active && (
                            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
                              <path d="M10 3L4.5 8.5 2 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                        {t(roleI18nKeys[r])}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        ) : (
          role ? <StatusBadge status={role} colorMap={roleColors} /> : null
        )}
      </td>
    </tr>
  )
}
