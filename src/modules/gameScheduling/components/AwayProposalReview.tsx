import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import BookingStatusBadge from './BookingStatusBadge'
import type { GameSchedulingBooking } from '../../../types'

interface Props {
  booking: GameSchedulingBooking
  /** Count of OTHER pending proposals within `windowDays` of this date (warn). */
  warn: (ymd: string | undefined, windowDays: number) => number
  onConfirm: (bookingId: string, proposalNumber: number, notes?: string) => Promise<void>
}

// Proposals are stored as a naive wall-clock (`${date}T${start_time}`) but come
// back from the DB as "…Z". Slice the parts out instead of tz-converting, so we
// show the exact time the opponent picked (Swiss dd.mm.yyyy HH:MM).
function fmtProposal(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/)
  if (!m) return String(iso)
  const [, y, mo, d, hh, mm] = m
  return hh ? `${d}.${mo}.${y} ${hh}:${mm}` : `${d}.${mo}.${y}`
}

export default function AwayProposalReview({ booking, warn, onConfirm }: Props) {
  const { t } = useTranslation('gameScheduling')
  const [confirming, setConfirming] = useState(false)

  const proposals = [
    { num: 1, datetime: booking.proposed_datetime_1, place: booking.proposed_place_1 },
    { num: 2, datetime: booking.proposed_datetime_2, place: booking.proposed_place_2 },
    { num: 3, datetime: booking.proposed_datetime_3, place: booking.proposed_place_3 },
  ].filter(p => p.datetime)

  const handleConfirm = async (num: number) => {
    setConfirming(true)
    try {
      await onConfirm(booking.id, num)
    } finally {
      setConfirming(false)
    }
  }

  if (booking.status === 'confirmed') {
    const confirmed = proposals.find(p => p.num === booking.confirmed_proposal)
    return (
      <div className="flex items-center gap-2">
        <BookingStatusBadge status="confirmed" />
        {confirmed && (
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {fmtProposal(confirmed.datetime)}
            {confirmed.place ? ` — ${confirmed.place}` : ''}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <BookingStatusBadge status={booking.status} />
      {proposals.map(p => (
        <div
          key={p.num}
          className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
        >
          <div>
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {t('proposalNumber', { number: p.num })}
              {p.num === 1 && <span className="ml-1 text-green-700 dark:text-green-300">· {t('slotReserved')}</span>}
            </span>
            <p className="text-sm text-gray-900 dark:text-gray-100">{fmtProposal(p.datetime)}</p>
            {p.place && <p className="text-xs text-gray-500 dark:text-gray-400">{p.place}</p>}
            {(() => {
              // Choice 1 holds (no warn); choices 2 & 3 warn on nearby contention (±2 / ±1).
              const n = p.num === 1 ? 0 : warn(String(p.datetime || '').slice(0, 10), p.num === 3 ? 1 : 2)
              return n > 0 ? <p className="text-xs text-orange-600 dark:text-orange-400">⚠ {t('slotAlsoProposed', { count: n })}</p> : null
            })()}
          </div>
          {booking.status === 'pending' && (
            <button
              onClick={() => handleConfirm(p.num)}
              disabled={confirming}
              className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {t('confirmProposal')}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
