import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronsUpDown } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { assetUrl } from '../lib/api'
import HouseholdSwitcher from './HouseholdSwitcher'
import { accentOf } from './householdAccents'
import { cn } from '@/lib/utils'

/**
 * "You are using Mila's account" — the household account bar.
 *
 * Renders only for a login that administers at least one other member, so the
 * entire club sees nothing. The whole strip is the tap target (≥44px).
 *
 * ⚠ This is a CONTROL, not a warning, and it deliberately uses a third visual
 * language. Orange-500 already means read-only impersonation and gold already
 * means admin-mode data scope; being Mila is the normal state for this parent,
 * so it takes the child's own stable accent colour rather than an alarm colour.
 *
 * ⚠ Do NOT copy ImpersonationBanner's exit control (px-2 py-0.5 text-xs ≈ 20px).
 * That is desktop-operator-shaped and unusable on the phone this is built for.
 *
 * Which child am I? is answered three ways at once: colour (pre-attentive, lands
 * before reading), name (top of every screen, never dismissible), and the name
 * inside the RSVP buttons themselves at the moment of the decision.
 */
export default function ActingBanner() {
  const { t } = useTranslation('common')
  const { householdMembers, actingMember, realUser } = useAuth()
  const [open, setOpen] = useState(false)

  // Nothing to switch between — the overwhelming majority of members.
  if (!realUser || householdMembers.length === 0) return null

  const current = householdMembers.find((m) => actingMember && Number(m.id) === Number(actingMember.id))
  const name = actingMember
    ? (actingMember.first_name || [actingMember.first_name, actingMember.last_name].filter(Boolean).join(' '))
    : (realUser.first_name || '')
  const photo = actingMember ? actingMember.photo : realUser.photo
  // Acting → the child's own accent. As herself → the app's primary.
  const bg = actingMember ? accentOf(current?.accent).bg : 'bg-primary'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={actingMember ? t('householdActingFor', { name }) : t('switchAccount')}
        className={cn(
          'sticky top-0 z-[100] flex min-h-[44px] w-full items-center gap-2.5 px-4 py-2',
          'text-sm font-semibold text-white shadow-md transition-opacity hover:opacity-95',
          bg,
        )}
      >
        {photo
          ? <img src={assetUrl(photo)} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-white/40" />
          : <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/25 text-[11px] font-bold">
              {(name || '?').slice(0, 1).toUpperCase()}
            </span>}
        <span className="truncate">{name}</span>
        <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-80" />
      </button>
      <HouseholdSwitcher open={open} onClose={() => setOpen(false)} />
    </>
  )
}
