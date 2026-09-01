import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import Modal from './Modal'
import { useAuth } from '../hooks/useAuth'
import { assetUrl } from '../lib/api'
import { cn } from '@/lib/utils'
import { accentOf } from './householdAccents'

/**
 * "Who are you doing this for?" — the household account chooser.
 *
 * ⚠ Deliberately NOT a <Table>. The lists-are-tables rule covers views of
 * homogeneous *records* you scan or edit; this is a three-item identity
 * chooser, the same shape as the existing account dropdown. Rows are 56px so
 * they clear the 44px touch target with room for a photo.
 *
 * The colour dot is load-bearing, not decoration: it is the same stable accent
 * the banner takes, and it is how a parent recognises which daughter she is on
 * before she has read anything.
 */

function Initial({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold text-white', className)}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export default function HouseholdSwitcher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('common')
  const { householdMembers, actingMember, realUser, switchTo } = useAuth()

  if (!realUser) return null

  const choose = async (id: number | null) => {
    onClose()
    await switchTo(id)
  }

  const selfName = [realUser.first_name, realUser.last_name].filter(Boolean).join(' ').trim()

  return (
    <Modal open={open} onClose={onClose} title={t('householdSwitchTitle')} size="sm" disableAutoFocus>
      <div className="flex flex-col">
        <button
          type="button"
          onClick={() => { void choose(null) }}
          className="flex min-h-[56px] items-center gap-3 rounded-md px-2 text-left transition-colors hover:bg-muted"
        >
          {realUser.photo
            ? <img src={assetUrl(realUser.photo)} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
            : <Initial name={selfName || '?'} className="bg-primary" />}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-foreground">{selfName}</span>
            <span className="block truncate text-xs text-muted-foreground">{t('householdSelf')}</span>
          </span>
          {!actingMember && <Check className="h-5 w-5 shrink-0 text-primary" />}
        </button>

        {householdMembers.map((m) => {
          const name = [m.first_name, m.last_name].filter(Boolean).join(' ').trim()
          const active = actingMember && Number(actingMember.id) === Number(m.id)
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => { void choose(m.id) }}
              className="flex min-h-[56px] items-center gap-3 rounded-md px-2 text-left transition-colors hover:bg-muted"
            >
              {m.photo
                ? <img src={assetUrl(m.photo)} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                : <Initial name={m.first_name || '?'} className={accentOf(m.accent).dot} />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-foreground">{m.first_name || name}</span>
                {m.teams.length > 0 && (
                  <span className="block truncate text-xs text-muted-foreground">{m.teams.join(', ')}</span>
                )}
              </span>
              {active && <Check className="h-5 w-5 shrink-0 text-primary" />}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
