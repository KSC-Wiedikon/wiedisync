import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Paperclip, X, Loader2 } from 'lucide-react'
import { FormField, FormInput, FormTextarea } from '@/components/FormField'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import IconButton from '@/components/IconButton'
import TruncatedText from '@/components/TruncatedText'
import { uploadFile } from '../../lib/api'
import { FORM_UPLOADS_FOLDER } from '../../lib/privateFolders'
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
              <Button
                key={n}
                type="button"
                size="icon"
                variant="outline"
                disabled={disabled}
                onClick={() => onChange(n === current ? null : n)}
                aria-label={`${n}`}
                className={
                  n <= current
                    ? 'border-transparent bg-selected text-selected-foreground hover:bg-selected/90 hover:text-selected-foreground'
                    : 'border-border text-muted-foreground'
                }
              >
                {n}
              </Button>
            ))}
          </div>
        </FormField>
      )
    }

    case 'yes_no':
      return (
        <FormField label={label}>
          <div className="flex min-h-11 items-center gap-2 sm:min-h-9">
            <Switch checked={value === true} onCheckedChange={(v) => onChange(v)} disabled={disabled} />
            <span className="text-sm text-muted-foreground">{value === true ? t('yes') : t('no')}</span>
          </div>
        </FormField>
      )

    case 'single_choice':
      return (
        <FormField label={label}>
          <Select value={(value as string) ?? ''} onValueChange={(v) => onChange(v)} disabled={disabled}>
            <SelectTrigger>
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
              <label key={o} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-muted sm:min-h-9">
                <input
                  type="checkbox"
                  checked={arr.includes(o)}
                  onChange={() => toggle(o)}
                  disabled={disabled}
                  className="h-4 w-4 accent-[var(--primary)]"
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
          // Private folder (audit F01): form managers read it via
          // /kscw/forms/:formId/files/:fileId, the uploader via own-upload read-back.
          // Also allowed for anonymous public-form uploads (ANON_UPLOAD_FOLDERS).
          onChange(await uploadFile(picked, FORM_UPLOADS_FOLDER))
        } catch {
          onChange(null)
        } finally {
          setUploading(false)
        }
      }
      return (
        <FormField label={label}>
          {file ? (
            <div className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface-sunken py-1 pl-3 pr-1 text-sm sm:min-h-9">
              <Paperclip size={15} className="shrink-0 text-muted-foreground" />
              <TruncatedText text={file.name} className="flex-1" />
              {!disabled && (
                <IconButton type="button" size="sm" label={t('removeFile')} onClick={() => onChange(null)} className="shrink-0 text-red-500 hover:bg-red-50 hover:text-red-600 dark:text-red-400 dark:hover:bg-red-900/30">
                  <X />
                </IconButton>
              )}
            </div>
          ) : (
            <label className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed sm:min-h-9 border-input px-3 py-2 text-sm text-muted-foreground hover:bg-accent ${disabled || uploading ? 'pointer-events-none opacity-60' : ''}`}>
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
