import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/components/Modal'
import { useAuth } from '../../hooks/useAuth'
import { useAdminMode } from '../../hooks/useAdminMode'
import { useMutation } from '../../hooks/useMutation'
import { useCollection } from '../../lib/query'
import { Button } from '@/components/ui/button'
import { FormTextarea } from '@/components/FormField'
import DatePicker from '@/components/ui/DatePicker'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { Checkbox } from '@/components/ui/checkbox'
import AffectsMultiSelect from '@/components/AffectsMultiSelect'
import type { Absence, Member } from '../../types'
import { memberName, relId, asObj } from '../../utils/relations'
import { useMultiTeamMembers } from '../../hooks/useTeamMembers'

const DAY_KEYS = ['dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat', 'daySun'] as const

interface WeeklyUnavailabilityFormProps {
  open: boolean
  absence?: Absence | null
  onSave: () => void
  onCancel: () => void
  forTeam?: boolean
  teamIds?: string[]
}

export default function WeeklyUnavailabilityForm({ open, absence, onSave, onCancel, forTeam, teamIds }: WeeklyUnavailabilityFormProps) {
  const { t } = useTranslation('absences')
  const { user, coachTeamIds } = useAuth()
  const { effectiveIsAdmin, effectiveIsCoach } = useAdminMode()
  const { create, update, isLoading } = useMutation<Absence>('absences')

  const isCoachOrResponsible = coachTeamIds.length > 0 || effectiveIsCoach
  const showMemberPicker = effectiveIsAdmin || (forTeam && isCoachOrResponsible)

  const { data: allMembersRaw } = useCollection<Member>('members', {
    filter: { kscw_membership_active: { _eq: true } },
    sort: ['last_name'],
    all: true,
    fields: ['id', 'first_name', 'last_name'],
    enabled: showMemberPicker && effectiveIsAdmin,
  })
  const { members: teamMemberRows } = useMultiTeamMembers(
    showMemberPicker && !effectiveIsAdmin ? (teamIds ?? []) : [],
  )
  const visibleMembers: Member[] = effectiveIsAdmin
    ? (allMembersRaw ?? [])
    : teamMemberRows
        .map((mt) => asObj<Member>(mt.member))
        .filter((m): m is Member => !!m && m.kscw_membership_active !== false)
        .sort((a, b) => (a.last_name ?? '').localeCompare(b.last_name ?? ''))

  const [memberId, setMemberId] = useState('')
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([])
  const [affects, setAffects] = useState<string[]>(['all'])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [indefinite, setIndefinite] = useState(true)
  const [note, setNote] = useState('')
  const [validationError, setValidationError] = useState('')

  // Initialise once per modal-open. `user` is deliberately NOT part of the key:
  // re-keying on it would reset the picker on every useAuth refresh, clobbering
  // a coach's selection back to themselves.
  // Uses React's adjust-state-during-render pattern (same trigger set as the
  // previous `useEffect(…, [open, absence])`: first render + every open/absence
  // change), so the fields are already correct on the first paint.
  const [prevInit, setPrevInit] = useState<{ open: boolean; absence: Absence | null | undefined } | null>(null)
  if (!prevInit || prevInit.open !== open || prevInit.absence !== absence) {
    setPrevInit({ open, absence })
    if (open) {
      if (absence) {
        setMemberId(relId(absence.member))
        setDaysOfWeek(absence.days_of_week ?? [])
        setAffects(absence.affects ?? ['all'])
        setStartDate(absence.start_date.split(' ')[0])
        setEndDate(absence.indefinite ? '' : absence.end_date.split(' ')[0])
        setIndefinite(absence.indefinite ?? false)
        setNote(absence.reason_detail ?? '')
      } else {
        setMemberId(user?.id ?? '')
        setDaysOfWeek([])
        setAffects(['all'])
        setStartDate('')
        setEndDate('')
        setIndefinite(true)
        setNote('')
      }
      setValidationError('')
    }
  }

  function toggleDay(day: number) {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    )
  }

  // Synchronous re-entry lock against double-submit (see AbsenceForm for context).
  const submittingRef = useRef(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submittingRef.current) return
    setValidationError('')

    if (showMemberPicker && !memberId) {
      setValidationError(t('memberRequired'))
      return
    }
    if (daysOfWeek.length === 0) {
      setValidationError(t('atLeastOneDay'))
      return
    }
    if (!startDate) {
      setValidationError(t('startDateRequired'))
      return
    }
    if (!indefinite && !endDate) {
      setValidationError(t('endDateRequired'))
      return
    }
    if (!indefinite && endDate < startDate) {
      setValidationError(t('endAfterStart'))
      return
    }

    submittingRef.current = true
    const data = {
      member: memberId || user?.id,
      type: 'weekly' as const,
      days_of_week: daysOfWeek,
      start_date: startDate,
      end_date: indefinite ? '2099-12-31' : endDate,
      indefinite,
      affects,
      reason: 'other' as const,
      reason_detail: note,
    }

    try {
      if (absence) {
        await update(absence.id, data)
      } else {
        await create(data)
      }
      onSave()
    } catch {
      setValidationError(t('errorSaving'))
    } finally {
      submittingRef.current = false
    }
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={absence ? t('editWeeklyTitle') : t('newWeeklyTitle')}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {showMemberPicker && (
          <SearchableSelect
            label={t('member')}
            placeholder={t('common:select')}
            value={memberId}
            onChange={setMemberId}
            options={visibleMembers.map((m) => ({ value: m.id, label: memberName(m) || '—' }))}
          />
        )}

        {/* Days of week selector */}
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('daysOfWeek')}</label>
          <div className="flex flex-wrap gap-2">
            {DAY_KEYS.map((key, index) => {
              const isSelected = daysOfWeek.includes(index)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleDay(index)}
                  className={`min-h-[44px] rounded-full px-4 py-2 text-sm font-medium transition-colors sm:min-h-0 sm:px-3 sm:py-1.5 ${
                    isSelected
                      ? 'bg-brand-500 text-white shadow-sm'
                      : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                >
                  {t(key)}
                </button>
              )
            })}
          </div>
        </div>

        <AffectsMultiSelect
          label={t('affects')}
          selected={affects}
          onChange={setAffects}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DatePicker
            label={t('startDate')}
            value={startDate}
            onChange={(v) => {
              setStartDate(v)
              if (!indefinite && (!endDate || endDate < v)) setEndDate(v)
            }}
          />
          {!indefinite && (
            <DatePicker
              label={t('endDate')}
              value={endDate}
              onChange={setEndDate}
              min={startDate}
            />
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
          <Checkbox
            checked={indefinite}
            onCheckedChange={(checked) => setIndefinite(checked === true)}
          />
          {t('indefinite')}
          <span className="text-gray-400 dark:text-gray-500">({t('indefiniteHint')})</span>
        </label>

        <FormTextarea
          label={t('noteOptional')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder={showMemberPicker && memberId && memberId !== user?.id
            ? t('detailsOnBehalfPlaceholder')
            : t('notePlaceholder')}
        />
        {showMemberPicker && memberId && memberId !== user?.id && (
          <p className="-mt-3 text-xs text-amber-600 dark:text-amber-400">
            {t('noteOnBehalfHint')}
          </p>
        )}

        {validationError && (
          <p className="text-sm text-red-600">{validationError}</p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="ghost" type="button" onClick={onCancel}>
            {t('common:cancel')}
          </Button>
          <Button type="submit" loading={isLoading}>
            {isLoading ? t('common:saving') : t('common:save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
