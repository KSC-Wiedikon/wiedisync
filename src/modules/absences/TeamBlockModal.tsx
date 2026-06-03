import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/components/Modal'
import { useMutation } from '../../hooks/useMutation'
import { Button } from '@/components/ui/button'
import { FormInput } from '@/components/FormField'
import DatePicker from '@/components/ui/DatePicker'
import SearchableSelect from '@/components/ui/SearchableSelect'
import type { SchedulingBlock } from '../../types'

interface TeamBlockModalProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  /** Teams the user may block (coach/TR teams, or all for admins/Spielplaner). */
  teamOptions: { value: string; label: string }[]
}

/**
 * Create a team-level scheduling blackout ("Team blocking", migration 085).
 * Coach/TR-only — hard-blocks game scheduling for the team on the chosen dates,
 * unlike player absences which proposal 3 tolerates up to 2 of. The backend
 * `scheduling_blocks.items.create` hook re-checks team ownership.
 */
export default function TeamBlockModal({ open, onClose, onSaved, teamOptions }: TeamBlockModalProps) {
  const { t } = useTranslation('absences')
  const { create, isLoading } = useMutation<SchedulingBlock>('scheduling_blocks')

  // Mounted fresh each time it opens (the parent renders it only while open), so
  // initial state is the reset — no setState-in-effect needed. Preselect when
  // there's only one team to block.
  const [teamId, setTeamId] = useState(teamOptions.length === 1 ? teamOptions[0].value : '')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  // Synchronous re-entry lock against double-submit (mirrors AbsenceForm).
  const submittingRef = useRef(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submittingRef.current) return
    setError('')
    if (!teamId) { setError(t('blockTeamRequired')); return }
    if (!startDate) { setError(t('startDateRequired')); return }
    if (!endDate) { setError(t('endDateRequired')); return }
    if (endDate < startDate) { setError(t('endAfterStart')); return }

    submittingRef.current = true
    try {
      await create({
        team: Number(teamId),
        start_date: startDate,
        end_date: endDate,
        reason: reason.trim() || null,
      })
      onSaved()
    } catch {
      setError(t('errorSaving'))
    } finally {
      submittingRef.current = false
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('teamBlockTitle')} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('teamBlockHint')}</p>

        <SearchableSelect
          label={t('blockTeam')}
          placeholder={t('common:select')}
          value={teamId}
          onChange={setTeamId}
          options={teamOptions}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DatePicker
            label={t('startDate')}
            value={startDate}
            onChange={(v) => {
              setStartDate(v)
              if (!endDate || endDate < v) setEndDate(v)
            }}
          />
          <DatePicker
            label={t('endDate')}
            value={endDate}
            onChange={setEndDate}
            min={startDate}
          />
        </div>

        <FormInput
          label={t('blockReason')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('blockReasonPlaceholder')}
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="ghost" type="button" onClick={onClose}>
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
