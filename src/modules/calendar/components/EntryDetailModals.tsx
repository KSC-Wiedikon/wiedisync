import type { CalendarEntry } from '../../../types/calendar'
import type { Game } from '../../../types'
import CalendarEntryModal from '../CalendarEntryModal'
import GameDetailModal from '../../games/components/GameDetailModal'

/**
 * What opens when a calendar entry is clicked: the full game card for a fixture,
 * the generic entry modal (with its RSVP affordances) for everything else.
 *
 * Kept as two independent conditionals rather than an if/else so each modal mounts
 * and unmounts on exactly the same renders as before this was extracted.
 */
export default function EntryDetailModals({
  entry,
  onClose,
  onRefresh,
}: {
  entry: CalendarEntry | null
  onClose: () => void
  onRefresh?: () => void
}) {
  return (
    <>
      {entry?.type === 'game' && (
        <GameDetailModal game={entry.source as Game} onClose={onClose} readOnly />
      )}
      {entry && entry.type !== 'game' && (
        <CalendarEntryModal entry={entry} onClose={onClose} onRefresh={onRefresh} />
      )}
    </>
  )
}
