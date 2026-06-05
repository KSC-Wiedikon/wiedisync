import { useTranslation } from 'react-i18next'
import { FormField, FormInput, FormTextarea } from '@/components/FormField'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { FieldDef, AnswerValue } from './types'

interface Props {
  field: FieldDef
  value: AnswerValue
  onChange: (v: AnswerValue) => void
  disabled?: boolean
}

/**
 * Renders a single dynamic form field from its definition. Shared by the
 * builder's live preview and the member fill view — fully controlled.
 */
export default function FormFieldRenderer({ field, value, onChange, disabled }: Props) {
  const { t } = useTranslation('forms')
  const label = field.label + (field.required ? ' *' : '')
  const options = field.options ?? []

  switch (field.type) {
    case 'long_text':
      return (
        <FormTextarea
          label={label}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          disabled={disabled}
        />
      )

    case 'number':
      return (
        <FormInput
          label={label}
          type="number"
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          disabled={disabled}
        />
      )

    case 'email':
    case 'phone':
    case 'url':
    case 'date':
    case 'time':
    case 'datetime':
      return (
        <FormInput
          label={label}
          type={
            field.type === 'phone'
              ? 'tel'
              : field.type === 'datetime'
                ? 'datetime-local'
                : field.type
          }
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      )

    case 'rating': {
      const current = typeof value === 'number' ? value : 0
      return (
        <FormField label={label}>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                disabled={disabled}
                onClick={() => onChange(n === current ? null : n)}
                aria-label={`${n}`}
                className={`h-10 w-10 rounded-md border text-sm font-medium transition-colors ${
                  n <= current
                    ? 'border-brand-500 bg-brand-500 text-white'
                    : 'border-gray-200 text-gray-600 hover:bg-muted dark:border-gray-600 dark:text-gray-300'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </FormField>
      )
    }

    case 'yes_no':
      return (
        <FormField label={label}>
          <div className="flex min-h-[44px] items-center gap-2">
            <Switch checked={value === true} onCheckedChange={(v) => onChange(v)} disabled={disabled} />
            <span className="text-sm text-muted-foreground">{value === true ? t('yes') : t('no')}</span>
          </div>
        </FormField>
      )

    case 'single_choice':
      return (
        <FormField label={label}>
          <Select value={(value as string) ?? ''} onValueChange={(v) => onChange(v)} disabled={disabled}>
            <SelectTrigger className="min-h-[44px]">
              <SelectValue placeholder={t('choosePlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o} value={o}>{o}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )

    case 'multi_choice': {
      const arr = Array.isArray(value) ? (value as string[]) : []
      const toggle = (o: string) => {
        if (disabled) return
        onChange(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o])
      }
      return (
        <FormField label={label}>
          <div className="space-y-1">
            {options.map((o) => (
              <label key={o} className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-muted">
                <input
                  type="checkbox"
                  checked={arr.includes(o)}
                  onChange={() => toggle(o)}
                  disabled={disabled}
                  className="h-4 w-4 accent-brand-500"
                />
                <span className="text-sm">{o}</span>
              </label>
            ))}
          </div>
        </FormField>
      )
    }

    case 'short_text':
    default:
      return (
        <FormInput
          label={label}
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      )
  }
}
