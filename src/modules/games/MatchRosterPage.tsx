import { useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import GameSubPageHeader from './components/GameSubPageHeader'
import MatchRosterView from './components/MatchRosterView'
import { ScorerSheetView } from '../scorer/components/RosterModal'

/**
 * The match roster on its own page (was a modal inside the game modal). The coach/TR get the
 * editable sheet; the assigned scorer (`?view=scorer`, set by the game modal) the read-only
 * one. The query only picks the layout — the endpoint decides what each may see and edit.
 *
 * ⚠ Imported EAGERLY in App.tsx (see ShowIdsPage): it is opened at the hall.
 */
export default function MatchRosterPage() {
  const { gameId } = useParams<{ gameId: string }>()
  const [params] = useSearchParams()
  const { t } = useTranslation('games')
  if (!gameId) return null
  return (
    <div className="mx-auto w-full max-w-2xl p-3 sm:p-6">
      <GameSubPageHeader gameId={gameId} title={t('pregameTitle')} />
      {params.get('view') === 'scorer'
        ? <ScorerSheetView key={gameId} gameId={gameId} />
        : <MatchRosterView key={gameId} gameId={gameId} />}
    </div>
  )
}
