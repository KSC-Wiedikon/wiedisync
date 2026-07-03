import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import { FormInput, FormField } from '@/components/FormField'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DatePicker from '@/components/ui/DatePicker'
import { cn } from '@/lib/utils'
import { logActivity } from '../../../utils/logActivity'
import { useConfirm } from '../../../components/ConfirmProvider'
import type { Hall, HallClosure } from '../../../types'
import { createRecord, deleteRecord, updateRecord } from '../../../lib/api'

interface ClosureManagerProps {
  halls: Hall[]
  closures: HallClosure[]
  onClose: () => void
  onChanged: () => void
}

interface ClosureGroup {
  key: string
  reason: string
  start_date: string
  end_date: string
  source: HallClosure['source']
  hallNames: string[]
  records: HallClosure[]
}

const emptyForm: {
  start_date: string
  end_date: string
  reason: string
  source: HallClosure['source']
} = {
  start_date: '',
  end_date: '',
  reason: '',
  source: 'admin',
}

const SOURCE_COLORS: Record<string, string> = {
  school_holidays: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  gcal: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  hauswart: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  admin: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  auto: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
}

export default function ClosureManager({ halls, closures, onClose, onChanged }: ClosureManagerProps) {
  const { t } = useTranslation('hallenplan')
  const confirm = useConfirm()

  const SOURCE_OPTIONS = [
    { value: 'hauswart', label: t('sourceCaretaker') },
    { value: 'admin', label: t('sourceAdmin') },
    { value: 'auto', label: t('sourceAutomatic') },
    { value: 'gcal', label: t('sourceGcal') },
    { value: 'school_holidays', label: t('sourceSchoolHolidays') },
  ]

  const sourceLabel = (s: string) => SOURCE_OPTIONS.find((o) => o.value === s)?.label ?? s

  const [form, setForm] = useState(emptyForm)
  const [selectedHalls, setSelectedHalls] = useState<string[]>([])
  const [editingGroup, setEditingGroup] = useState<ClosureGroup | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function getHallName(hallId: string): string {
    return halls.find((h) => h.id === hallId)?.name ?? hallId
  }

  // Quick-select presets
  const kwiHallIds = useMemo(
    () => halls.filter((h) => h.name.trim().toLowerCase().startsWith('kwi')).map((h) => h.id),
    [halls],
  )
  const allHallIds = useMemo(() => halls.map((h) => h.id), [halls])

  const kwiActive = kwiHallIds.length > 0 && kwiHallIds.every((id) => selectedHalls.includes(id))
  const allActive = allHallIds.length > 0 && allHallIds.every((id) => selectedHalls.includes(id))

  function toggleHall(id: string) {
    setSelectedHalls((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  // Union-add a preset's halls; if all already selected, toggle them off.
  function applyPreset(ids: string[]) {
    setSelectedHalls((prev) => {
      const allOn = ids.length > 0 && ids.every((id) => prev.includes(id))
      if (allOn) return prev.filter((id) => !ids.includes(id))
      return Array.from(new Set([...prev, ...ids]))
    })
  }

  // Group closures by reason + date range + source
  const groups = useMemo<ClosureGroup[]>(() => {
    const map = new Map<string, ClosureGroup>()
    for (const c of closures) {
      const startStr = c.start_date.split('T')[0].split(' ')[0]
      const endStr = c.end_date.split('T')[0].split(' ')[0]
      const key = `${c.reason}|${startStr}|${endStr}|${c.source}`
      const existing = map.get(key)
      if (existing) {
        existing.hallNames.push(getHallName(c.hall))
        existing.records.push(c)
      } else {
        map.set(key, {
          key,
          reason: c.reason,
          start_date: startStr,
          end_date: endStr,
          source: c.source,
          hallNames: [getHallName(c.hall)],
          records: [c],
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => a.start_date.localeCompare(b.start_date))
  }, [closures, halls])

  function formatDateDisplay(dateStr: string): string {
    if (!dateStr) return ''
    const parts = dateStr.split('-')
    if (parts.length !== 3) return dateStr
    return `${parts[2]}.${parts[1]}.${parts[0]}`
  }

  function startEdit(group: ClosureGroup) {
    setEditingGroup(group)
    setSelectedHalls(group.records.map((r) => r.hall))
    setForm({
      start_date: group.start_date,
      end_date: group.end_date,
      reason: group.reason,
      source: group.source,
    })
  }

  function cancelEdit() {
    setEditingGroup(null)
    setSelectedHalls([])
    setForm(emptyForm)
    setError(null)
  }

  async function handleSave() {
    if (selectedHalls.length === 0) {
      setError(t('hallRequired'))
      return
    }
    if (!form.start_date || !form.end_date || !form.reason) {
      setError(t('common:required'))
      return
    }
    if (form.start_date > form.end_date) {
      setError(t('common:endAfterStart'))
      return
    }

    setIsSaving(true)
    setError(null)
    try {
      if (editingGroup) {
        // Reconcile the group's halls against the new selection:
        // keep+update overlaps, delete removed halls, create added halls.
        const byHall = new Map(editingGroup.records.map((r) => [r.hall, r]))
        const target = new Set(selectedHalls)
        await Promise.all([
          ...Array.from(byHall.entries()).map(async ([hallId, rec]) => {
            if (target.has(hallId)) {
              await updateRecord('hall_closures', rec.id, { ...form, hall: hallId })
              logActivity('update', 'hall_closures', rec.id, { ...form, hall: hallId })
            } else {
              await deleteRecord('hall_closures', rec.id)
              logActivity('delete', 'hall_closures', rec.id)
            }
          }),
          ...selectedHalls
            .filter((hallId) => !byHall.has(hallId))
            .map(async (hallId) => {
              const rec = await createRecord<{ id: string }>('hall_closures', { ...form, hall: hallId })
              logActivity('create', 'hall_closures', rec.id, { ...form, hall: hallId })
            }),
        ])
      } else {
        await Promise.all(
          selectedHalls.map(async (hallId) => {
            const rec = await createRecord<{ id: string }>('hall_closures', { ...form, hall: hallId })
            logActivity('create', 'hall_closures', rec.id, { ...form, hall: hallId })
          }),
        )
      }
      setForm(emptyForm)
      setSelectedHalls([])
      setEditingGroup(null)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common:errorSaving'))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDeleteGroup(group: ClosureGroup) {
    const msg = group.records.length > 1
      ? `${t('deleteClosureConfirm')} (${group.records.length} ${t('halls')})`
      : t('deleteClosureConfirm')
    if (!(await confirm({ message: msg, danger: true }))) return
    try {
      await Promise.all(
        group.records.map(async (rec) => {
          await deleteRecord('hall_closures', rec.id)
          logActivity('delete', 'hall_closures', rec.id)
        }),
      )
      if (editingGroup?.key === group.key) cancelEdit()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common:errorSaving'))
    }
  }

  const allHalls = halls.length > 0 && groups.length > 0

  return (
    <Modal open onClose={onClose} title={t('closuresTitle')} size="lg">
      <div className="space-y-6">
        {/* Existing closures grouped */}
        {groups.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('currentClosures')}</h3>
            <div className="max-h-80 divide-y overflow-y-auto rounded-md border dark:border-gray-700">
              {groups.map((group) => {
                const isAllHalls = allHalls && group.records.length >= halls.length
                const dateRange = group.start_date === group.end_date
                  ? formatDateDisplay(group.start_date)
                  : `${formatDateDisplay(group.start_date)} – ${formatDateDisplay(group.end_date)}`

                return (
                  <div key={group.key} className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-sm text-gray-900 dark:text-gray-100">{group.reason}</span>
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${SOURCE_COLORS[group.source] ?? SOURCE_COLORS.admin}`}>
                            {sourceLabel(group.source)}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {dateRange}
                          <span className="mx-1.5">·</span>
                          {isAllHalls ? (
                            <span className="font-medium text-gray-600 dark:text-gray-300">{t('allHalls')}</span>
                          ) : (
                            group.hallNames.sort().join(', ')
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startEdit(group)}
                          className="text-brand-600 hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-gray-800"
                        >
                          {t('common:edit')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteGroup(group)}
                          className="text-red-600 hover:bg-red-50 hover:text-red-800 dark:hover:bg-gray-800"
                        >
                          {t('common:delete')}
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('noClosures')}</p>
        )}

        {/* Add/edit form */}
        <div className="space-y-4 rounded-lg border bg-gray-50 dark:bg-gray-900 p-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {editingGroup ? t('editClosure') : t('addNewClosure')}
          </h3>

          <FormField label={t('hallsField')} helperText={t('selectHallsHint')}>
            <div className="space-y-2">
              {/* Quick presets */}
              <div className="flex flex-wrap gap-2">
                {kwiHallIds.length > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant={kwiActive ? 'default' : 'outline'}
                    onClick={() => applyPreset(kwiHallIds)}
                  >
                    {t('presetKwi')}
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant={allActive ? 'default' : 'outline'}
                  onClick={() => applyPreset(allHallIds)}
                >
                  {t('allHalls')}
                </Button>
              </div>
              {/* Per-hall toggle chips */}
              <div className="flex flex-wrap gap-2">
                {halls.map((h) => {
                  const active = selectedHalls.includes(h.id)
                  return (
                    <button
                      type="button"
                      key={h.id}
                      onClick={() => toggleHall(h.id)}
                      aria-pressed={active}
                      className={cn(
                        'min-h-[44px] rounded-full border px-4 text-sm font-medium transition-colors',
                        active
                          ? 'border-brand-600 bg-brand-600 text-white'
                          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700',
                      )}
                    >
                      {h.name}
                    </button>
                  )
                })}
              </div>
            </div>
          </FormField>

          <FormField label={t('source')}>
            <Select value={form.source} onValueChange={(v) => update('source', v as typeof form.source)}>
              <SelectTrigger className="min-h-[44px] sm:max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DatePicker
              label={t('common:from')}
              value={form.start_date}
              onChange={(v) => update('start_date', v)}
            />
            <DatePicker
              label={t('common:to')}
              value={form.end_date}
              onChange={(v) => update('end_date', v)}
            />
          </div>

          <FormInput
            type="text"
            label={t('common:reason')}
            value={form.reason}
            onChange={(e) => update('reason', e.target.value)}
            placeholder={t('closureReasonPlaceholder')}
          />

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            {editingGroup && (
              <Button variant="ghost" onClick={cancelEdit}>
                {t('common:cancel')}
              </Button>
            )}
            <Button
              onClick={handleSave}
              disabled={isSaving}
              loading={isSaving}
            >
              {isSaving ? t('common:saving') : editingGroup ? t('common:update') : t('common:add')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
