import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/components/Modal'
import { useAuth } from '../../hooks/useAuth'
import { useAdminMode } from '../../hooks/useAdminMode'
import { useMutation } from '../../hooks/useMutation'
import { useCollection } from '../../lib/query'
import { useMultiTeamMembers } from '../../hooks/useTeamMembers'
import { asObj } from '../../utils/relations'
import { Button } from '@/components/ui/button'
import { FormTextarea } from '@/components/FormField'
import DatePicker from '@/components/ui/DatePicker'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import AffectsMultiSelect from '@/components/AffectsMultiSelect'
import type { Absence, Member } from '../../types'
import { memberName, relId } from '../../utils/relations'

interface AbsenceFormProps {
  open: boolean
  absence?: Absence | null
  onSave: () => void
  onCancel: () => void
  /** When true, coaches/responsibles can pick a team member */
  forTeam?: boolean
  /** Team IDs to scope the member picker */
  teamIds?: string[]
}

export default function AbsenceForm({ open, absence, onSave, onCancel, forTeam, teamIds }: AbsenceFormProps) {
  const { t } = useTranslation('absences')
  const { user, coachTeamIds } = useAuth()
  const { effectiveIsAdmin, effectiveIsCoach } = useAdminMode()
  const { create, update, isLoading } = useMutation<Absence>('absences')

  // Show member picker for admins OR coaches/responsibles on team tab
  const isCoachOrResponsible = coachTeamIds.length > 0 || effectiveIsCoach
  const showMemberPicker = effectiveIsAdmin || (forTeam && isCoachOrResponsible)

  // Admins: fetch all active members club-wide.
  const { data: allMembersRaw } = useCollection<Member>('members', {
    filter: { kscw_membership_active: { _eq: true } },
    sort: ['last_name'],
    all: true,
    fields: ['id', 'first_name', 'last_name'],
    enabled: showMemberPicker && effectiveIsAdmin,
  })
  // Coaches/TRs: fetch members of their coached teams via member_teams junction
  // (deep `members.member_teams.team._in` filter is unreliable here — single-level
  // junction filter is the proven pattern from useTeamAbsences).
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
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState<Absence['reason']>('other')
  const [reasonDetail, setReasonDetail] = useState('')
  const [affects, setAffects] = useState<string[]>(['all'])
  const [indefinite, setIndefinite] = useState(false)
  const [blocking, setBlocking] = useState(true)
  const [validationError, setValidationError] = useState('')

  // Initialise form state once per modal-open. Including `user` in deps would
  // reset the picker every time useAuth refreshes (real-time events, refetch)
  // — silently clobbering a coach's selection back to themselves.
  useEffect(() => {
    if (!open) return
    if (absence) {
      setMemberId(relId(absence.member))
      setStartDate(absence.start_date.split(' ')[0])
      setEndDate(absence.indefinite ? '' : absence.end_date.split(' ')[0])
      setReason(absence.reason)
      setReasonDetail(absence.reason_detail)
      setAffects(absence.affects ?? ['all'])
      setIndefinite(absence.indefinite ?? false)
      setBlocking(absence.blocking ?? true)
    } else {
      setMemberId(user?.id ?? '')
      setStartDate('')
      setEndDate('')
      setReason('other')
      setReasonDetail('')
      setAffects(['all'])
      setIndefinite(false)
      setBlocking(true)
    }
    setValidationError('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, absence])

  // Synchronous re-entry lock — React state updates (useMutation.isLoading)
  // are async and don't block rapid double-clicks before the next render.
  // Without this, a frustrated user mashing Save creates duplicate rows
  // (the 2026-05-12 Sara Berke incident: 5 identical Monday weeklies in 50min).
  const submittingRef = useRef(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submittingRef.current) return
    setValidationError('')

    if (showMemberPicker && !memberId) {
      setValidationError(t('memberRequired'))
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
      start_date: startDate,
      end_date: indefinite ? '2099-12-31' : endDate,
      reason,
      reason_detail: reasonDetail,
      affects,
      type: 'standard' as const,
      indefinite,
      blocking,
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
      title={absence ? t('editAbsenceTitle') : t('newAbsenceTitle')}
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

        <div>
          <label className="mb-1.5 block text-sm font-medium">{t('reason')}</label>
          <Select value={reason} onValueChange={(v) => setReason(v as Absence['reason'])}>
            <SelectTrigger className="min-h-[44px] w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="injury">{t('reasonInjury')}</SelectItem>
              <SelectItem value="vacation">{t('reasonVacation')}</SelectItem>
              <SelectItem value="work">{t('reasonWork')}</SelectItem>
              <SelectItem value="personal">{t('reasonPersonal')}</SelectItem>
              <SelectItem value="other">{t('reasonOther')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <FormTextarea
          label={t('detailsOptional')}
          value={reasonDetail}
          onChange={(e) => setReasonDetail(e.target.value)}
          rows={2}
          placeholder={showMemberPicker && memberId && memberId !== user?.id
            ? t('detailsOnBehalfPlaceholder')
            : t('detailsPlaceholder')}
        />
        {showMemberPicker && memberId && memberId !== user?.id && (
          <p className="-mt-3 text-xs text-amber-600 dark:text-amber-400">
            {t('noteOnBehalfHint')}
          </p>
        )}

        <div data-tour="affects-teams">
        <AffectsMultiSelect
          label={t('affects')}
          selected={affects}
          onChange={setAffects}
        />
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <label className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <Checkbox
              className="mt-0.5"
              checked={blocking}
              onCheckedChange={(checked) => setBlocking(checked === true)}
            />
            <span>
              <span className="font-medium">{t('blocking')}</span>
              <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                {t('blockingHint')}
              </span>
            </span>
          </label>
        </div>

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
