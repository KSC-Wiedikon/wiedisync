import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import BookingStatusBadge from './BookingStatusBadge'
import { formatDateCompactZurich } from '../../../utils/dateHelpers'
import type { GameSchedulingBooking, GameSchedulingSlot } from '../../../types'

interface Props {
  booking: GameSchedulingBooking
  slotsById: Map<string, GameSchedulingSlot>
  hallsById: Map<string, string | undefined>
  /** Count of OTHER opponents (same KSCW team) that proposed this exact slot id. */
  alsoProposedBy: (slotId: string | number | null | undefined) => number
  onConfirm: (bookingId: string, proposalNumber: number) => Promise<void>
}

const hm = (s?: string) => String(s || '').slice(0, 5)

// Admin review of an opponent's up-to-3 proposed home slots. Slots aren't held,
// so each row warns if the slot is already taken or also proposed by others.
export default function HomeProposalReview({ booking, slotsById, hallsById, alsoProposedBy, onConfirm }: Props) {
  const { t } = useTranslation('gameScheduling')
  const [confirming, setConfirming] = useState(false)

  // Accepts a slot id (proposals) OR an already-expanded slot object (the
  // confirmed booking's `slot` comes back expanded from the admin fetch).
  const slotInfo = (slotOrId: unknown) => {
    if (slotOrId == null) return null
    const s = (typeof slotOrId === 'object' ? slotOrId : slotsById.get(String(slotOrId))) as GameSchedulingSlot | undefined
    if (!s) return null
    const hall = hallsById.get(String(s.hall))
    return {
      label: `${formatDateCompactZurich(s.date)} · ${hm(s.start_time)}–${hm(s.end_time)}${hall ? ` · ${hall}` : ''}`,
      available: s.status === 'available',
      ymd: String(s.date).slice(0, 10),
    }
  }

  const handleConfirm = async (num: number) => {
    setConfirming(true)
    try {
      await onConfirm(booking.id, num)
    } finally {
      setConfirming(false)
    }
  }

  if (booking.status === 'confirmed') {
    const info = slotInfo(booking.slot)
    return (
      <div className="flex items-center gap-2">
        <BookingStatusBadge status="confirmed" />
        {info && <span className="text-sm text-gray-600 dark:text-gray-400">{info.label}</span>}
      </div>
    )
  }

  const proposals = [
    { num: 1, slotId: booking.proposed_slot_1 },
    { num: 2, slotId: booking.proposed_slot_2 },
    { num: 3, slotId: booking.proposed_slot_3 },
  ].filter((p) => p.slotId != null)

  return (
    <div className="space-y-2">
      <BookingStatusBadge status={booking.status} />
      {proposals.map((p) => {
        const info = slotInfo(p.slotId)
        // Choice 1 holds (reserved, exclusive) — no warn. Choices 2 & 3 warn when
        // another club proposed this exact same (unheld) slot.
        const others = p.num === 1 ? 0 : alsoProposedBy(p.slotId)
        return (
          <div
            key={p.num}
            className="flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
          >
            <div className="min-w-0">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {t('proposalNumber', { number: p.num })}
                {p.num === 1 && <span className="ml-1 text-green-700 dark:text-green-300">· {t('slotReserved')}</span>}
              </span>
              <p className="text-sm text-gray-900 dark:text-gray-100">{info ? info.label : t('slotMaybeTaken')}</p>
              {info && !info.available && (
                <p className="text-xs text-red-600 dark:text-red-400">⚠ {t('slotMaybeTaken')}</p>
              )}
              {info && info.available && others > 0 && (
                <p className="text-xs text-orange-600 dark:text-orange-400">⚠ {t('slotAlsoProposed', { count: others })}</p>
              )}
            </div>
            <button
              onClick={() => handleConfirm(p.num)}
              disabled={confirming}
              className="shrink-0 rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {t('confirmProposal')}
            </button>
          </div>
        )
      })}
    </div>
  )
}
