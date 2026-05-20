// src/modules/admin/components/ExplorerMemberFields.tsx
//
// Full-fields view of a single member record for the Data Explorer.
// Fetches the record with `fields: ['*']` so policy-readable columns appear
// regardless of which subset the parent cache loads. Admins get an inline
// "Edit" toggle that turns every field into a typed input (text / number /
// switch / JSON textarea / date), with dirty-only PATCH on save.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Pencil, Save, X, Loader2 } from 'lucide-react'
import { fetchItem, updateRecord } from '../../../lib/api'
import { logActivity } from '../../../utils/logActivity'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

interface Props {
  memberId: string
  canEdit: boolean
  /** Bumped by the page when the cache reloads — re-fetches the record. */
  reloadKey?: number
  /** Notify parent so it can refresh the explorer cache. */
  onSaved?: () => void
}

// Server-managed columns the admin should never overwrite from this UI.
const READ_ONLY_FIELDS = new Set([
  'id',
  'user',
  'date_created',
  'date_updated',
  'user_created',
  'user_updated',
  // Stamped by VM-sync / SV cron — editing here would just flap back.
  'license_nr',
  'licence_validated',
  'licence_activated',
  'licence_validation_date',
  'licence_activation_date',
  'licence_category',
  // Auto-managed timestamps
  'last_online_at',
  'consent_prompted_at',
  'shell_reminder_sent',
])

type FieldKind = 'bool' | 'number' | 'json' | 'date' | 'datetime' | 'longtext' | 'text'

function detectKind(key: string, value: unknown): FieldKind {
  if (typeof value === 'boolean') return 'bool'
  if (typeof value === 'number') return 'number'
  if (Array.isArray(value)) return 'json'
  if (value && typeof value === 'object') return 'json'
  // String hints by column name
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return 'datetime'
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date'
    if (value.length > 120) return 'longtext'
  }
  if (key === 'birthdate' || key.endsWith('_date')) return 'date'
  if (key.endsWith('_at')) return 'datetime'
  return 'text'
}

function formatDisplay(value: unknown, kind: FieldKind): string {
  if (value == null || value === '') return '—'
  if (kind === 'bool') return value ? '✓' : '—'
  if (kind === 'json') {
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  return String(value)
}

function valueEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  if (typeof a === 'object' && typeof b === 'object') {
    try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
  }
  return false
}

