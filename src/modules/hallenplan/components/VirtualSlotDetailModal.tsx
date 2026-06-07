import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import Modal from '@/components/Modal'
import TeamChip from '../../../components/TeamChip'
import type { HallSlot, Hall, Team, Game, Training, HallEvent } from '../../../types'
import { formatTime } from '../../../utils/dateHelpers'

interface Props {
  slot: HallSlot
  halls: Hall[]
  teams: Team[]
  isAdmin?: boolean
  onClose: () => void
  onEditSlot?: (training: Training) => void
}

function DetailRow({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div className="flex gap-3 py-1.5">
      <span className="w-24 shrink-0 text-sm font-medium text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-sm text-gray-900 dark:text-gray-100">{value}</span>
    </div>
  )
}

export default function VirtualSlotDetailModal({ slot, halls, teams, isAdmin, onClose, onEditSlot }: Props) {
  const { t } = useTranslation('hallenplan')
  const navigate = useNavigate()
  const meta = slot._virtual!

  const hallName = halls.find((h) => h.id === slot.hall)?.name ?? ''
  const teamObjs = teams.filter((tm) => slot.team?.includes(tm.id))
  const teamName = teamObjs.map((tm) => tm.name).join(', ')

  function renderGame() {
    const game = meta.sourceRecord as Game
    const statusLabels: Record<string, string> = {
      scheduled: t('statusScheduled'),
      live: t('statusLive'),
      completed: t('statusCompleted'),
      postponed: t('statusPostponed'),
    }

    return (
      <div className="space-y-1">
        <DetailRow label={t('hall')} value={hallName} />
        {teamObjs.length > 0 && (
          <div className="flex gap-3 py-1.5">
            <span className="w-24 shrink-0 text-sm font-medium text-gray-500 dark:text-gray-400">{t('team')}</span>
            <span className="flex flex-wrap items-center gap-1">
              {teamObjs.map((tm) => (
                <TeamChip key={tm.id} team={tm.name} size="sm" />
              ))}
            </span>
          </div>
        )}
        <DetailRow label={t('league')} value={game.league || ''} />
        <DetailRow label={t('start')} value={game.time ? formatTime(game.time) : ''} />
        <DetailRow label={t('slot')} value={`${slot.start_time?.slice(0, 5)}–${slot.end_time?.slice(0, 5)}`} />
        {game.status && (
          <DetailRow label={t('common:status')} value={statusLabels[game.status] || game.status} />
        )}
        {game.status === 'completed' && (
          <DetailRow label={t('result')} value={`${game.home_score}:${game.away_score}`} />
        )}
        {meta.isAway && game.home_team && (
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            {t('typeAway')} — {game.home_team} vs {game.away_team}
          </div>
        )}
      </div>
    )
  }

  function renderTraining() {
    const training = meta.sourceRecord as Training

    return (
      <div className="space-y-1">
        <DetailRow label={t('hall')} value={hallName} />
        {teamObjs.length > 0 && (
          <div className="flex gap-3 py-1.5">
            <span className="w-24 shrink-0 text-sm font-medium text-gray-500 dark:text-gray-400">{t('team')}</span>
            <span className="flex flex-wrap items-center gap-1">
              {teamObjs.map((tm) => (
                <TeamChip key={tm.id} team={tm.name} size="sm" />
              ))}
            </span>
          </div>
        )}
        <DetailRow label={t('startTime')} value={slot.start_time?.slice(0, 5) || ''} />
        <DetailRow label={t('endTime')} value={slot.end_time?.slice(0, 5) || ''} />
        <DetailRow label={t('notes')} value={training.notes} />
        {meta.isCancelled && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-300">
            {t('cancelled')}{training.cancel_reason ? `: ${training.cancel_reason}` : ''}
          </div>
        )}
      </div>
    )
  }

  function renderHallEvent() {
    const event = meta.sourceRecord as HallEvent

    return (
      <div className="space-y-1">
        <DetailRow label={t('hall')} value={hallName} />
        <DetailRow label={t('label')} value={event.title} />
        <DetailRow label={t('startTime')} value={event.start_time?.slice(0, 5) || t('allDay')} />
        <DetailRow label={t('endTime')} value={event.end_time?.slice(0, 5) || ''} />
        <DetailRow label={t('location')} value={event.location} />
      </div>
    )
  }

  const titles: Record<string, string> = {
    game: meta.isAway ? t('typeAway') : t('typeGame'),
    training: t('typeTraining'),
    hall_event: t('typeEvent'),
  }

  const gameRecord = meta.source === 'game' ? meta.sourceRecord as Game : null
  const hasGameNames = gameRecord?.home_team && gameRecord?.away_team

  const title = meta.isSpielhalleFreed
    ? 'Spielhalle'
    : meta.source === 'game'
      ? hasGameNames
        ? `${titles.game}: ${gameRecord!.home_team} vs ${gameRecord!.away_team}`
        : `${titles.game}${teamName ? ` — ${teamName}` : ''}`
      : meta.source === 'training'
        ? `${titles.training}${teamName ? ` — ${teamName}` : ''}`
        : (meta.sourceRecord as HallEvent).title

  return (
    <Modal open onClose={onClose} title={title} size="sm">
      {meta.isSpielhalleFreed ? (
        <div className="space-y-1">
          <DetailRow label={t('hall')} value={hallName} />
          <DetailRow label={t('slot')} value={`${slot.start_time?.slice(0, 5)}–${slot.end_time?.slice(0, 5)}`} />
        </div>
      ) : (
        <>
          {meta.source === 'game' && renderGame()}
          {meta.source === 'training' && renderTraining()}
          {meta.source === 'hall_event' && renderHallEvent()}
        </>
      )}

      <div className="mt-4 border-t border-gray-200 pt-3 dark:border-gray-700">
        {isAdmin && (meta.source === 'training' || meta.source === 'game') && (
          <div className="mb-3 flex justify-end gap-2">
            {meta.source === 'training' && onEditSlot && (
              <button
                className="rounded-lg border border-brand-300 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 dark:border-brand-600 dark:text-brand-300 dark:hover:bg-brand-900/30"
                onClick={() => onEditSlot(meta.sourceRecord as Training)}
              >
                {t('editSlot')}
              </button>
            )}
            <button
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              onClick={() => {
                onClose()
                navigate(meta.source === 'training' ? '/trainings' : '/games')
              }}
            >
              {meta.source === 'training' ? t('goToTrainings') : t('goToGames')}
            </button>
          </div>
        )}
        <div className="text-center">
          <span className="text-xs text-gray-400 dark:text-gray-500">{t('autoGenerated')}</span>
        </div>
      </div>
    </Modal>
  )
}
