import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import { Check, Info, ShieldCheck, ShieldX } from 'lucide-react'
import IconButton from '../../components/IconButton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { logActivity } from '../../utils/logActivity'
import { coercePositions, getPositionI18nKey, getSelectablePositions, isNonPlayingStaff } from '../../utils/memberPositions'
import StatusBadge from '../../components/StatusBadge'
import { getFileUrl } from '../../utils/fileUrl'
import ImageLightbox from '../../components/ImageLightbox'
import type { ExpandedMemberTeam } from '../../hooks/useTeamMembers'
import type { Team, Member, MemberTeam } from '../../types'
import { cn } from '@/lib/utils'
import { asObj, memberDisplayName, memberFirstName, flattenMemberIds } from '../../utils/relations'
import { getMemberRole } from './memberRole'
import { formatDate } from '../../utils/dateHelpers'
import { Button } from '../../components/ui/button'
import { updateRecord, m2mUpdatePayload } from '../../lib/api'

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
  /** Render the identity-document column. Staff-only; see `useTeamIdentityDocs`. */
  showIdentity?: boolean
  /** When the member's identity document was uploaded, or null if there is none on file.
   *  PRESENCE ONLY — this row never holds a key or a byte of the document itself. */
  identityUploadedAt?: string | null
  /** Render a dedicated guest-level column (used by the Guests table) so the badge lines up. */
  showGuestColumn?: boolean
  onTeamUpdate?: (updated: Partial<Team>) => void
  onExtendShell?: (memberId: string) => void
  isEditing?: boolean
}

type LeadershipRole = 'coach' | 'captain' | 'team_responsible'
const LEADERSHIP_ROLES: LeadershipRole[] = ['coach', 'captain', 'team_responsible']
const roleI18nKeys: Record<LeadershipRole, string> = {
  coach: 'roleCoach',
  captain: 'roleCaptain',
  team_responsible: 'roleTeamResponsible',
}

