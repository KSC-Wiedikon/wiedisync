import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import BookingStatusBadge from './BookingStatusBadge'
import { formatWeekdayZurich, formatDateTimeCompact } from '../../../utils/dateHelpers'
import type { GameSchedulingBooking } from '../../../types'

export interface AwayVmCheck {
  status: 'match' | 'unset' | 'mismatch' | 'no_vm'
  agreed: string
  vm: string | null
}

interface Props {
  booking: GameSchedulingBooking
  onConfirm: (bookingId: string, proposalNumber: number, notes?: string) => Promise<void>
  /** VolleyManager cross-check for the confirmed away game (from away-vm-check). */
  vmCheck?: AwayVmCheck | null
  /** Delete a confirmed away game so it can be rescheduled (confirm lives in the
   *  dashboard handler). Only rendered for confirmed bookings. */
  onDelete?: () => Promise<void>
}

const VM_CHECK_STYLE: Record<string, string> = {
  match: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  unset: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  mismatch: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  no_vm: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
}

// Proposals are stored as a naive wall-clock (`${date}T${start_time}`) but come
// back from the DB as "…Z". Slice the parts out instead of tz-converting, so we
// show the exact time the opponent picked (Swiss dd.mm.yyyy HH:MM).
function fmtProposal(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/)
  if (!m) return String(iso)
  const [, y, mo, d, hh, mm] = m
  const dow = formatWeekdayZurich(`${y}-${mo}-${d}`)
  const date = `${dow} ${d}.${mo}.${y}`
  return hh ? `${date} ${hh}:${mm}` : date
}

export default function AwayProposalReview({ booking, onConfirm, vmCheck, onDelete }: Props) {
  const { t } = useTranslation('gameScheduling')
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!onDelete) return
    setDeleting(true)
    try {
      await onDelete()
    } finally {
      setDeleting(false)
    }
  }

  const proposals = [
    { num: 1, datetime: booking.proposed_datetime_1, place: booking.proposed_place_1 },
    { num: 2, datetime: booking.proposed_datetime_2, place: booking.proposed_place_2 },
    { num: 3, datetime: booking.proposed_datetime_3, place: booking.proposed_place_3 },
  ].filter(p => p.datetime)

  const handleConfirm = async (num: number) => {
    setConfirming(true)
    try {
      await onConfirm(booking.id, num)
    } catch {
      /* error surfaced via toast by the dashboard handler */
    } finally {
      setConfirming(false)
    }
  }

  // Who at the opponent club submitted this proposal (captured at confirm time).
  const proposedBy = (booking.proposed_by_name || booking.proposed_by_email) ? (
    <p className="text-xs text-gray-500 dark:text-gray-400">
      {t('proposedBy')}: {[booking.proposed_by_name, booking.proposed_by_email].filter(Boolean).join(' · ')}
    </p>
  ) : null

  // Who on the KSCW side confirmed / manually entered this game, and when.
  const confirmedBy = (booking.confirmed_by_name || booking.confirmed_by_email || booking.confirmed_at) ? (
    <p className="text-xs text-gray-500 dark:text-gray-400">
      {t('confirmedBy')}: {[booking.confirmed_by_name, booking.confirmed_by_email, booking.confirmed_at ? formatDateTimeCompact(booking.confirmed_at) : null].filter(Boolean).join(' · ')}
    </p>
  ) : null

  if (booking.status === 'confirmed') {
    const confirmed = proposals.find(p => p.num === booking.confirmed_proposal)
    return (
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="flex min-h-7 flex-wrap items-center gap-2">
          <BookingStatusBadge status="confirmed" />
          {confirmed && (
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {fmtProposal(confirmed.datetime)}
              {confirmed.place ? ` — ${confirmed.place}` : ''}
            </span>
          )}
        </div>
        {proposedBy}
        {confirmedBy}
        {vmCheck && (
          <div className="mt-auto flex min-h-7 items-center">
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${VM_CHECK_STYLE[vmCheck.status] || VM_CHECK_STYLE.no_vm}`}
            title={
              vmCheck.status === 'mismatch'
                ? t('awayVmMismatchHint', { vm: vmCheck.vm || '—', agreed: vmCheck.agreed || '—' })
                : vmCheck.status === 'unset'
                  ? t('awayVmUnsetHint')
                  : vmCheck.status === 'match'
                    ? t('awayVmMatchHint')
                    : t('awayVmNoneHint')
            }
          >
            {t(`awayVm_${vmCheck.status}`)}
            {vmCheck.status === 'mismatch' && vmCheck.vm ? `: ${vmCheck.vm}` : ''}
          </span>
          </div>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="min-h-11 self-start text-xs font-medium text-red-600 hover:underline disabled:opacity-50 sm:min-h-0 dark:text-red-400"
          >
            {deleting ? t('deletingGame') : t('deleteGame')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <BookingStatusBadge status={booking.status} />
      {proposedBy}
      {proposals.map(p => (
        <div
          key={p.num}
          className="flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
        >
          <div className="min-w-0">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {t('proposalNumber', { number: p.num })}
              {p.num === 1 && <span className="ml-1 text-green-700 dark:text-green-300">· {t('slotReserved')}</span>}
            </span>
            <p className="text-sm text-gray-900 dark:text-gray-100">{fmtProposal(p.datetime)}</p>
            {p.place && <p className="text-xs text-gray-500 dark:text-gray-400 break-words">{p.place}</p>}
          </div>
          {booking.status === 'pending' && (
            <button
              onClick={() => handleConfirm(p.num)}
              disabled={confirming}
              className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 min-h-11 sm:min-h-0"
            >
              {t('confirmProposal')}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
