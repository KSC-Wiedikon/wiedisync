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
import { localizeCountryName } from '../../../utils/countryName'
import {
  NO_FEDERATION, countryLabel, countryOptions, formatCountryCodes,
  parseCountryCodes, serializeCountryCodes,
} from '../../../utils/countries'
import CountryMultiSelect from '../../../components/CountryMultiSelect'
import {
  TRAINER_LICENCE_CODES, TRAINER_LICENCE_I18N_KEYS,
  parseTrainerLicences, serializeTrainerLicences,
} from '../../../utils/trainerLicences'
import { coercePositions, getPositionI18nKey, getSelectablePositions } from '../../../utils/memberPositions'
import { MEMBER_FIELD_LABELS } from './memberFieldLabels'
import {
  MEMBER_MULTI_FIELDS, MEMBER_SELECT_FIELDS, MEMBER_SUGGEST_FIELDS, optionLabel,
  type FieldOption,
} from './memberFieldOptions'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import SearchableSelect from '@/components/ui/SearchableSelect'
import DatePicker from '@/components/ui/DatePicker'
import DateTimePicker from '@/components/ui/DateTimePicker'

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
  // DERIVED (migration 223): a DB trigger mirrors the first entry of
  // `nationalitaet_codes` as the German name ClubDesk's picklist needs. Editing
  // it by hand only drifts the two apart until the next codes write — edit
  // `nationalitaet_codes` instead.
  'nationalitaet',
])

function humanize(key: string): string {
  const spaced = key.replace(/_/g, ' ').trim()
  if (!spaced) return key
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function labelFor(key: string): string {
  return MEMBER_FIELD_LABELS[key] ?? humanize(key)
}

// Semantic field groups — ordered for display. Keys not listed here land in
// "Other" automatically.
interface FieldGroup {
  id: string
  label: string
  keys: string[]
}
const FIELD_GROUPS: FieldGroup[] = [
  {
    id: 'identity',
    label: 'Identity',
    keys: ['id', 'first_name', 'last_name', 'nickname', 'email', 'phone', 'sex', 'birthdate', 'birthdate_visibility', 'language', 'photo', 'number', 'position', 'role', 'user'],
  },
  {
    id: 'membership',
    label: 'Membership',
    keys: ['kscw_membership_active', 'wiedisync_active', 'shell', 'shell_expires', 'shell_reminder_sent', 'requested_team', 'coach_approved_team', 'is_spielplaner'],
  },
  {
    id: 'licences',
    label: 'Licences',
    keys: ['license_nr', 'licence_activated', 'licence_validated', 'licence_category', 'licence_activation_date', 'licence_validation_date', 'scorer_vb', 'referee_vb', 'otr1_bb', 'otr2_bb', 'otn_bb', 'otn1_bb', 'otn2_bb', 'referee_bb', 'trainer_licences'],
  },
  {
    id: 'privacy',
    label: 'Consent & privacy',
    keys: ['consent_decision', 'consent_prompted_at', 'hide_phone', 'hide_email', 'website_visible', 'push_preview_content'],
  },
  {
    id: 'communications',
    label: 'Communications',
    keys: ['communications_team_chat_enabled', 'communications_dm_enabled', 'communications_banned', 'last_online_at'],
  },
  {
    id: 'address',
    label: 'Address & Swiss Volley admin',
    keys: ['adresse', 'plz', 'ort', 'nationalitaet_codes', 'federation_of_origin', 'nationalitaet', 'vm_email', 'ahv_nummer', 'beitragskategorie'],
  },
  {
    id: 'system',
    label: 'System',
    keys: ['status', 'date_created', 'date_updated', 'user_created', 'user_updated', 'sort'],
  },
]

const KEY_TO_GROUP: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const g of FIELD_GROUPS) {
    for (const k of g.keys) m[k] = g.id
  }
  return m
})()

type FieldKind =
  | 'bool' | 'number' | 'json' | 'date' | 'datetime' | 'longtext' | 'text'
  | 'select' | 'multiselect' | 'suggest'

