import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import Modal from './Modal'
import { useAuth } from '../hooks/useAuth'
import { HouseholdSwitcherContext } from '../hooks/useHouseholdSwitcher'
import { cn } from '@/lib/utils'
import { accentOf } from './householdAccents'
import HouseholdAvatar from './HouseholdAvatar'

/**
 * "Who are you doing this for?" — the household account chooser.
 *
 * ⚠ Deliberately NOT a <Table>. The lists-are-tables rule covers views of
 * homogeneous *records* you scan or edit; this is a three-item identity
 * chooser, the same shape as the existing account dropdown. Rows are 56px so
 * they clear the 44px touch target with room for a photo.
 *
 * The colour is load-bearing, not decoration: it is the same stable accent the
 * banner takes (a ring around a photo, the fill behind an initial), and it is
 * how a parent recognises which daughter she is on before she has read anything.
 */

export default function HouseholdSwitcher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('common')
  const { householdMembers, actingMember, realUser, switchTo } = useAuth()

  if (!realUser) return null

  const currentId = actingMember ? Number(actingMember.id) : null
  const choose = async (id: number | null) => {
    onClose()
    // Tapping the identity that is already active just closes the chooser —
    // switching to it again would clear every cached query for nothing.
    if (id === currentId) return
    await switchTo(id)
  }

  const selfName = [realUser.first_name, realUser.last_name].filter(Boolean).join(' ').trim()

  return (
    <Modal open={open} onClose={onClose} title={t('householdSwitchTitle')} size="sm" disableAutoFocus>
      <div className="flex flex-col">
        <button
          type="button"
          onClick={() => { void choose(null) }}
          aria-current={!actingMember ? 'true' : undefined}
          className={cn('flex min-h-[56px] items-center gap-3 rounded-md px-2 text-left transition-colors hover:bg-muted', !actingMember && 'bg-muted')}
        >
          <HouseholdAvatar photo={realUser.photo} name={selfName} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-foreground">{selfName}</span>
            <span className="block truncate text-xs text-muted-foreground">{t('householdSelf')}</span>
          </span>
          {!actingMember && <Check className="h-5 w-5 shrink-0 text-primary" />}
        </button>

        {householdMembers.map((m) => {
          const name = [m.first_name, m.last_name].filter(Boolean).join(' ').trim()
          const active = currentId === Number(m.id)
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => { void choose(Number(m.id)) }}
              aria-current={active ? 'true' : undefined}
              className={cn('flex min-h-[56px] items-center gap-3 rounded-md px-2 text-left transition-colors hover:bg-muted', active && 'bg-muted')}
            >
              <HouseholdAvatar photo={m.photo} name={m.first_name || name} accent={accentOf(m.accent)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-foreground">{m.first_name || name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {m.teams.length ? m.teams.join(', ') : t('householdLinkedAccount')}
                </span>
              </span>
              {active && <Check className="h-5 w-5 shrink-0 text-primary" />}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}

/**
 * Mounts the ONE chooser instance for the app shell and lets the account bar,
 * the desktop avatar menu and the mobile More sheet open it
 * (`useHouseholdSwitcher().openSwitcher`).
 */
export function HouseholdSwitcherProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const openSwitcher = useCallback(() => setOpen(true), [])
  const value = useMemo(() => ({ openSwitcher }), [openSwitcher])
  return (
    <HouseholdSwitcherContext.Provider value={value}>
      {children}
      <HouseholdSwitcher open={open} onClose={() => setOpen(false)} />
    </HouseholdSwitcherContext.Provider>
  )
}
