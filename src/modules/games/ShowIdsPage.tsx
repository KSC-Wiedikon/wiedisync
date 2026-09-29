import { useLocation, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import GameSubPageHeader from './components/GameSubPageHeader'
import ShowIdsView from './components/ShowIdsView'

/**
 * Show IDs on its own page (was a modal inside the game modal — a window in a window, and a
 * big ID needed scrolling). The ID gets the page's height; ← back returns to the game.
 *
 * ⚠ Imported EAGERLY in App.tsx, never lazy(): halls have no signal, and a lazy chunk
 * fetched on first open would fail there. Eager, it is in the bundle the app loaded online.
 */
export default function ShowIdsPage() {
  const { gameId } = useParams<{ gameId: string }>()
  const { state } = useLocation()
  const { t } = useTranslation('games')
  if (!gameId) return null
  // Handed over by the game modal; a reload / direct link falls back to the sheet's date+time.
  const kickoffMs = (state as { kickoffMs?: number | null } | null)?.kickoffMs
  return (
    <div className="mx-auto w-full max-w-2xl p-3 sm:p-6">
      <GameSubPageHeader gameId={gameId} title={t('idsTitle')} />
      <ShowIdsView key={gameId} gameId={gameId} kickoffMs={kickoffMs} />
    </div>
  )
}
