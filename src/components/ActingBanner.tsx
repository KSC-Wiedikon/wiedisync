import { useContext, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronsUpDown, RotateCcw } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { HouseholdSwitcherContext } from '../hooks/useHouseholdSwitcher'
import { assetUrl } from '../lib/api'
import HouseholdSwitcher from './HouseholdSwitcher'
import { accentOf } from './householdAccents'
import { cn } from '@/lib/utils'

/** Padding that clears the iOS status bar / notch in an installed PWA
 *  (`black-translucent` draws the page under it). 0 everywhere else. */
const SAFE_TOP = 'env(safe-area-inset-top, 0px)'

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
 *
 * On the guardian's OWN account the bar says whom she can switch to ("Switch
 * to Mila, Zoé") — a bare name with a chevron read as a title, not a control —
 * and offers a one-tap "Continue with <last used>" chip.
 *
 * ⚠ Not sticky and not z-[100]: it sits in the shell's flex column above the
 * scroll container, so it never needed to stick, and z-[100] painted it over
 * full-screen modals (their close button was untappable on a phone).
 *
 * `topInset`: this bar is the top-most element of the shell, so it takes the
 * safe-area padding. Layout passes it only to whichever banner is on top.
 */
export default function ActingBanner({ topInset = false }: { topInset?: boolean }) {
  const { t } = useTranslation('common')
  const { householdMembers, actingMember, realUser, resumeCandidate, switchTo } = useAuth()
  // The app shell mounts ONE chooser (HouseholdSwitcherProvider). Outside the
  // shell — PendingPage renders this bar on its own — fall back to a local one,
  // so an acting guardian can always get back to herself.
  const shell = useContext(HouseholdSwitcherContext)
  const [localOpen, setLocalOpen] = useState(false)
  const openSwitcher = shell ? shell.openSwitcher : () => setLocalOpen(true)

  // Nothing to switch between — the overwhelming majority of members.
  if (!realUser || householdMembers.length === 0) return null

  const current = householdMembers.find((m) => actingMember && Number(m.id) === Number(actingMember.id))
  const name = actingMember
    ? (actingMember.first_name || [actingMember.first_name, actingMember.last_name].filter(Boolean).join(' '))
    : (realUser.first_name || '')
  const photo = actingMember ? actingMember.photo : realUser.photo
  // Acting → the child's own accent. As herself → the app's primary.
  const bg = actingMember ? accentOf(current?.accent).bg : 'bg-primary'
  // As herself: say whom she can switch to, so the bar reads as a control.
  const others = householdMembers.map((m) => m.first_name || [m.first_name, m.last_name].filter(Boolean).join(' ')).filter(Boolean)
  const subtitle = actingMember ? null : t('householdSwitchTo', { names: others.join(', ') })
  const resumeName = resumeCandidate?.first_name || ''

  return (
    <>
      <div
        className={cn('relative z-30 flex shrink-0 items-stretch text-white shadow-md', bg)}
        style={topInset ? { paddingTop: SAFE_TOP } : undefined}
      >
        <button
          type="button"
          onClick={openSwitcher}
          aria-label={actingMember ? t('householdActingFor', { name }) : t('switchAccount')}
          className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2.5 px-4 py-2 text-left text-sm font-semibold transition-opacity hover:opacity-95"
        >
          {photo
            ? <img src={assetUrl(photo)} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-white/40" />
            : <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/25 text-[11px] font-bold">
                {(name || '?').slice(0, 1).toUpperCase()}
              </span>}
          <span className="min-w-0">
            <span className="block truncate">{name}</span>
            {subtitle && <span className="block truncate text-xs font-medium text-white/85">{subtitle}</span>}
          </span>
          <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-80" />
        </button>
        {resumeCandidate && (
          <button
            type="button"
            onClick={() => { void switchTo(Number(resumeCandidate.id)) }}
            className="flex min-h-[44px] max-w-[45%] shrink-0 items-center gap-1.5 border-l border-white/25 bg-white/15 px-3 text-xs font-semibold transition-colors hover:bg-white/25"
          >
            <RotateCcw className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t('householdResume', { name: resumeName })}</span>
          </button>
        )}
      </div>
      {!shell && <HouseholdSwitcher open={localOpen} onClose={() => setLocalOpen(false)} />}
    </>
  )
}