const KIND_BADGE: Record<FieldKind, string> = {
  bool: 'boolean',
  number: 'number',
  json: 'json',
  date: 'date',
  datetime: 'datetime',
  longtext: 'text',
  text: 'text',
  select: 'select',
  multiselect: 'multi',
  // Free text with suggestions — the badge stays honest about the column type.
  suggest: 'text',
}

function detectKind(key: string, value: unknown): FieldKind {
  // Closed value sets are keyed off the COLUMN, not the value: a varchar
  // holding 'hidden' looks exactly like free text, and a NULL one carries no
  // hint at all. Must stay ahead of the value heuristics below.
  if (MEMBER_SELECT_FIELDS[key]) return 'select'
  if (MEMBER_MULTI_FIELDS[key] || key === 'position') return 'multiselect'
  if (MEMBER_SUGGEST_FIELDS[key]) return 'suggest'
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
  // Heuristic: known long-text columns
  if (['adresse'].includes(key)) return 'longtext'
  return 'text'
}

function formatDisplay(value: unknown, kind: FieldKind): string {
  if (value == null || value === '') return '—'
  if (kind === 'bool') return value ? 'Yes' : 'No'
  if (kind === 'json') {
    try { return JSON.stringify(value, null, 2) } catch { return String(value) }
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

  // Reset edit mode whenever the loaded member changes — intentional sync reset.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void load()
    setEditMode(false)
  }, [load, reloadKey])
  /* eslint-enable react-hooks/set-state-in-effect */

  // All keys (flat) — for change counters
  const keys = useMemo(() => (record ? Object.keys(record) : []), [record])

  // Group keys by FIELD_GROUPS; unknown keys land in "Other" (rendered last).
  // Within each group, preserve the order declared in FIELD_GROUPS.keys; any
  // keys present on the record but not in the group's declared order fall to
  // the end of that group, sorted by human label.
  const groupedKeys = useMemo(() => {
    if (!record) return [] as Array<{ id: string; label: string; keys: string[] }>
    const present = new Set(Object.keys(record))
    const sections: Array<{ id: string; label: string; keys: string[] }> = []

    for (const g of FIELD_GROUPS) {
      const ordered = g.keys.filter((k) => present.has(k))
      if (ordered.length > 0) sections.push({ id: g.id, label: g.label, keys: ordered })
    }

    // Anything not mapped → "Other"
    const otherKeys = Object.keys(record)
      .filter((k) => !KEY_TO_GROUP[k])
      .sort((a, b) => labelFor(a).localeCompare(labelFor(b)))
    if (otherKeys.length > 0) {
      sections.push({ id: 'other', label: 'Other', keys: otherKeys })
    }

    return sections
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
    <section className="mb-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('explorerMemberFieldsTitle')}
          <span className="ml-2 font-normal normal-case text-muted-foreground/70">
            {keys.length} {t('explorerMemberFieldsCount')}
          </span>
        </h2>
        {canEdit && !editMode && (
          <Button size="sm" variant="outline" onClick={() => setEditMode(true)}>
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

      <div className="space-y-5">
        {groupedKeys.map((group) => (
          <section key={group.id}>
            <h3 className="mb-2 border-b border-border pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.label}
              <span className="ml-2 font-normal normal-case text-muted-foreground/60">
                {group.keys.length}
              </span>
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.keys.map((key) => {
                const original = record[key]
                const current = draft[key]
                const kind = detectKind(key, original)
                const isReadOnly = READ_ONLY_FIELDS.has(key)
                const isDirty = !isReadOnly && !valueEquals(original, current)
                // Wide cards for json/longtext/checkbox grids so content has room
                const wide = kind === 'json' || kind === 'longtext' || kind === 'multiselect'

                return (
                    <article
                    key={key}
                    className={
                      'flex flex-col gap-1.5 rounded-lg border p-3 transition-colors ' +
                      (isDirty
                        ? 'border-primary/60 bg-primary/5'
                        : 'border-border bg-card hover:border-border/80') +
                      (wide ? ' sm:col-span-2 lg:col-span-2' : '')
                    }
                  >
                    {/* Card header — label + type / state badges */}
                    <header className="flex items-start justify-between gap-2">
                      <h4 className="text-sm font-medium text-foreground" title={key}>
                        {labelFor(key)}
                      </h4>
                      <div className="flex shrink-0 items-center gap-1">
                        {isReadOnly && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                            {t('explorerMemberFieldsReadonly')}
                          </span>
                        )}
                        {isDirty && (
                          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-primary">
                            {t('explorerMemberFieldsDirty')}
                          </span>
                        )}
                        <span
                          className="rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground"
                          title={KIND_BADGE[kind]}
                        >
                          {KIND_BADGE[kind]}
                        </span>
                      </div>
                    </header>

                    {/* Card body — value or input */}
                    <div className="text-sm">
                      {!editMode || isReadOnly ? (
                        <DisplayValue value={original} kind={kind} fieldKey={key} />
                      ) : (
                        <FieldEditor
                          fieldKey={key}
                          kind={kind}
                          value={current}
                          onChange={(v) => setField(key, v)}
                        />
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}

function DisplayValue({ value, kind, fieldKey }: { value: unknown; kind: FieldKind; fieldKey?: string }) {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
    return <span className="text-muted-foreground">—</span>
  }
  // Coded nationality (migration 223) → localized names, in stored order (the
  // first one is the primary / ClubDesk-pushed nationality).
  if (fieldKey === 'nationalitaet_codes') {
    return <span className="break-words text-foreground">{formatCountryCodes(String(value))}</span>
  }
  if (fieldKey === 'federation_of_origin') {
    return <FederationValue value={String(value)} />
  }
  // Coaching education (migration 274) → labelled chips in canonical order.
  if (fieldKey === 'trainer_licences') {
    return <TrainerLicencesValue value={String(value)} />
  }
  // Derived ClubDesk name, still free-text (German) → viewer's language.
  if (fieldKey === 'nationalitaet') {
    return <span className="break-words text-foreground">{localizeCountryName(String(value))}</span>
  }
  // Closed value sets → the label, with the stored code on hover. `position`
  // borrows the profile picker's own translations rather than a second list.
  if (kind === 'multiselect' && fieldKey === 'position') {
    return <PositionValue value={value} />
  }
  if (kind === 'multiselect' && fieldKey && MEMBER_MULTI_FIELDS[fieldKey]) {
    const opts = MEMBER_MULTI_FIELDS[fieldKey]
    const codes = Array.isArray(value) ? (value as unknown[]).map(String) : [String(value)]
    return (
      <span className="break-words text-foreground" title={codes.join(', ')}>
        {codes.map((c) => optionLabel(opts, c)).join(', ')}
      </span>
    )
  }
  if (kind === 'select' && fieldKey && MEMBER_SELECT_FIELDS[fieldKey]) {
    const code = String(value)
    return (
      <span className="break-words text-foreground" title={code}>
        {optionLabel(MEMBER_SELECT_FIELDS[fieldKey].options, code)}
      </span>
    )
  }
  if (kind === 'bool') {
    return (
      <span
        className={
          value
            ? 'font-medium text-emerald-600 dark:text-emerald-400'
            : 'font-medium text-red-600 dark:text-red-400'
        }
      >
        {value ? 'Yes' : 'No'}
      </span>
    )
  }
  if (kind === 'json') {
    const text = (() => {
      try { return JSON.stringify(value, null, 2) } catch { return String(value) }
    })()
    return (
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-2 text-[11px] font-mono text-foreground">
        {text}
      </pre>
    )
  }
  if (kind === 'longtext') {
    return <p className="whitespace-pre-wrap break-words text-foreground">{String(value)}</p>
  }
  return <span className="break-words text-foreground">{formatDisplay(value, kind)}</span>
}

/** Playing positions — reuses the profile picker's labels, not a second list.
 *  Those keys live in the `teams` namespace, NOT `auth` (unlike the coaching
 *  qualifications right below) — the wrong one renders the bare key. */
function PositionValue({ value }: { value: unknown }) {
  const { t } = useTranslation('teams')
  const codes = coercePositions(value)
  if (codes.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <span className="break-words text-foreground" title={codes.join(', ')}>
      {codes.map((p) => {
        const key = getPositionI18nKey(p)
        return key ? t(key) : p
      }).join(', ')}
    </span>
  )
}

/** Coaching education — stored codes rendered as their proper labels ("J+S"). */
function TrainerLicencesValue({ value }: { value: string }) {
  const { t } = useTranslation('auth')
  const codes = parseTrainerLicences(value)
  if (codes.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <span className="break-words text-foreground">
      {codes.map((c) => t(TRAINER_LICENCE_I18N_KEYS[c])).join(', ')}
    </span>
  )
}

/** 'NONE' is an explicit "never licensed elsewhere", not a missing answer. */
function FederationValue({ value }: { value: string }) {
  const { t } = useTranslation('admin')
  const code = value.trim().toUpperCase()
  const label = code === NO_FEDERATION ? t('federationNone') : (countryLabel(code) || code)
  return <span className="break-words text-foreground">{label}</span>
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
  const { t } = useTranslation(['admin', 'auth', 'common', 'teams'])
  const inputCls =
    'w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none'

  // Coded nationality: multi-select, order-preserving (first code is primary and
  // is what gets pushed to ClubDesk). Stored as a comma-separated string.
  if (fieldKey === 'nationalitaet_codes') {
    return (
      <CountryMultiSelect
        selected={parseCountryCodes(typeof value === 'string' ? value : '')}
        onChange={(codes) => onChange(serializeCountryCodes(codes))}
        helperText={t('auth:nationalitaetHint')}
      />
    )
  }

  // Coaching education: multi-select over a closed 4-value set, stored as a
  // comma-separated string. Checkboxes rather than a text input — the DB CHECK
  // would 400 on a typo and the admin would have to guess the accepted spelling.
  if (fieldKey === 'trainer_licences') {
    const selected = parseTrainerLicences(typeof value === 'string' ? value : '')
    return (
      <div className="flex flex-wrap gap-3">
        {TRAINER_LICENCE_CODES.map((code) => (
          <label key={code} className="flex cursor-pointer items-center gap-1.5 text-sm text-foreground">
            <input
              type="checkbox"
              checked={selected.includes(code)}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...selected, code]
                  : selected.filter((c) => c !== code)
                onChange(serializeTrainerLicences(next))
              }}
              className="size-4 accent-primary"
            />
            {t(`auth:${TRAINER_LICENCE_I18N_KEYS[code]}`)}
          </label>
        ))}
      </div>
    )
  }

  // Playing positions: the profile picker's own option set, so the explorer can
  // never offer a position the app does not render (and vice versa). Any legacy
  // value already on the record is kept selectable by getSelectablePositions.
  if (fieldKey === 'position') {
    const selected = coercePositions(value)
    return (
      <div className="flex flex-wrap gap-3">
        {getSelectablePositions(undefined, value).map((p) => {
          const i18nKey = getPositionI18nKey(p)
          return (
            <label key={p} className="flex cursor-pointer items-center gap-1.5 text-sm text-foreground">
              <input
                type="checkbox"
                checked={selected.includes(p)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...selected, p]
                    : selected.filter((c) => c !== p)
                  onChange(next)
                }}
                className="size-4 accent-primary"
              />
              {i18nKey ? t(`teams:${i18nKey}`) : p}
            </label>
          )
        })}
      </div>
    )
  }

  // Roles (jsonb array, gated by CHECK members_role_values_valid) — checkboxes
  // rather than a JSON textarea: a typo there 400s on the constraint, and a
  // valid-but-wrong string silently grants or drops access.
  if (kind === 'multiselect' && MEMBER_MULTI_FIELDS[fieldKey]) {
    return (
      <MultiSelectEditor
        options={MEMBER_MULTI_FIELDS[fieldKey]}
        value={value}
        onChange={onChange}
      />
    )
  }

  if (kind === 'select') {
    const { options, nullable } = MEMBER_SELECT_FIELDS[fieldKey]
    return (
      <SelectEditor options={options} nullable={nullable} value={value} onChange={onChange} />
    )
  }

  // Free text with a canonical suggestion list (datalist) — off-list values
  // exist in the data and must stay typeable.
  if (kind === 'suggest') {
    const listId = `explorer-suggest-${fieldKey}`
    return (
      <>
        <input
          type="text"
          list={listId}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          className={inputCls}
        />
        <datalist id={listId}>
          {MEMBER_SUGGEST_FIELDS[fieldKey].map((opt) => (
            <option key={opt} value={opt} />
          ))}
        </datalist>
      </>
    )
  }

  // Federation of origin: single code, plus the explicit 'NONE' answer.
  if (fieldKey === 'federation_of_origin') {
    return (
      <SearchableSelect
        options={[{ value: NO_FEDERATION, label: t('admin:federationNone') }, ...countryOptions()]}
        value={typeof value === 'string' ? value.trim().toUpperCase() : ''}
        onChange={(v) => onChange(v === '' ? null : v)}
        searchPlaceholder={t('common:searchCountry')}
      />
    )
  }

  if (kind === 'bool') {
    const on = Boolean(value)
    return (
      <div className="flex items-center gap-2">
        <Switch checked={on} onCheckedChange={(checked) => onChange(checked)} />
        <span
          className={
            on
              ? 'font-medium text-emerald-600 dark:text-emerald-400'
              : 'font-medium text-red-600 dark:text-red-400'
          }
        >
          {on ? 'Yes' : 'No'}
        </span>
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
      <DatePicker
        value={typeof value === 'string' ? value.slice(0, 10) : ''}
        onChange={(v) => onChange(v || null)}
      />
    )
  }

  if (kind === 'datetime') {
    const v = typeof value === 'string' ? value.slice(0, 16) : ''
    return (
      <DateTimePicker
        value={v}
        onChange={(dt) => onChange(dt ? new Date(dt).toISOString() : null)}
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
        rows={Math.min(10, Math.max(3, text.split('\n').length))}
        onChange={(e) => {
          const raw = e.target.value
          if (raw.trim() === '') { onChange(null); return }
          try { onChange(JSON.parse(raw)) }
          catch { onChange(raw) }
        }}
        className={`${inputCls} font-mono text-xs`}
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

// Radix Select refuses an empty-string item value, so "no value" travels as a
// sentinel and is mapped back to null on the way out.
const NONE_VALUE = '__none__'

function SelectEditor({
  options,
  nullable,
  value,
  onChange,
}: {
  options: FieldOption[]
  nullable: boolean
  value: unknown
  onChange: (v: unknown) => void
}) {
  const current = typeof value === 'string' && value !== '' ? value : ''
  // An off-list value (legacy data, or a code added to the DB before this list)
  // stays selected and selectable — otherwise opening the editor on such a row
  // and saving anything else would silently overwrite it.
  const shown = current && !options.some((o) => o.value === current)
    ? [{ value: current, label: `${current} (unrecognised)` }, ...options]
    : options
  return (
    <Select
      value={current === '' ? NONE_VALUE : current}
      onValueChange={(v) => onChange(v === NONE_VALUE ? null : v)}
    >
      <SelectTrigger className="h-8 w-full text-sm">
        <SelectValue placeholder="—" />
      </SelectTrigger>
      <SelectContent>
        {nullable && <SelectItem value={NONE_VALUE}>—</SelectItem>}
        {shown.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function MultiSelectEditor({
  options,
  value,
  onChange,
}: {
  options: FieldOption[]
  value: unknown
  onChange: (v: unknown) => void
}) {
  const selected = Array.isArray(value) ? (value as unknown[]).map(String) : []
  // Same off-list rule as SelectEditor — an unknown code keeps its checkbox.
  const shown = [
    ...options,
    ...selected.filter((c) => !options.some((o) => o.value === c))
      .map((c) => ({ value: c, label: `${c} (unrecognised)` })),
  ]
  return (
    <div className="flex flex-wrap gap-3">
      {shown.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-center gap-1.5 text-sm text-foreground">
          <input
            type="checkbox"
            checked={selected.includes(o.value)}
            onChange={(e) => {
              const next = e.target.checked
                ? [...selected, o.value]
                : selected.filter((c) => c !== o.value)
              onChange(next)
            }}
            className="size-4 accent-primary"
          />
          {o.label}
        </label>
      ))}
    </div>
  )
}
