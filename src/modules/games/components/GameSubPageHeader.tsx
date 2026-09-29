import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import IconButton from '@/components/IconButton'

/** Header of a page that belongs to one game (Show IDs, Match roster): back to the game + title. */
export default function GameSubPageHeader({ gameId, title }: { gameId: string; title: string }) {
  const { t } = useTranslation('games')
  return (
    <header className="mb-3 flex items-center gap-2">
      <IconButton asChild label={t('backToGame')} className="shrink-0">
        <Link to={`/games/${gameId}`}><ArrowLeft /></Link>
      </IconButton>
      <h1 className="min-w-0 flex-1 text-lg font-bold leading-tight tracking-tight text-foreground">{title}</h1>
    </header>
  )
}
