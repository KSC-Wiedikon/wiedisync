import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check, Home as HomeIcon, Pencil, Plane, Trash2, Layers } from 'lucide-react'
import { useCollection } from '../../lib/query'
import { useMutation } from '../../hooks/useMutation'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../../components/ui/sheet'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import type { Game, Hall, Team } from '../../types'
import { asObj } from '../../utils/relations'
import { formatDate, parseDate } from '../../utils/dateUtils'
import { formatTime } from '../../utils/dateHelpers'
import { opponentName } from './gameChipUtils'
import { formatSvrzClipboard } from './utils/svrzClipboard'

interface GameDetailDrawerProps {
  game: Game | null
  onClose: () => void
  /** When set, the "Edit" button appears for manual games in the caller's scope. */
  onEdit?: (game: Game) => void
  /** When set, the "Delete" button appears for manual games in the caller's scope. */
  onDelete?: (game: Game) => Promise<void> | void
  /** True if the current user can edit this specific game's manual fields. */
  canEdit?: boolean
}

function sourceBadge(source: Game['source']): { key: string; variant: 'secondary' | 'outline' } {
  switch (source) {
    case 'swiss_volley':
      return { key: 'spielplanung:drawer.sourceSVRZ', variant: 'secondary' }
    case 'basketplan':
      return { key: 'spielplanung:drawer.sourceBasketplan', variant: 'secondary' }
    default:
      return { key: 'spielplanung:drawer.sourceManual', variant: 'outline' }
  }
}

function hallDisplay(game: Game, halls: Hall[]): string {
  const hall = asObj<{ name: string }>(game.hall)
  const primaryName = hall?.name ?? halls.find((h) => String(h.id) === String(game.hall))?.name ?? ''
  if (game.type === 'away') {
    return game.away_hall_json?.name ?? primaryName ?? '—'
  }
  if (!primaryName) return '—'

  const extraIds = (game.additional_halls ?? []).map((v) => {
    if (v == null) return ''
    if (typeof v === 'object' && 'id' in (v as Record<string, unknown>)) {
      return String((v as { id: unknown }).id)
    }
    return String(v)
  })
  const extraNames = extraIds
    .map((id) => halls.find((h) => String(h.id) === id)?.name)
    .filter((n): n is string => !!n)
  if (extraNames.length > 0) return [primaryName, ...extraNames].join(' + ')
  return primaryName
}

