import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import { FormInput, FormTextarea, FormField } from '@/components/FormField'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { ChevronsUpDown, Check } from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import { Switch } from '@/components/ui/switch'
import { logActivity } from '../../../utils/logActivity'
import { useConfirm } from '../../../components/ConfirmProvider'
import { useConflictChecker } from '../hooks/useConflictChecker'
import { minutesToTime, timeToMinutes } from '../../../utils/dateHelpers'
import type { Hall, HallSlot, Team } from '../../../types'
import { createRecord, deleteRecord, updateRecord, teamToM2M } from '../../../lib/api'

/** Auto-derive "VB - <team>" / "BB - <team>" label from selected team ids.
 *  Pure helper so useState initializers can call it before the component
 *  body fully runs. */
function computeAutoLabel(teamIds: string[], teams: Team[]): string {
  if (teamIds.length === 0) return ''
  const selected = teamIds.map(id => teams.find(tm => tm.id === id)).filter(Boolean) as Team[]
  if (selected.length === 0) return ''
  const sport = selected[0].sport === 'basketball' ? 'BB' : 'VB'
  return `${sport} - ${selected.map(tm => tm.name).join(' / ')}`
}

interface SlotEditorProps {
  slot: HallSlot | null
  prefill: { day: number; time: string; hall: string } | null
  halls: Hall[]
  teams: Team[]
  allSlots: HallSlot[]
  isAdmin?: boolean
  coachTeamIds?: string[]
  adminTeamIds?: string[]
  onClose: () => void
  onSaved: () => void
}