export default function MemberRow({ memberTeam, teamSlug, team, canEdit, isAdmin, canEditRole = true, showContact = true, showIdentity = false, identityUploadedAt = null, showGuestColumn = false, onTeamUpdate, onExtendShell, isEditing }: MemberRowProps) {
  const { t } = useTranslation('teams')
  const member = asObj<Member>(memberTeam.member)
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [shellInfoOpen, setShellInfoOpen] = useState(false)
  const positionBtnRef = useRef<HTMLButtonElement>(null)
  const roleBtnRef = useRef<HTMLButtonElement>(null)
  // Wall clock, read once per mount (lazy initialiser) — reading Date.now() during
  // render is impure. Only used for the day-granular shell-expiry countdown below,
  // so a value pinned at mount renders exactly the same number.
  const [nowMs] = useState(() => Date.now())

  if (!member) return null

  const displayName = [member.last_name, (member.nickname || member.first_name)].filter(Boolean).join(' ') || memberDisplayName(member) || '—'
  const memberPositions = coercePositions(member.position)
  const nonPlaying = isNonPlayingStaff(member.id, team, memberPositions)
  const selectablePositions = getSelectablePositions(team?.sport, memberPositions)
  const initials = `${memberFirstName(member)[0] ?? ''}${member.last_name?.[0] ?? ''}`.toUpperCase()
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
      // A silent catch here is what turned the staff-row 403 (migration 331)
      // into "the app is broken": the cell just snapped back to its old value
      // with no message, on every device, for every staff-only teammate. The
      // write is already logged to Sentry + the JSONL by updateRecord — this
      // only makes the failure visible to the person who caused it.
      toast.error(t('common:errorSaving'))
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
    // coach / team_responsible are M2M: surviving links must carry their
    // junction row PK, or Directus re-inserts them and trips
    // `teams_coaches_pair_uq` (migration 245). `captain` is a plain M2O FK and
    // has no junction to preserve.
    const isJunction = roleKey !== 'captain'
    const junctionPayload = isJunction
      ? m2mUpdatePayload('members_id', nextIds, team[roleKey])
      : nextIds.map((id) => ({ members_id: id }))
    try {
      // Read the saved junctions back so the PKs of links this call created are
      // available to the next toggle without a full team refetch.
      const saved = await updateRecord<Team>('teams', team.id, { [roleKey]: junctionPayload },
        isJunction ? { fields: ['id', `${roleKey}.id`, `${roleKey}.members_id`] } : undefined)
      logActivity('update', 'teams', team.id, { [roleKey]: nextIds })
      onTeamUpdate({ [roleKey]: (isJunction && saved[roleKey]) || junctionPayload })
    } catch {
      // Same reasoning as saveField: a rejected staff toggle must say so rather
      // than leave the badge looking unchanged for no stated reason.
      toast.error(t('common:errorSaving'))
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
    <tr className={cn('border-b border-border/70 last:border-0 transition-colors hover:bg-muted/70', member.shell && 'border-l-2 border-l-amber-400 bg-amber-400/5')}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {member.photo ? (
            <>
              <img
                src={getFileUrl('members', member.id, member.photo)}
                alt={displayName}
                role="button"
                tabIndex={0}
                aria-label={displayName}
                className="h-8 w-8 shrink-0 cursor-pointer rounded-full object-cover"
                onClick={() => setLightboxOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setLightboxOpen(true)
                  }
                }}
              />
              <ImageLightbox
                src={getFileUrl('members', member.id, member.photo)}
                alt={displayName}
                open={lightboxOpen}
                onClose={() => setLightboxOpen(false)}
              />
            </>
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-200 text-xs font-medium text-muted-foreground dark:bg-gray-600">
              {initials}
            </div>
          )}
          <Link
            to={`/teams/player/${member.id}?from=${teamSlug}`}
            className="text-sm font-medium text-foreground hover:text-primary dark:hover:text-brand-300"
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
                      (new Date(member.shell_expires).getTime() - nowMs) / (1000 * 60 * 60 * 24)
                    ))
                  })}
                </>
              )}
            </span>
            <IconButton
              size="sm"
              type="button"
              onClick={() => setShellInfoOpen(true)}
              className="-my-2 text-amber-500 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-200"
              label={t('shellInfoTitle')}
            >
              <Info />
            </IconButton>
            <Dialog open={shellInfoOpen} onOpenChange={setShellInfoOpen}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>{t('shellInfoTitle')}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>{t('shellInfoWhat')}</p>
                  <p>{t('shellInfoExpiry')}</p>
                  <p className="font-medium text-foreground">{t('shellInfoActionTitle')}</p>
                  <p>{t('shellInfoAction')}</p>
                </div>
              </DialogContent>
            </Dialog>
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
      <td className="px-4 py-3 text-center text-sm text-muted-foreground">
        {nonPlaying ? (
          <span>—</span>
        ) : canEdit && editingField === 'number' ? (
          <input
            type="number"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, 'number')}
            onBlur={() => saveField('number', editValue ? parseInt(editValue, 10) : 0)}
            className="h-9 w-14 rounded-md border border-brand-400 bg-card px-1.5 text-center text-sm sm:h-8 font-medium text-foreground ring-1 ring-brand-400/30 focus:outline-none dark:border-brand-500 dark:bg-input/20 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            autoFocus
          />
        ) : canEdit ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => startEdit('number', member.number)}
            className="w-10 border border-transparent px-0 text-sm hover:border-brand-400 hover:bg-transparent hover:text-primary dark:hover:border-brand-500 dark:hover:text-brand-300"
          >
            {member.number || '—'}
          </Button>
        ) : (
          <span>{member.number || '—'}</span>
        )}
      </td>

      {/* Position — editable by coach (checkbox dropdown) */}
      <td className="hidden px-4 py-3 text-sm text-muted-foreground sm:table-cell">
        {canEdit ? (
          <div className="relative">
            <Button
              ref={positionBtnRef}
              size="sm"
              variant="ghost"
              onClick={() => setEditingField(editingField === 'position' ? null : 'position')}
              className="h-auto min-h-9 justify-start whitespace-normal px-1.5 text-left font-normal hover:text-primary dark:hover:text-brand-300 sm:min-h-8"
            >
              {getPositionLabelList(memberPositions)}
            </Button>
            {editingField === 'position' && (
              <AnchoredMenu anchorRef={positionBtnRef} onClose={() => setEditingField(null)} width={192}>
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
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground/85 hover:bg-accent"
                      >
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}`}>
                          {active && (
                            <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                          )}
                        </span>
                        {getPositionI18nKey(p) ? t(getPositionI18nKey(p)!) : p}
                      </button>
                    )
                  })}
              </AnchoredMenu>
            )}
          </div>
        ) : (
          <span>{getPositionLabelList(memberPositions)}</span>
        )}
      </td>

      {showContact && (
        <td className="hidden px-4 py-3 text-sm text-muted-foreground md:table-cell">
          {member.hide_email ? '—' : (member.email || '—')}
        </td>
      )}
      {showContact && (
        <td className="hidden px-4 py-3 text-sm text-muted-foreground md:table-cell">
          {member.hide_phone ? '—' : (member.phone || '—')}
        </td>
      )}
      {showContact && (
        <td className="hidden px-4 py-3 text-sm text-muted-foreground lg:table-cell">
          {birthdateDisplay || '—'}
        </td>
      )}

      {/* Identity document — has one / doesn't. Never a link and never the document: the
          bytes only ever open in the Show-IDs screen, inside the match window. Deliberately
          NOT hidden on small screens; chasing a missing ID is a phone-in-the-hall job. */}
      {showIdentity && (
        <td className="px-4 py-3 text-center">
          {identityUploadedAt ? (
            <span title={t('identityUploadedOn', { date: formatDate(identityUploadedAt) })}>
              <ShieldCheck className="mx-auto h-4 w-4 text-green-600 dark:text-green-400" aria-hidden="true" />
              <span className="sr-only">{t('identityUploaded')}</span>
            </span>
          ) : (
            <span title={t('identityMissing')}>
              <ShieldX className="mx-auto h-4 w-4 text-muted-foreground/80" aria-hidden="true" />
              <span className="sr-only">{t('identityMissing')}</span>
            </span>
          )}
        </td>
      )}

      {/* Role — editable by admin only (read-only badge in the coaches table; managed via Manage staff) */}
      <td className="px-4 py-3">
        {isAdmin && canEditRole ? (
          <div className="relative">
            <Button
              ref={roleBtnRef}
              size="sm"
              variant="ghost"
              onClick={() => setEditingField(editingField === 'role' ? null : 'role')}
              className="gap-1 px-1.5"
            >
              {role ? (
                <StatusBadge status={role} />
              ) : (
                <span className="text-muted-foreground/80 hover:text-primary dark:hover:text-brand-300">+</span>
              )}
            </Button>
            {editingField === 'role' && (
              <AnchoredMenu anchorRef={roleBtnRef} onClose={() => setEditingField(null)} width={176} align="right">
                  {LEADERSHIP_ROLES.map((r) => {
                    const active = flattenMemberIds(team?.[r]).includes(String(member.id))
                    return (
                      <button
                        key={r}
                        onClick={() => toggleRole(r)}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground/85 hover:bg-accent"
                      >
                        <span className={`flex h-4 w-4 items-center justify-center rounded border ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}`}>
                          {active && (
                            <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                          )}
                        </span>
                        {t(roleI18nKeys[r])}
                      </button>
                    )
                  })}
              </AnchoredMenu>
            )}
          </div>
        ) : (
          role ? <StatusBadge status={role} /> : null
        )}
      </td>
    </tr>
  )
}

/**
 * Dropdown menu anchored to a trigger button but rendered in a portal on
 * document.body, so it escapes the table's `overflow-x-auto` container (which
 * clips both axes) instead of being cut off by it. Positioned `fixed` from the
 * anchor's bounding rect, clamped to the viewport, and flips above when there
 * isn't enough room below.
 */
function AnchoredMenu({
  anchorRef,
  onClose,
  width,
  align = 'left',
  children,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
  width: number
  align?: 'left' | 'right'
  children: React.ReactNode
}) {
  const [style, setStyle] = useState<React.CSSProperties | null>(null)

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const rawLeft = align === 'right' ? r.right - width : r.left
      const left = Math.max(8, Math.min(rawLeft, window.innerWidth - width - 8))
      const spaceBelow = window.innerHeight - r.bottom
      const openUp = spaceBelow < 240 && r.top > spaceBelow
      setStyle({
        position: 'fixed',
        left,
        width,
        maxHeight: (openUp ? r.top : spaceBelow) - 16,
        ...(openUp ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchorRef, width, align])

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      {style && (
        <div
          style={style}
          className="z-50 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl"
        >
          {children}
        </div>
      )}
    </>,
    document.body,
  )
}
