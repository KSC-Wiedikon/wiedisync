import { useTranslation } from 'react-i18next'

const ROLE_GROUPS = [
  { key: 'globalRoles', roles: ['vorstand', 'finance', 'admin', 'vb_admin', 'bb_admin', 'superuser'] },
  { key: 'teamRoles', roles: ['coach', 'team_responsible', 'captain'] },
  { key: 'licences', roles: ['scorer_vb', 'referee_vb', 'otr1_bb', 'otr2_bb', 'otn_bb', 'referee_bb'] },
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
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-brand-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
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
