import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/components/Modal'
import TeamChip from '../../../components/TeamChip'
import { useAuth } from '../../../hooks/useAuth'
import { useAdminMode } from '../../../hooks/useAdminMode'
import { formatDate, toISODate } from '../../../utils/dateHelpers'
import { logActivity } from '../../../utils/logActivity'
import type { HallSlot, Hall, Team, Training, Game } from '../../../types'
import { createRecord } from '../../../lib/api'

interface Props {
  slot: HallSlot
  halls: Hall[]
  teams: Team[]
  rawSlots: HallSlot[]
  weekDays: Date[]
  onClose: () => void
  onClaimed: () => void
  onEditSlot?: (slot: HallSlot) => void
}

function DetailRow({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div className="flex gap-3 py-1.5">
      <span className="w-28 shrink-0 text-sm font-medium text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-sm text-gray-900 dark:text-gray-100">{value}</span>
    </div>
  )
}

export default function ClaimModal({ slot, halls, teams, rawSlots, weekDays, onClose, onClaimed, onEditSlot }: Props) {
  const { t } = useTranslation('hallenplan')
  const { user, coachTeamIds, hasAdminAccessToTeam } = useAuth()
  const { effectiveIsAdmin: isAdmin } = useAdminMode()
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const meta = slot._virtual
  const isManuallyFree = !meta && !slot.team?.length
  const hallName = halls.find((h) => h.id === slot.hall)?.name ?? ''
  const originalTeams = teams.filter((tm) => slot.team?.includes(tm.id))
  const coachTeams = teams.filter((tm) => coachTeamIds.includes(tm.id) || hasAdminAccessToTeam(tm.id))
  const [selectedTeamId, setSelectedTeamId] = useState(coachTeams[0]?.id || '')

  // Determine freed reason and source
  const isCancelledTraining = meta?.source === 'training' && meta.isCancelled
  const isAwayGame = meta?.source === 'game' && meta.isAway
  const isSpielhalleFreed = !!meta?.isSpielhalleFreed
  const isTemplateFreed = !!meta?.isTemplateFreed
  const freedReason = (isManuallyFree || isSpielhalleFreed || isTemplateFreed)
    ? 'manual_free'
    : isCancelledTraining
      ? 'cancelled_training'
      : 'away_game'
  const freedSourceId = meta?.sourceId ?? ''

  // Determine the date and hall_slot ID
  let dateStr = ''
  if (isManuallyFree || isSpielhalleFreed || isTemplateFreed) {
    // For manually free or Spielhalle freed recurring slots, resolve date from weekDays + day_of_week
    dateStr = weekDays[slot.day_of_week] ? toISODate(weekDays[slot.day_of_week]) : ''
  } else if (isCancelledTraining) {
    dateStr = (meta!.sourceRecord as Training).date.slice(0, 10)
  } else if (isAwayGame) {
    dateStr = (meta!.sourceRecord as Game).date.slice(0, 10)
  }

  // Find the hall_slot template ID
  let hallSlotId = ''
  if (isManuallyFree) {
    hallSlotId = slot.id
  } else if (isTemplateFreed) {
    hallSlotId = meta?.sourceId || slot.id
  } else if (isSpielhalleFreed) {
    // Spielhalle freed: the original slot ID is embedded in the virtual ID (freed-spielhalle-{slotId}-{dayIdx})
    const origId = slot.id.replace(/^freed-spielhalle-/, '').replace(/-\d+$/, '')
    hallSlotId = origId || slot.id
  } else if (isCancelledTraining) {
    hallSlotId = (meta!.sourceRecord as Training).hall_slot
  } else if (isAwayGame) {
    const matchingSlot = rawSlots.find(
      (s) =>
        s.recurring &&
        s.slot_type === 'training' &&
        (s.team?.length ?? 0) === (slot.team?.length ?? 0) && (s.team ?? []).every(t => slot.team?.includes(t)) &&
        s.day_of_week === slot.day_of_week,
    )
    hallSlotId = matchingSlot?.id || ''
  }

  // Check if this is a past date
  const today = new Date().toISOString().slice(0, 10)
  const isPast = dateStr < today

  async function handleClaim() {
    if (!selectedTeamId || !user?.id || !dateStr) return
    setSubmitting(true)
    setError('')

    try {
      const rec = await createRecord<{ id: string }>('slot_claims', {
        hall_slot: hallSlotId,
        hall: slot.hall,
        date: dateStr,
        start_time: slot.start_time,
        end_time: slot.end_time,
        claimed_by_team: selectedTeamId,
        claimed_by_member: user.id,
        freed_reason: freedReason,
        freed_source_id: freedSourceId,
        notes,
        status: 'active',
      })
      logActivity('create', 'slot_claims', rec.id, { hall: slot.hall, date: dateStr, claimed_by_team: selectedTeamId })
      onClaimed()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('409') || msg.includes('already')) {
        setError(t('claimAlreadyTaken'))
      } else {
        setError(msg)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={t('claimSlotTitle')} size="sm">
      <div className="space-y-1">
        <DetailRow label={t('hall')} value={hallName} />
        <DetailRow label={t('date')} value={dateStr ? formatDate(dateStr) : ''} />
        <DetailRow label={t('startTime')} value={slot.start_time} />
        <DetailRow label={t('endTime')} value={slot.end_time} />
        {!isManuallyFree && (
          <DetailRow
            label={t('reason')}
            value={isTemplateFreed ? t('slotFreed') : isSpielhalleFreed ? t('claimReasonSpielhalle') : isCancelledTraining ? t('claimReasonCancelled') : t('claimReasonAway')}
          />
        )}
        {originalTeams.length > 0 && (
          <div className="flex gap-3 py-1.5">
            <span className="w-28 shrink-0 text-sm font-medium text-gray-500 dark:text-gray-400">
              {t('claimOriginalTeam')}
            </span>
            <span className="flex flex-wrap items-center gap-1">
              {originalTeams.map((tm) => (
                <TeamChip key={tm.id} team={tm.name} size="sm" />
              ))}
            </span>
          </div>
        )}
        {slot.notes && (
          <DetailRow label={t('notes')} value={slot.notes} />
        )}
      </div>

      <div className="mt-4 space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('claimTeamLabel')}
          </label>
          <select
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(e.target.value)}
          >
            {coachTeams.map((tm) => (
              <option key={tm.id} value={tm.id}>
                {tm.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('claimNotes')}
          </label>
          <textarea
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('claimNotesPlaceholder')}
          />
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}

      {isPast && (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          {t('claimPastDate')}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        {isAdmin && onEditSlot && isManuallyFree && (
          <button
            className="rounded-lg border border-brand-300 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 dark:border-brand-600 dark:text-brand-300 dark:hover:bg-brand-900/30"
            onClick={() => onEditSlot(slot)}
          >
            {t('editSlot')}
          </button>
        )}
        {!(isAdmin && onEditSlot && isManuallyFree) && <div />}
        <div className="flex gap-2">
          <button
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            onClick={onClose}
          >
            {t('common:cancel')}
          </button>
          <button
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            onClick={handleClaim}
            disabled={submitting || isPast || !selectedTeamId || !hallSlotId}
          >
            {submitting ? '...' : t('claimConfirm')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
