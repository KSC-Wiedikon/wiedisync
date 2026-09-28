import { useTranslation } from 'react-i18next'
import { TeamPickerMulti, type TeamPickerOption } from '@/components/ui/TeamPicker'

interface CarpoolScopePickerProps {
  /** The teams sharing the activity — the only sensible choices. */
  candidates: readonly TeamPickerOption[]
  value: readonly string[]
  onChange: (teamIds: string[]) => void | Promise<void>
  disabled?: boolean
}

/**
 * "Open to" — which of a shared activity's teams the rides board is for
 * (migration 379). Empty = everyone who can see the activity. Hidden when the
 * activity has fewer than two teams: there is nothing to choose.
 */
export default function CarpoolScopePicker({ candidates, value, onChange, disabled }: CarpoolScopePickerProps) {
  const { t } = useTranslation('carpool')
  if (candidates.length < 2) return null
  const ids = new Set(candidates.map((c) => c.id))
  return (
    <div className="space-y-1.5 pl-11 text-sm text-foreground/85">
      <div>
        <span className="font-medium">{t('scopeLabel')}</span>
        <p className="text-xs text-muted-foreground">{t('scopeHint')}</p>
      </div>
      <TeamPickerMulti
        teams={candidates}
        value={value.filter((v) => ids.has(v))}
        onChange={onChange}
        disabled={disabled}
        placeholder={t('addTeam')}
      />
    </div>
  )
}
