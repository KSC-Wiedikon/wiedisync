import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FormInput, FormField } from '@/components/FormField'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DatePicker from '@/components/ui/DatePicker'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { logActivity } from '../../utils/logActivity'
import { useConfirm } from '../../components/ConfirmProvider'
import { useCollection } from '../../lib/query'
import { useReportPageLoading } from '../../hooks/usePageReady'
import type { Hall, HallClosure } from '../../types'
import { createRecord, deleteRecord, updateRecord } from '../../lib/api'

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

/** Sync-owned sources: the schulferien + gcal jobs reconcile their own rows against
 *  their feed, so a hand-made closure filed under either is deleted on the next run. */
const SYNC_OWNED: HallClosure['source'][] = ['gcal', 'school_holidays']

const EMPTY_HALLS: Hall[] = []
const EMPTY_CLOSURES: HallClosure[] = []

/** Normalise a Directus date to `yyyy-mm-dd` (rows come back bare or with a time part). */
function dateKey(value: string): string {
  return value.split('T')[0].split(' ')[0]
}

/**
 * Hall closures — the club-wide "the hall is shut" record. Feeds the calendar,
 * the Hallenplan, the iCal feed, Spielplanung home-slot blocking and the training
 * auto-cancel hook.
 *
 * Its own page rather than a modal, because the list has to be able to show
 * closures far outside whatever week the Hallenplan happens to be on: as a modal
 * it inherited the Hallenplan's week-scoped closure query, so a newly added
 * closure months out was saved correctly and then simply never appeared.
 *
 * Mounted at /admin/hallenplan/closures (member app) and
 * /admin/terminplanung/closures (scheduling app) — hence `navigate(-1)` for back.
 */
