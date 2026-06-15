import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import { FormInput, FormField } from '@/components/FormField'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DatePicker from '@/components/ui/DatePicker'
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
  hall: string
  start_date: string
  end_date: string
  reason: string
  source: HallClosure['source']
} = {
  hall: '',
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
  const [editingGroup, setEditingGroup] = useState<ClosureGroup | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function getHallName(hallId: string): string {
    return halls.find((h) => h.id === hallId)?.name ?? hallId
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
    setForm({
      hall: group.records[0].hall,
      start_date: group.start_date,
      end_date: group.end_date,
      reason: group.reason,
      source: group.source,
    })
  }

  function cancelEdit() {
    setEditingGroup(null)
    setForm(emptyForm)
    setError(null)
  }

  async function handleSave() {
    if (!form.hall || !form.start_date || !form.end_date || !form.reason) {
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
        // Update all records in the group
        for (const rec of editingGroup.records) {
          await updateRecord('hall_closures', rec.id, {
            ...form,
            hall: rec.hall, // Keep each record's original hall
          })
          logActivity('update', 'hall_closures', rec.id, form)
        }
      } else {
        const rec = await createRecord<{ id: string }>('hall_closures', form)
        logActivity('create', 'hall_closures', rec.id, form)
      }
      setForm(emptyForm)
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
      for (const rec of group.records) {
        await deleteRecord('hall_closures', rec.id)
        logActivity('delete', 'hall_closures', rec.id)
      }
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label={t('hall')} helperText={editingGroup && editingGroup.records.length > 1 ? t('editAppliesToAllHalls', { count: editingGroup.records.length }) : undefined}>
              <Select value={form.hall} onValueChange={(v) => update('hall', v)} disabled={!!editingGroup}>
                <SelectTrigger className="min-h-[44px]">
                  <SelectValue placeholder={t('selectPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {halls.map((h) => (
                    <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label={t('source')}>
              <Select value={form.source} onValueChange={(v) => update('source', v as typeof form.source)}>
                <SelectTrigger className="min-h-[44px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>

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
            placeholder="e.g. Holidays, maintenance, renovation"
          />

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
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
