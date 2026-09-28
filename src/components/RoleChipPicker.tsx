import { useTranslation } from 'react-i18next'

const ROLE_GROUPS = [
  { key: 'globalRoles', roles: ['vorstand', 'finance', 'admin', 'vb_admin', 'bb_admin', 'superuser'] },
  { key: 'teamRoles', roles: ['coach', 'team_responsible', 'captain'] },
  // otn1_bb/otn2_bb are the Basketplan levels
  // (migration 228). All three are offered — they are additive, not a swap.
  { key: 'licences', roles: ['scorer_vb', 'referee_vb', 'otr1_bb', 'otr2_bb', 'otn1_bb', 'otn2_bb', 'referee_bb'] },
  { key: 'functions', roles: ['is_spielplaner'] },
]

interface RoleChipPickerProps {
  selected: string[]
  onChange: (roles: string[]) => void
}

export default function RoleChipPicker({ selected, onChange }: RoleChipPickerProps) {
  const { t } = useTranslation('invitations')

  function toggle(role: string) {
    onChange(selected.includes(role) ? selected.filter(r => r !== role) : [...selected, role])
  }

  return (
    <div className="space-y-3">
      {ROLE_GROUPS.map(group => (
        <div key={group.key}>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {t(group.key)}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {group.roles.map(role => {
              const active = selected.includes(role)
              return (
                <button
                  key={role}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggle(role)}
                  className={`inline-flex h-9 items-center rounded-full px-3 text-xs font-medium transition-colors sm:h-8 ${
                    active
                      ? 'bg-selected text-selected-foreground'
                      : 'bg-stone-100 text-muted-foreground hover:bg-stone-200 dark:bg-gray-700 dark:hover:bg-gray-600'
                  }`}
                >
                  {t(`role_${role}`)}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