export default function GameDetailDrawer({
  game,
  onClose,
  onEdit,
  onDelete,
  canEdit,
}: GameDetailDrawerProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [togglingCombo, setTogglingCombo] = useState(false)

  const { data: halls } = useCollection<Hall>('halls', {
    all: true,
    fields: ['id', 'name'],
    staleTime: 120_000,
  })
  const { update: updateGame } = useMutation('games')

  if (!game) return null

  const team = asObj<Team>(game.kscw_team)
  const teamName = team?.name ?? '—'
  const isHome = game.type === 'home'
  const opponent = opponentName(game)
  const date = formatDate(parseDate(game.date), 'EEE, d MMM yyyy')
  const time = game.time ? formatTime(game.time) : ''
  const badge = sourceBadge(game.source)
  const isManual = game.source === 'manual'
  const showEdit = isManual && canEdit && onEdit
  const showDelete = isManual && canEdit && onDelete

  // Combo A+B action: visible only for basketball home games the caller can edit.
  const isBasketball = team?.sport === 'basketball'
  const hasCombo = Array.isArray(game.additional_halls) && game.additional_halls.length > 0
  const kwiA = (halls ?? []).find((h) => h.name === 'KWI A')
  const kwiB = (halls ?? []).find((h) => h.name === 'KWI B')
  const showComboToggle = !!canEdit && isBasketball && isHome && !!kwiA && !!kwiB

  async function handleMarkCombo() {
    if (!game || !kwiA || !kwiB) return
    setTogglingCombo(true)
    try {
      // If the primary hall is already KWI A or B, keep it; else switch to KWI A.
      const primaryIsAorB =
        String(game.hall) === String(kwiA.id) || String(game.hall) === String(kwiB.id)
      const newPrimary = primaryIsAorB ? game.hall : String(kwiA.id)
      const newExtra = String(game.hall) === String(kwiB.id) ? [String(kwiA.id)] : [String(kwiB.id)]
      await updateGame(game.id, { hall: newPrimary, additional_halls: newExtra })
    } finally {
      setTogglingCombo(false)
    }
  }

  async function handleUnmarkCombo() {
    if (!game) return
    setTogglingCombo(true)
    try {
      await updateGame(game.id, { additional_halls: null })
    } finally {
      setTogglingCombo(false)
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(formatSvrzClipboard(game!))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // no-op — clipboard may be unavailable
    }
  }

  async function handleDeleteConfirm() {
    if (!onDelete || !game) return
    setDeleting(true)
    try {
      await onDelete(game)
      setConfirmingDelete(false)
      onClose()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Sheet open={!!game} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span>{teamName}</span>
            {isHome ? (
              <HomeIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
            ) : (
              <Plane className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden />
            )}
            <span className="text-muted-foreground font-normal">{t('spielplanung:drawer.vs', 'vs')}</span>
            <span className="font-semibold">{opponent}</span>
          </SheetTitle>
          <SheetDescription>{date}{time ? ` · ${time}` : ''}</SheetDescription>
          <div className="pt-1">
            <Badge variant={badge.variant}>{t(badge.key, badge.key.split('.').pop()!)}</Badge>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-4 px-4">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t('spielplanung:drawer.hall', 'Hall')}</dt>
            <dd>{hallDisplay(game, halls ?? [])}</dd>
            <dt className="text-muted-foreground">{t('spielplanung:drawer.league', 'League')}</dt>
            <dd>{game.league || '—'}</dd>
            <dt className="text-muted-foreground">{t('spielplanung:drawer.round', 'Round')}</dt>
            <dd>{game.round || '—'}</dd>
            {game.source === 'manual' && (
              <>
                <dt className="text-muted-foreground">{t('spielplanung:drawer.svrzPush', 'SVRZ push')}</dt>
                <dd className="text-amber-600 dark:text-amber-400">
                  {t('spielplanung:drawer.notInVolleymanager', 'Not yet in Volleymanager')}
                </dd>
              </>
            )}
          </dl>
        </div>

        {!isManual && (
          <p className="mt-4 px-4 text-xs text-muted-foreground italic">
            {t('spielplanung:drawer.svrzReadOnlyHint', 'Official details come from SVRZ. Edit those on Volleymanager.')}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-2 px-4">
          {showEdit && (
            <Button
              type="button"
              onClick={() => { onEdit!(game!); onClose() }}
              variant="secondary"
              className="font-semibold text-brand-900 hover:bg-gold-500"
            >
              <Pencil className="h-4 w-4" aria-hidden />
              {t('spielplanung:drawer.edit', 'Edit')}
            </Button>
          )}
          {showComboToggle && (
            <Button
              type="button"
              onClick={hasCombo ? handleUnmarkCombo : handleMarkCombo}
              disabled={togglingCombo}
              variant="outline"
            >
              <Layers className="h-4 w-4" aria-hidden />
              {hasCombo
                ? t('spielplanung:drawer.unmarkCombo', 'Back to single hall')
                : t('spielplanung:drawer.markAsComboAB', 'Mark as KWI A + B')}
            </Button>
          )}
          <Button
            type="button"
            onClick={handleCopy}
            variant="outline"
          >
            {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
            {copied
              ? t('spielplanung:drawer.copied', 'Copied!')
              : t('spielplanung:drawer.copySvrz', 'Copy SVRZ details')}
          </Button>
          {showDelete && (
            <Button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              variant="outline"
              className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-600 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              {t('spielplanung:drawer.delete', 'Delete')}
            </Button>
          )}
        </div>
      </SheetContent>

      <AlertDialog open={confirmingDelete} onOpenChange={(open) => !deleting && setConfirmingDelete(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('spielplanung:drawer.deleteConfirmTitle', 'Delete manual game?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('spielplanung:drawer.deleteConfirmBody', 'This cannot be undone.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t('spielplanung:drawer.cancel', 'Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleting}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {t('spielplanung:drawer.confirmDelete', 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  )
}
