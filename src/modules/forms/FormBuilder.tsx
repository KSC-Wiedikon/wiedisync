import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import { FormInput, FormTextarea, FormField } from '@/components/FormField'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import TeamMultiSelect from '@/components/TeamMultiSelect'
import { ChevronUp, ChevronDown, Trash2, Plus } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useCollection } from '../../lib/query'
import { createRecord, updateRecord } from '../../lib/api'
import { teamNameToColorKey } from '../../utils/teamColors'
import { toUtcIsoFromDatetimeLocal, toDatetimeLocalFromUtcIso } from '../../utils/dateHelpers'
import type { Team } from '../../types'
import FormFieldRenderer from './FormFieldRenderer'
import {
  FIELD_TYPES,
  type FieldDef,
  type FieldType,
  type FormDef,
  type FormStatus,
  type FormAudience,
} from './types'

interface Props {
  open: boolean
  form?: FormDef | null
  onSave: () => void
  onCancel: () => void
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `f${Math.random().toString(36).slice(2, 10)}`
}

const CHOICE_TYPES: FieldType[] = ['single_choice', 'multi_choice']

export default function FormBuilder({ open, form, onSave, onCancel }: Props) {
  const { t } = useTranslation('forms')
  const { t: tc } = useTranslation('common')
  const { user, coachTeamIds, teamResponsibleIds, isGlobalAdmin, isVorstand, isVbAdmin, isBbAdmin } = useAuth()
  // Full managers (global admin + Vorstand) can target any audience incl.
  // club-wide; everyone else is locked to team-scoped forms.
  const canClubWide = isGlobalAdmin || isVorstand

  const { data: allTeamsRaw } = useCollection<Team>('teams', { filter: { active: { _eq: true } }, sort: ['name'], limit: 50 })
  const allTeams = allTeamsRaw ?? []
  const availableTeams = useMemo(() => {
    if (isGlobalAdmin || isVorstand) return allTeams
    if (isVbAdmin || isBbAdmin) return allTeams.filter((tm) => (tm.sport === 'volleyball' ? isVbAdmin : tm.sport === 'basketball' ? isBbAdmin : false))
    const leaderTeams = new Set<string>([...coachTeamIds, ...teamResponsibleIds])
    return allTeams.filter((tm) => leaderTeams.has(tm.id))
  }, [allTeams, isGlobalAdmin, isVorstand, isVbAdmin, isBbAdmin, coachTeamIds, teamResponsibleIds])
  const teamOptions = useMemo(
    () =>
      availableTeams.map((tm) => ({
        value: tm.id,
        label: tm.name,
        colorKey: teamNameToColorKey(tm.name, tm.sport),
        group: tm.sport === 'volleyball' ? tc('volleyball') : tc('basketball'),
      })),
    [availableTeams, tc],
  )

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<FormStatus>('draft')
  const [audience, setAudience] = useState<FormAudience>('club_wide')
  const [selectedTeams, setSelectedTeams] = useState<string[]>([])
  const [anonymous, setAnonymous] = useState(false)
  const [allowMultiple, setAllowMultiple] = useState(false)
  const [closesAt, setClosesAt] = useState('')
  const [fields, setFields] = useState<FieldDef[]>([])
  const [showPreview, setShowPreview] = useState(false)
  const [preview, setPreview] = useState<Record<string, unknown>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (form) {
      setTitle(form.title)
      setDescription(form.description ?? '')
      setStatus(form.status)
      setAudience(form.audience)
      setSelectedTeams(
        (form.teams ?? []).map((tref) => {
          if (typeof tref === 'string' || typeof tref === 'number') return String(tref)
          const tid = tref.teams_id
          return String(typeof tid === 'object' ? tid.id : tid)
        }),
      )
      setAnonymous(form.anonymous)
      setAllowMultiple(form.allow_multiple)
      setClosesAt(form.closes_at ? toDatetimeLocalFromUtcIso(form.closes_at) : '')
      setFields(Array.isArray(form.fields) ? form.fields : [])
    } else {
      setTitle('')
      setDescription('')
      setStatus('draft')
      setAudience(canClubWide ? 'club_wide' : 'teams')
      setSelectedTeams([])
      setAnonymous(false)
      setAllowMultiple(false)
      setClosesAt('')
      setFields([])
    }
    setShowPreview(false)
    setPreview({})
    setError('')
  }, [form, open])

  function addField() {
    setFields((prev) => [...prev, { id: newId(), type: 'short_text', label: '', required: false }])
  }
  function updateField(id: string, patch: Partial<FieldDef>) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  }
  function removeField(id: string) {
    setFields((prev) => prev.filter((f) => f.id !== id))
  }
  function moveField(index: number, dir: -1 | 1) {
    setFields((prev) => {
      const next = [...prev]
      const j = index + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[index], next[j]] = [next[j], next[index]]
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!title.trim()) return setError(t('errorTitleRequired'))
    if (fields.length === 0) return setError(t('errorNoFields'))
    if (fields.some((f) => !f.label.trim())) return setError(t('errorFieldLabel'))
    if (fields.some((f) => CHOICE_TYPES.includes(f.type) && (f.options ?? []).length === 0))
      return setError(t('errorChoiceOptions'))
    if (audience === 'teams' && selectedTeams.length === 0) return setError(t('errorTeamsRequired'))

    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      status,
      audience,
      fields,
      anonymous,
      allow_multiple: allowMultiple,
      closes_at: closesAt ? toUtcIsoFromDatetimeLocal(closesAt) : null,
      created_by: user?.id,
      teams: audience === 'teams' ? selectedTeams.map((id) => ({ teams_id: id })) : [],
    }

    setSaving(true)
    try {
      if (form) await updateRecord('forms', form.id, payload)
      else await createRecord('forms', payload)
      onSave()
    } catch {
      setError(tc('errorSaving'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onCancel} title={form ? t('editForm') : t('newForm')} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormInput label={t('formTitle')} value={title} onChange={(e) => setTitle(e.target.value)} required />
        <FormTextarea label={t('formDescription')} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('status')}>
            <Select value={status} onValueChange={(v) => setStatus(v as FormStatus)}>
              <SelectTrigger className="min-h-[44px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">{t('statusDraft')}</SelectItem>
                <SelectItem value="open">{t('statusOpen')}</SelectItem>
                <SelectItem value="closed">{t('statusClosed')}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          {canClubWide && (
            <FormField label={t('audience')}>
              <Select value={audience} onValueChange={(v) => setAudience(v as FormAudience)}>
                <SelectTrigger className="min-h-[44px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="club_wide">{t('audienceClub')}</SelectItem>
                  <SelectItem value="teams">{t('audienceTeams')}</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          )}
        </div>

        {audience === 'teams' && (
          <FormField label={t('teams')} helperText={t('teamsHint')}>
            <TeamMultiSelect options={teamOptions} selected={selectedTeams} onChange={setSelectedTeams} />
          </FormField>
        )}

        <FormInput
          label={t('closesAt')}
          type="datetime-local"
          value={closesAt}
          onChange={(e) => setClosesAt(e.target.value)}
          helperText={t('closesAtHint')}
        />

        <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <Switch checked={anonymous} onCheckedChange={setAnonymous} />
          <div><span>{t('anonymous')}</span><p className="text-xs text-muted-foreground">{t('anonymousHint')}</p></div>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <Switch checked={allowMultiple} onCheckedChange={setAllowMultiple} />
          <div><span>{t('allowMultiple')}</span><p className="text-xs text-muted-foreground">{t('allowMultipleHint')}</p></div>
        </div>

        {/* Field editor */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
            <span className="text-sm font-medium">{t('fields')} ({fields.length})</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowPreview((v) => !v)} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                {showPreview ? t('hidePreview') : t('showPreview')}
              </button>
            </div>
          </div>

          {showPreview ? (
            <div className="space-y-3 p-3">
              {fields.length === 0 && <p className="text-sm text-muted-foreground">{t('noFieldsYet')}</p>}
              {fields.map((f) => (
                <FormFieldRenderer
                  key={f.id}
                  field={f}
                  value={(preview[f.id] as never) ?? (f.type === 'multi_choice' ? [] : '')}
                  onChange={(v) => setPreview((p) => ({ ...p, [f.id]: v }))}
                />
              ))}
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {fields.map((f, i) => (
                <div key={f.id} className="space-y-2 p-3">
                  <div className="flex items-start gap-2">
                    <input
                      type="text"
                      value={f.label}
                      onChange={(e) => updateField(f.id, { label: e.target.value })}
                      placeholder={t('fieldLabelPlaceholder')}
                      className="min-h-[44px] flex-1 rounded border border-gray-200 bg-transparent px-2 py-1 text-sm dark:border-gray-600 dark:text-gray-100"
                    />
                    <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                      <button type="button" onClick={() => moveField(i, -1)} disabled={i === 0} title={t('moveUp')} className="rounded p-1.5 text-gray-500 hover:bg-muted disabled:opacity-30"><ChevronUp size={16} /></button>
                      <button type="button" onClick={() => moveField(i, 1)} disabled={i === fields.length - 1} title={t('moveDown')} className="rounded p-1.5 text-gray-500 hover:bg-muted disabled:opacity-30"><ChevronDown size={16} /></button>
                      <button type="button" onClick={() => removeField(f.id)} title={tc('delete')} className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30"><Trash2 size={16} /></button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Select value={f.type} onValueChange={(v) => updateField(f.id, { type: v as FieldType })}>
                      <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FIELD_TYPES.map((ft) => (
                          <SelectItem key={ft} value={ft}>{t(`type_${ft}`)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Switch checked={f.required} onCheckedChange={(v) => updateField(f.id, { required: v })} />
                      {t('required')}
                    </label>
                  </div>
                  {CHOICE_TYPES.includes(f.type) && (
                    <textarea
                      value={(f.options ?? []).join('\n')}
                      onChange={(e) => updateField(f.id, { options: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
                      placeholder={t('optionsPlaceholder')}
                      rows={3}
                      className="w-full rounded border border-gray-200 bg-transparent px-2 py-1 text-sm dark:border-gray-600 dark:text-gray-100"
                    />
                  )}
                </div>
              ))}
              <div className="p-3">
                <Button type="button" variant="ghost" onClick={addField} className="w-full">
                  <Plus size={16} className="mr-1" /> {t('addField')}
                </Button>
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="ghost" type="button" onClick={onCancel}>{tc('cancel')}</Button>
          <Button type="submit" loading={saving}>{saving ? tc('saving') : tc('save')}</Button>
        </div>
      </form>
    </Modal>
  )
}
