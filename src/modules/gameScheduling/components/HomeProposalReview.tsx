import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { gameStartForDate } from '../utils/slotTime'
import BookingStatusBadge from './BookingStatusBadge'
import VmPushStatus from './VmPushStatus'
import { formatDateCompactZurich, formatWeekdayZurich } from '../../../utils/dateHelpers'
import type { GameSchedulingBooking, GameSchedulingSlot, ProposalHealthEntry } from '../../../types'

interface Props {
  booking: GameSchedulingBooking
  slotsById: Map<string, GameSchedulingSlot>
  hallsById: Map<string, string | undefined>
  /** Count of OTHER opponents (same KSCW team) that proposed this exact slot id. */
  alsoProposedBy: (slotId: string | number | null | undefined) => number
  /** Authoritative live validity for this booking's proposals (Item 3). */
  health?: ProposalHealthEntry
  onConfirm: (bookingId: string, proposalNumber: number) => Promise<void>
  /** Semi-automatic re-request: email the opponent to pick 3 new slots. */
  onRequestNewSlots?: () => Promise<void>
  /** (Re)push the confirmed date/time/hall into VolleyManager. */
  onVmPush?: (bookingId: string, svrzPersistenceId?: string) => Promise<void>
}


// Map a server reason code → a localised label key.
const REASON_KEY: Record<string, string> = {
  taken: 'reasonTaken',
  team_event: 'reasonTeamEvent',
  team_block: 'reasonTeamBlock',
  hall_closed: 'reasonHallClosed',
  too_close: 'reasonTooClose',
  derby: 'reasonDerby',
  doltschi_cap: 'reasonDoltschiCap',
  doltschi_taken: 'reasonDoltschiTaken',
  saturday_cap: 'reasonSaturdayCap',
  cross_team: 'reasonCrossTeam',
}

// Admin review of an opponent's up-to-3 proposed home slots. Slots aren't held,
// so each row shows its LIVE validity (taken / too close / hall closed / …) from
// the proposal-health check; when all proposals are gone the admin can email the
// opponent to pick 3 new ones (semi-automatic — confirmed here in the page).
export default function HomeProposalReview({ booking, slotsById, hallsById, alsoProposedBy, health, onConfirm, onRequestNewSlots, onVmPush }: Props) {
  const { t } = useTranslation('gameScheduling')
  const [confirming, setConfirming] = useState(false)
  const [askRequest, setAskRequest] = useState(false)
  const [requesting, setRequesting] = useState(false)

  // Accepts a slot id (proposals) OR an already-expanded slot object (the
  // confirmed booking's `slot` comes back expanded from the admin fetch).
  const slotInfo = (slotOrId: unknown) => {
    if (slotOrId == null) return null
    const s = (typeof slotOrId === 'object' ? slotOrId : slotsById.get(String(slotOrId))) as GameSchedulingSlot | undefined
    if (!s) return null
    const hall = hallsById.get(String(s.hall))
    // Show only the game start (weekday → 20:00); never the hall-window range.
    return {
      label: `${formatWeekdayZurich(s.date)} ${formatDateCompactZurich(s.date)} · ${gameStartForDate(s.date, s.start_time)}${hall ? ` · ${hall}` : ''}`,
      available: s.status === 'available',
      ymd: String(s.date).slice(0, 10),
    }
  }

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

  const handleRequest = async () => {
    if (!onRequestNewSlots) return
    setRequesting(true)
    try {
      await onRequestNewSlots()
    } finally {
      setRequesting(false)
      setAskRequest(false)
    }
  }

  if (booking.status === 'confirmed') {
    const info = slotInfo(booking.slot)
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex min-h-7 items-center gap-2">
          <BookingStatusBadge status="confirmed" />
          {info && <span className="text-sm text-gray-600 dark:text-gray-400">{info.label}</span>}
        </div>
        {proposedBy}
        {onVmPush && (
          <div className="flex min-h-7 items-center">
            <VmPushStatus booking={booking} onPush={onVmPush} />
          </div>
        )}
      </div>
    )
  }

  // Per-proposal live validity from the health check (falls back to slot.status).
  const healthByNum = new Map((health?.proposals || []).map((p) => [p.num, p]))

  const proposals = [
    { num: 1, slotId: booking.proposed_slot_1 },
    { num: 2, slotId: booking.proposed_slot_2 },
    { num: 3, slotId: booking.proposed_slot_3 },
  ].filter((p) => p.slotId != null)

  const allDead = health?.all_dead ?? false

  return (
    <div className="space-y-2">
      <BookingStatusBadge status={booking.status} />
      {proposedBy}

      {allDead && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs dark:border-red-800 dark:bg-red-900/30">
          <p className="font-medium text-red-700 dark:text-red-300">{t('allProposalsDead')}</p>
          {onRequestNewSlots && (
            askRequest ? (
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-red-700 dark:text-red-300">{t('requestNewSlotsConfirm')}</span>
                <button
                  onClick={handleRequest}
                  disabled={requesting}
                  className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {requesting ? t('requestingNewSlots') : t('requestNewSlotsYes')}
                </button>
                <button
                  onClick={() => setAskRequest(false)}
                  disabled={requesting}
                  className="rounded px-2 py-1 text-red-700 hover:bg-red-100 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-900/50"
                >
                  {t('cancel')}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAskRequest(true)}
                className="mt-1.5 rounded bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700"
              >
                {t('requestNewSlots')}
              </button>
            )
          )}
        </div>
      )}

      {proposals.map((p) => {
        const info = slotInfo(p.slotId)
        const hp = healthByNum.get(p.num)
        // Authoritative validity if the health check ran; else fall back to the
        // raw slot status (available?).
        const valid = hp ? hp.valid : info?.available ?? true
        const reasonKey = hp?.reason ? (REASON_KEY[hp.reason] || 'slotMaybeTaken') : 'slotMaybeTaken'
        // Choice 1 holds (reserved, exclusive) — no contention warn. Choices 2 & 3
        // warn when another club proposed this exact same (unheld) slot.
        const others = p.num === 1 ? 0 : alsoProposedBy(p.slotId)
        return (
          <div
            key={p.num}
            className="flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
          >
            <div className="min-w-0">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {t('proposalNumber', { number: p.num })}
                {p.num === 1 && valid && <span className="ml-1 text-green-700 dark:text-green-300">· {t('slotReserved')}</span>}
              </span>
              <p className={`text-sm ${valid ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 line-through dark:text-gray-500'}`}>
                {info ? info.label : t('slotMaybeTaken')}
              </p>
              {!valid && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  ⚠ {t(reasonKey)}{hp?.reason === 'cross_team' && hp.teams?.length ? `: ${hp.teams.join(', ')}` : ''}
                </p>
              )}
              {valid && others > 0 && (
                <p className="text-xs text-orange-600 dark:text-orange-400">⚠ {t('slotAlsoProposed', { count: others })}</p>
              )}
              {p.num === 3 && (hp?.absences ?? 0) > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">{t('absentCount', { count: hp?.absences ?? 0 })}</p>
              )}
            </div>
            <button
              onClick={() => handleConfirm(p.num)}
              disabled={confirming || !valid}
              title={!valid ? t(reasonKey) : undefined}
              className="shrink-0 rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('confirmProposal')}
            </button>
          </div>
        )
      })}
    </div>
  )
}