export default function ExplorerMemberFields({ memberId, canEdit, reloadKey, onSaved }: Props) {
  const { t } = useTranslation('admin')
  const [record, setRecord] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const item = await fetchItem<Record<string, unknown>>('members', memberId, { fields: ['*'] })
      setRecord(item)
      setDraft({ ...item })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [memberId])

  useEffect(() => {
    void load()
    setEditMode(false)
  }, [load, reloadKey])

  const keys = useMemo(() => {
    if (!record) return [] as string[]
    return Object.keys(record).sort((a, b) => {
      // Pin id / names first, then alphabetical
      const pinned = ['id', 'first_name', 'last_name', 'email', 'phone', 'sex', 'role']
      const ai = pinned.indexOf(a)
      const bi = pinned.indexOf(b)
      if (ai !== -1 && bi !== -1) return ai - bi
      if (ai !== -1) return -1
      if (bi !== -1) return 1
      return a.localeCompare(b)
    })
  }, [record])

  const dirtyKeys = useMemo(() => {
    if (!record) return [] as string[]
    return keys.filter((k) => !READ_ONLY_FIELDS.has(k) && !valueEquals(record[k], draft[k]))
  }, [record, draft, keys])

  const setField = (key: string, value: unknown) => setDraft((d) => ({ ...d, [key]: value }))

  const handleCancel = () => {
    if (record) setDraft({ ...record })
    setEditMode(false)
  }

  const handleSave = async () => {
    if (!record || dirtyKeys.length === 0) {
      setEditMode(false)
      return
    }
    setSaving(true)
    try {
      const patch: Record<string, unknown> = {}
      for (const k of dirtyKeys) patch[k] = draft[k]
      const updated = await updateRecord<Record<string, unknown>>('members', memberId, patch)
      logActivity('update', 'members', memberId, patch)
      setRecord(updated as Record<string, unknown>)
      setDraft({ ...(updated as Record<string, unknown>) })
      setEditMode(false)
      toast.success(t('explorerMemberFieldsSaved', { count: Object.keys(patch).length }))
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (loading && !record) {
    return (
      <div className="mb-4 flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t('explorerMemberFieldsLoading')}
      </div>
    )
  }

  if (error || !record) {
    return (
      <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {error ?? t('explorerMemberFieldsError')}
      </div>
    )
  }

  return (
    <section className="mb-4 rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('explorerMemberFieldsTitle')}
          <span className="ml-2 font-normal normal-case text-muted-foreground/70">
            {keys.length} {t('explorerMemberFieldsCount')}
          </span>
        </h2>
        {canEdit && !editMode && (
          <Button size="sm" variant="ghost" onClick={() => setEditMode(true)}>
            <Pencil className="mr-1 h-3.5 w-3.5" />
            {t('explorerMemberFieldsEdit')}
          </Button>
        )}
        {canEdit && editMode && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">
              {dirtyKeys.length === 0
                ? t('explorerMemberFieldsNoChanges')
                : t('explorerMemberFieldsChanges', { count: dirtyKeys.length })}
            </span>
            <Button size="sm" variant="ghost" onClick={handleCancel} disabled={saving}>
              <X className="mr-1 h-3.5 w-3.5" />
              {t('cancel')}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || dirtyKeys.length === 0}>
              {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
              {t('save')}
            </Button>
          </div>
        )}
      </header>

      <div className="divide-y divide-border">
        {keys.map((key) => {
          const original = record[key]
          const current = draft[key]
          const kind = detectKind(key, original)
          const isReadOnly = READ_ONLY_FIELDS.has(key)
          const isDirty = !isReadOnly && !valueEquals(original, current)

          return (
            <div
              key={key}
              className={
                'grid grid-cols-[180px_1fr] gap-3 px-3 py-1.5 text-xs ' +
                (isDirty ? 'bg-primary/5' : '')
              }
            >
              <span className="flex items-center gap-1 text-muted-foreground">
                <code className="break-all">{key}</code>
                {isReadOnly && (
                  <span className="rounded bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                    {t('explorerMemberFieldsReadonly')}
                  </span>
                )}
                {isDirty && (
                  <span className="rounded bg-primary/15 px-1 py-0.5 text-[9px] uppercase tracking-wider text-primary">
                    {t('explorerMemberFieldsDirty')}
                  </span>
                )}
              </span>

              {!editMode || isReadOnly ? (
                <span className="break-words text-foreground">
                  {formatDisplay(original, kind)}
                </span>
              ) : (
                <FieldEditor
                  fieldKey={key}
                  kind={kind}
                  value={current}
                  onChange={(v) => setField(key, v)}
                />
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function FieldEditor({
  fieldKey,
  kind,
  value,
  onChange,
}: {
  fieldKey: string
  kind: FieldKind
  value: unknown
  onChange: (v: unknown) => void
}) {
  const inputCls =
    'w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none'

  if (kind === 'bool') {
    return (
      <div className="flex items-center gap-2">
        <Switch
          checked={Boolean(value)}
          onCheckedChange={(checked) => onChange(checked)}
        />
        <span className="text-muted-foreground">{Boolean(value) ? 'true' : 'false'}</span>
      </div>
    )
  }

  if (kind === 'number') {
    return (
      <input
        type="number"
        value={value === null || value === undefined || value === '' ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={inputCls}
      />
    )
  }

  if (kind === 'date') {
    return (
      <input
        type="date"
        value={typeof value === 'string' ? value.slice(0, 10) : ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={inputCls}
      />
    )
  }

  if (kind === 'datetime') {
    const v = typeof value === 'string' ? value.slice(0, 16) : ''
    return (
      <input
        type="datetime-local"
        value={v}
        onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
        className={inputCls}
      />
    )
  }

  if (kind === 'json') {
    const text = (() => {
      if (value == null) return ''
      try { return JSON.stringify(value, null, 2) } catch { return String(value) }
    })()
    return (
      <textarea
        value={text}
        rows={Math.min(8, Math.max(2, text.split('\n').length))}
        onChange={(e) => {
          const raw = e.target.value
          if (raw.trim() === '') { onChange(null); return }
          try { onChange(JSON.parse(raw)) }
          catch { onChange(raw) }
        }}
        className={`${inputCls} font-mono`}
      />
    )
  }

  if (kind === 'longtext') {
    return (
      <textarea
        value={String(value ?? '')}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
      />
    )
  }

  // text
  return (
    <input
      type={fieldKey === 'email' ? 'email' : 'text'}
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
      className={inputCls}
    />
  )
}
