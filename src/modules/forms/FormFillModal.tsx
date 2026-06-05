import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import { useAuth } from '../../hooks/useAuth'
import { createRecord } from '../../lib/api'
import FormFieldRenderer from './FormFieldRenderer'
import type { FormDef, FieldDef, AnswerValue } from './types'

interface Props {
  open: boolean
  form: FormDef
  onSubmitted: () => void
  onCancel: () => void
}

function isMissing(field: FieldDef, v: AnswerValue): boolean {
  if (!field.required) return false
  switch (field.type) {
    case 'multi_choice':
      return !(Array.isArray(v) && v.length > 0)
    case 'number':
      return v === null || v === undefined || (v as unknown) === ''
    case 'yes_no':
      return false // a boolean is always an answer
    default:
      return !v || (typeof v === 'string' && v.trim() === '')
  }
}

export default function FormFillModal({ open, form, onSubmitted, onCancel }: Props) {
  const { t } = useTranslation('forms')
  const { t: tc } = useTranslation('common')
  const { user } = useAuth()
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setAnswers({})
    setError('')
  }, [form, open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const missing = form.fields.find((f) => isMissing(f, answers[f.id] ?? null))
    if (missing) {
      setError(t('errorRequiredMissing', { field: missing.label }))
      return
    }
    setSaving(true)
    try {
      await createRecord('form_submissions', {
        form: form.id,
        member: form.anonymous ? null : user?.id,
        answers,
      })
      onSubmitted()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/already submitted/i.test(msg)) setError(t('errorAlreadySubmitted'))
      else if (/not open|deadline/i.test(msg)) setError(t('errorClosed'))
      else setError(t('errorSubmit'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onCancel} title={form.title} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {form.description && <p className="whitespace-pre-line text-sm text-muted-foreground">{form.description}</p>}
        {form.anonymous && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{t('anonymousNotice')}</p>
        )}
        {form.fields.map((f) => (
          <FormFieldRenderer
            key={f.id}
            field={f}
            value={answers[f.id] ?? (f.type === 'multi_choice' ? [] : f.type === 'yes_no' ? false : '')}
            onChange={(v) => setAnswers((a) => ({ ...a, [f.id]: v }))}
          />
        ))}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="ghost" type="button" onClick={onCancel}>{tc('cancel')}</Button>
          <Button type="submit" loading={saving}>{saving ? tc('saving') : t('submit')}</Button>
        </div>
      </form>
    </Modal>
  )
}