export default function SlotEditor({
  slot,
  prefill,
  halls,
  teams,
  allSlots,
  isAdmin = true,
  coachTeamIds = [],
  adminTeamIds = [],
  onClose,
  onSaved,
}: SlotEditorProps) {
  const { t } = useTranslation('hallenplan')
  const confirm = useConfirm()

  const DAY_OPTIONS = [
    { value: 0, label: t('dayMonday') },
    { value: 1, label: t('dayTuesday') },
    { value: 2, label: t('dayWednesday') },
    { value: 3, label: t('dayThursday') },
    { value: 4, label: t('dayFriday') },
    { value: 5, label: t('daySaturday') },
    { value: 6, label: t('daySunday') },
  ]

  const TYPE_OPTIONS = [
    { value: 'training', label: t('typeTraining') },
    { value: 'game', label: t('typeGame') },
    { value: 'event', label: t('typeEvent') },
    { value: 'other', label: t('typeOther') },
  ]

  const defaultEnd = prefill?.time
    ? minutesToTime(timeToMinutes(prefill.time) + 90)
    : '19:30'

  const todayStr = new Date().toISOString().slice(0, 10)

  // Filter teams for coaches (own teams only) vs scoped admins
  const visibleTeams = isAdmin
    ? teams.filter((tm) => adminTeamIds.length === 0 || adminTeamIds.includes(tm.id))
    : teams.filter((tm) => coachTeamIds.includes(tm.id))
  const defaultTeam = slot?.team ?? (!isAdmin && coachTeamIds.length === 1 ? [coachTeamIds[0]] : [])
  const canDelete = isAdmin
    ? (slot?.team?.length ? adminTeamIds.length === 0 || slot.team.some(t => adminTeamIds.includes(t)) : true)
    : (slot?.team?.length ? slot.team.some(t => coachTeamIds.includes(t)) : false)

  // Build a synthetic "KWI A+B" option
  const kwiA = halls.find((h) => h.name === 'KWI A')
  const kwiB = halls.find((h) => h.name === 'KWI B')
  const COMBO_VALUE = kwiA && kwiB ? `${kwiA.id}+${kwiB.id}` : ''

  const [form, setForm] = useState({
    hall: slot?.hall ?? prefill?.hall ?? (halls[0]?.id ?? ''),
    team: defaultTeam,
    day_of_week: slot?.day_of_week ?? prefill?.day ?? 0,
    start_time: slot?.start_time ?? prefill?.time ?? '18:00',
    end_time: slot?.end_time ?? defaultEnd,
    slot_type: slot?.slot_type ?? ('training' as const),
    recurring: slot?.recurring ?? true,
    valid_from: (slot?.valid_from?.slice(0, 10)) || todayStr,
    valid_until: (slot?.valid_until?.slice(0, 10)) || '',
    label: slot?.label ?? '',
    notes: slot?.notes ?? '',
  })

  const [indefinitely, setIndefinitely] = useState(slot ? !!slot.indefinite : true)

  // Auto-label mode: ON means label is derived from selected teams, free-text
  // input is hidden. OFF means user has typed a custom label and we preserve
  // it. Initial state: ON unless an existing slot has a label that does NOT
  // match what the auto-derivation would have produced.
  const [autoLabelMode, setAutoLabelMode] = useState<boolean>(() => {
    if (!slot) return true
    const stored = slot.label ?? ''
    if (!stored) return true
    return stored === computeAutoLabel(defaultTeam, visibleTeams)
  })

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const conflicts = useConflictChecker(form, allSlots, slot?.id)

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  /** Update team selection; when auto-label mode is on, re-derive the label
   *  from the new team. Custom labels (autoLabelMode off) are left alone. */
  function updateTeam(newTeam: string[]) {
    setForm((prev) => ({
      ...prev,
      team: newTeam,
      label: autoLabelMode ? computeAutoLabel(newTeam, visibleTeams) : prev.label,
    }))
  }

  const isCombo = COMBO_VALUE && form.hall === COMBO_VALUE

  // Cascade + initial generation moved to the backend (`kscw-hooks`
  // `hall_slots.items.create` + `.update`) — see `slot-cascade.js`. Keeps
  // admin-UI / REST edits in sync with the React editor and adds:
  //   • day_of_week shift (existing future trainings re-dated to the new
  //     weekday in the same Mon-Sun week, preserving RSVPs/notes)
  //   • valid_from / valid_until / indefinite cascade (trim future
  //     trainings outside new window; generate missing dates inside).

  async function handleSave() {
    if (!form.hall) {
      setError(t('hallRequired'))
      return
    }
    if (timeToMinutes(form.start_time) >= timeToMinutes(form.end_time)) {
      setError(t('common:endAfterStart'))
      return
    }

    setIsSaving(true)
    setError(null)
    try {
      const payload = {
        ...form,
        indefinite: indefinitely,
      }
      let savedSlotId = slot?.id ?? ''

      const m2mPayload = teamToM2M(payload)
      // Postgres rejects empty string for date fields — send null instead
      m2mPayload.valid_until = (indefinitely || !form.valid_until) ? null : form.valid_until
      if (isCombo && kwiA && kwiB) {
        const hallIds = [kwiA.id, kwiB.id]
        if (slot) {
          await updateRecord('hall_slots', slot.id, { ...m2mPayload, hall: hallIds[0] })
          logActivity('update', 'hall_slots', slot.id, payload)
        } else {
          for (const hid of hallIds) {
            const rec = await createRecord<{ id: string }>('hall_slots', { ...m2mPayload, hall: hid })
            logActivity('create', 'hall_slots', rec.id, { ...payload, hall: hid })
            if (!savedSlotId) savedSlotId = rec.id
          }
        }
      } else if (slot) {
        await updateRecord('hall_slots', slot.id, m2mPayload)
        logActivity('update', 'hall_slots', slot.id, payload)
      } else {
        const rec = await createRecord<{ id: string }>('hall_slots', m2mPayload)
        logActivity('create', 'hall_slots', rec.id, payload)
        savedSlotId = rec.id
      }

      // Cascade + generation now run as Directus action hooks
      // (`hall_slots.items.create` / `.update`) — see slot-cascade.js.
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common:errorSaving'))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete() {
    if (!slot || !(await confirm({ message: t('deleteSlotConfirm'), danger: true }))) return
    setIsSaving(true)
    try {
      await deleteRecord('hall_slots', slot.id)
      logActivity('delete', 'hall_slots', slot.id)
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common:errorSaving'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={slot ? t('editSlotTitle') : t('newSlotTitle')}
      size="lg"
    >
      <div className="space-y-4">
        {/* Row 1: Hall + Team */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('hall')}>
            <Select value={form.hall} onValueChange={(v) => update('hall', v)}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue placeholder={t('selectPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {halls.flatMap((h) => {
                  const items = [<SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>]
                  if (COMBO_VALUE && h.name === 'KWI A') {
                    items.push(<SelectItem key="kwi-ab" value={COMBO_VALUE}>KWI A+B</SelectItem>)
                  }
                  return items
                })}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label={t('team')}>
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <Switch
                  checked={form.team.length === 0}
                  onCheckedChange={(checked) => {
                    if (checked) updateTeam([])
                  }}
                />
                <span>{t('freeSlot')}</span>
              </label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="min-h-[44px] w-full justify-between font-normal"
                  >
                    <span className={`truncate ${form.team.length === 0 ? 'italic text-muted-foreground' : ''}`}>
                      {form.team.length === 0
                        ? t('freeSlot')
                        : form.team.map(id => visibleTeams.find(tm => tm.id === id)?.name).filter(Boolean).join(', ')}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder={t('searchTeam')} />
                    <CommandList
                      style={{ maxHeight: 'min(60vh, var(--radix-popover-content-available-height, 400px))' }}
                    >
                      <CommandEmpty>{t('noTeamFound')}</CommandEmpty>
                      {(['volleyball', 'basketball'] as const).map(sport => {
                        const sportTeams = visibleTeams.filter(tm => tm.sport === sport)
                        if (sportTeams.length === 0) return null
                        return (
                          <CommandGroup key={sport} heading={sport === 'volleyball' ? 'Volleyball' : 'Basketball'}>
                            {sportTeams.map(tm => (
                              <CommandItem
                                key={tm.id}
                                value={tm.name}
                                onSelect={() => {
                                  updateTeam(form.team.includes(tm.id)
                                    ? form.team.filter((id: string) => id !== tm.id)
                                    : [...form.team, tm.id])
                                }}
                              >
                                <Check className={`mr-2 h-4 w-4 ${form.team.includes(tm.id) ? 'opacity-100' : 'opacity-0'}`} />
                                {tm.name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        )
                      })}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </FormField>
        </div>

        {/* Row 2: Day + Type */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('dayOfWeek')}>
            <Select value={String(form.day_of_week)} onValueChange={(v) => update('day_of_week', Number(v))}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAY_OPTIONS.map((d) => (
                  <SelectItem key={d.value} value={String(d.value)}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label={t('slotType')}>
            <Select value={form.slot_type} onValueChange={(v) => update('slot_type', v as typeof form.slot_type)}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((tp) => (
                  <SelectItem key={tp.value} value={tp.value}>{tp.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>

        {/* Row 3: Times */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormInput
            type="time"
            label={t('startTime')}
            value={form.start_time}
            onChange={(e) => update('start_time', e.target.value)}
          />
          <FormInput
            type="time"
            label={t('endTime')}
            value={form.end_time}
            onChange={(e) => update('end_time', e.target.value)}
          />
        </div>

        {/* Row 4: Recurring */}
        <div className="flex items-center gap-2">
          <Switch checked={form.recurring} onCheckedChange={(checked) => update('recurring', checked)} />
          <span className="text-sm text-gray-700 dark:text-gray-300">{t('recurring')}</span>
        </div>

        {/* Row 5: Validity dates (only if recurring) */}
        {form.recurring && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('validFrom')}
              </label>
              <div className="flex items-stretch gap-2">
                <div className="min-w-0 flex-1">
                  <DatePicker
                    value={form.valid_from}
                    onChange={(v) => update('valid_from', v)}
                    fromYear={new Date().getFullYear()}
                  />
                </div>
                <div className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-medium ${indefinitely ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300 dark:border-brand-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'}`}>
                  <Switch
                    checked={indefinitely}
                    onCheckedChange={(checked) => {
                      setIndefinitely(checked)
                      update('valid_until', '')
                    }}
                  />
                  {t('indefinitely')}
                </div>
              </div>
            </div>
            {!indefinitely && (
              <DatePicker
                label={t('validTo')}
                value={form.valid_until}
                onChange={(v) => update('valid_until', v)}
                fromYear={new Date().getFullYear()}
              />
            )}
          </div>
        )}

        {/* Row 6: Label — auto-derived by default, custom free-text on demand */}
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <Switch
              checked={autoLabelMode}
              onCheckedChange={(checked) => {
                setAutoLabelMode(checked)
                if (checked) update('label', computeAutoLabel(form.team, visibleTeams))
              }}
            />
            <span>{t('autoLabel')}</span>
            {autoLabelMode && (
              <span className="ml-2 truncate text-xs italic text-gray-500 dark:text-gray-400">
                {form.label || '—'}
              </span>
            )}
          </label>
          {!autoLabelMode && (
            <FormInput
              type="text"
              label={t('label')}
              value={form.label}
              onChange={(e) => update('label', e.target.value)}
              placeholder="e.g. Trial training, Home game vs. TVA"
            />
          )}
        </div>

        {/* Row 7: Notes */}
        <FormTextarea
          label={t('notes')}
          value={form.notes}
          onChange={(e) => update('notes', e.target.value)}
          rows={3}
        />

        {/* Conflict warning */}
        {conflicts.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="font-medium text-amber-800">{t('common:overlapDetected')}</p>
            <ul className="mt-1 list-inside list-disc text-sm text-amber-700">
              {conflicts.map((c) => (
                <li key={c.id}>
                  {DAY_OPTIONS[c.day_of_week]?.label} {c.start_time}–{c.end_time}
                  {c.label ? ` (${c.label})` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between border-t pt-4">
          <div>
            {slot && canDelete && (
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isSaving}
                className="bg-transparent text-red-600 hover:bg-red-50 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-900/20"
              >
                {t('common:delete')}
              </Button>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={onClose}>
              {t('common:cancel')}
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              loading={isSaving}
            >
              {isSaving ? t('common:saving') : t('common:save')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
