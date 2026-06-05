import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Paperclip, X, Loader2 } from 'lucide-react'
import { FormField, FormInput, FormTextarea } from '@/components/FormField'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { uploadFile } from '../../lib/api'
import { resolveFieldLabel } from './labels'
import type { FieldDef, AnswerValue, FileAnswer } from './types'

interface Props {
  field: FieldDef
  value: AnswerValue
  onChange: (v: AnswerValue) => void
  disabled?: boolean
  /** Builder preview: don't actually upload files (avoid junk uploads). */
  preview?: boolean
}

/**
 * Renders a single dynamic form field from its definition. Shared by the
 * builder's live preview, the member fill view and the public website renderer
 * — fully controlled. Field labels resolve to the active UI locale via
 * `label_i18n`, falling back to the base `label`.
 */
export default function FormFieldRenderer({ field, value, onChange, disabled, preview }: Props) {
  const { t, i18n } = useTranslation('forms')
  const [uploading, setUploading] = useState(false)
  const label = resolveFieldLabel(field, i18n.language) + (field.required ? ' *' : '')
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

    case 'file': {
      const file = value && typeof value === 'object' && 'id' in value ? (value as FileAnswer) : null
      async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
        const picked = e.target.files?.[0]
        e.target.value = '' // allow re-picking the same file after a remove
        if (!picked || preview) return
        setUploading(true)
        try {
          onChange(await uploadFile(picked))
        } catch {
          onChange(null)
        } finally {
          setUploading(false)
        }
      }
      return (
        <FormField label={label}>
          {file ? (
            <div className="flex min-h-[44px] items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-600">
              <Paperclip size={15} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              {!disabled && (
                <button type="button" onClick={() => onChange(null)} className="shrink-0 rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30" aria-label={t('removeFile')}>
                  <X size={15} />
                </button>
              )}
            </div>
          ) : (
            <label className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-muted-foreground hover:bg-muted dark:border-gray-600 ${disabled || uploading ? 'pointer-events-none opacity-60' : ''}`}>
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
              <span>{uploading ? t('uploading') : t('chooseFile')}</span>
              <input type="file" className="hidden" onChange={onPick} disabled={disabled || uploading} />
            </label>
          )}
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