export default function ClosuresPage() {
  const { t } = useTranslation('hallenplan')
  const navigate = useNavigate()
  const confirm = useConfirm()

  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [scope, setScope] = useState<'upcoming' | 'all'>('upcoming')

  const { data: hallsRaw } = useCollection<Hall>('halls', { sort: ['name'], limit: 50 })
  const halls = hallsRaw ?? EMPTY_HALLS

  const {
    data: closuresRaw,
    isLoading,
    refetch,
  } = useCollection<HallClosure>('hall_closures', {
    filter: scope === 'upcoming' ? { end_date: { _gte: today } } : undefined,
    sort: scope === 'upcoming' ? ['start_date'] : ['-start_date'],
    fields: ['id', 'hall', 'start_date', 'end_date', 'reason', 'source'],
    limit: 1000,
  })
  const closures = closuresRaw ?? EMPTY_CLOSURES

  useReportPageLoading(isLoading)

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
  // Row just written — highlighted for a few seconds so the save is visibly confirmed.
  const [highlightKey, setHighlightKey] = useState<string | null>(null)
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const formRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => () => { if (highlightTimer.current) clearTimeout(highlightTimer.current) }, [])

  function flashRow(key: string) {
    setHighlightKey(key)
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => setHighlightKey(null), 5000)
  }

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
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

  // Group closures by reason + date range + source — one row per hall in the DB,
  // but a KWI A+B+C closure is one thing to a human.
  const groups = useMemo<ClosureGroup[]>(() => {
    const hallNameById = new Map(halls.map((h) => [h.id, h.name]))
    const nameOf = (hallId: string) => hallNameById.get(hallId) ?? hallId
    const map = new Map<string, ClosureGroup>()
    for (const c of closures) {
      const startStr = dateKey(c.start_date)
      const endStr = dateKey(c.end_date)
      const key = `${c.reason}|${startStr}|${endStr}|${c.source}`
      const existing = map.get(key)
      if (existing) {
        existing.hallNames.push(nameOf(c.hall))
        existing.records.push(c)
      } else {
        map.set(key, {
          key,
          reason: c.reason,
          start_date: startStr,
          end_date: endStr,
          source: c.source,
          hallNames: [nameOf(c.hall)],
          records: [c],
        })
      }
    }
    const list = Array.from(map.values())
    list.sort((a, b) => (scope === 'upcoming'
      ? a.start_date.localeCompare(b.start_date)
      : b.start_date.localeCompare(a.start_date)))
    return list
  }, [closures, halls, scope])

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
    setError(null)
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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

    const wasEditing = !!editingGroup
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

      const savedKey = `${form.reason}|${form.start_date}|${form.end_date}|${form.source}`
      const savedHallCount = selectedHalls.length
      const savedRange = form.start_date === form.end_date
        ? formatDateDisplay(form.start_date)
        : `${formatDateDisplay(form.start_date)} – ${formatDateDisplay(form.end_date)}`

      setForm(emptyForm)
      setSelectedHalls([])
      setEditingGroup(null)
      await refetch()

      // A closure saved outside the current scope would vanish from the list —
      // switch to "all" so the confirmation the user just got is actually visible.
      if (scope === 'upcoming' && form.end_date < today) setScope('all')
      flashRow(savedKey)
      toast.success(
        wasEditing
          ? t('closureUpdatedToast', { range: savedRange, count: savedHallCount })
          : t('closureAddedToast', { range: savedRange, count: savedHallCount }),
      )
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
      await refetch()
      toast.success(t('closureDeletedToast'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common:errorSaving'))
    }
  }

  const hasHalls = halls.length > 0

  return (
    <div>
      {/* Header */}
      <div className="mb-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-2 inline-flex min-h-[44px] items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('common:back')}
        </button>
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl dark:text-gray-100">{t('closuresTitle')}</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t('closuresSubtitle')}</p>
      </div>

      {/* Add / edit form */}
      <div ref={formRef} className="mb-6 space-y-4 rounded-lg border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {editingGroup ? t('editClosure') : t('addNewClosure')}
        </h2>

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

        {SYNC_OWNED.includes(form.source) && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            {t('closureSyncOwnedWarning')}
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DatePicker
            label={t('common:from')}
            value={form.start_date}
            onChange={(v) => update('start_date', v)}
          />
          <DatePicker
            label={t('common:to')}
            value={form.end_date}
            min={form.start_date}
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
          <Button onClick={handleSave} disabled={isSaving} loading={isSaving}>
            {isSaving ? t('common:saving') : editingGroup ? t('common:update') : t('common:add')}
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('currentClosures')}</h2>
          <div className="flex gap-2">
            {(['upcoming', 'all'] as const).map((s) => (
              <Button
                key={s}
                type="button"
                size="sm"
                variant={scope === s ? 'default' : 'outline'}
                onClick={() => setScope(s)}
              >
                {s === 'upcoming' ? t('closuresScopeUpcoming') : t('closuresScopeAll')}
              </Button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">{t('common:loading')}</p>
        ) : groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">{t('noClosures')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('closuresColDates')}</TableHead>
                <TableHead>{t('common:reason')}</TableHead>
                <TableHead>{t('hallsField')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('source')}</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => {
                const isAllHalls = hasHalls && group.records.length >= halls.length
                const dateRange = group.start_date === group.end_date
                  ? formatDateDisplay(group.start_date)
                  : `${formatDateDisplay(group.start_date)} – ${formatDateDisplay(group.end_date)}`

                return (
                  <TableRow
                    key={group.key}
                    className={cn(
                      'min-h-[44px]',
                      highlightKey === group.key && 'bg-green-50 dark:bg-green-900/30',
                    )}
                  >
                    <TableCell className="whitespace-normal break-words font-medium tabular-nums">
                      {dateRange}
                    </TableCell>
                    <TableCell className="whitespace-normal break-words">{group.reason}</TableCell>
                    <TableCell className="whitespace-normal break-words text-gray-500 dark:text-gray-400">
                      {isAllHalls ? (
                        <span className="font-medium text-gray-600 dark:text-gray-300">{t('allHalls')}</span>
                      ) : (
                        [...group.hallNames].sort().join(', ')
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${SOURCE_COLORS[group.source] ?? SOURCE_COLORS.admin}`}>
                        {sourceLabel(group.source)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 sm:flex-row">
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
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
