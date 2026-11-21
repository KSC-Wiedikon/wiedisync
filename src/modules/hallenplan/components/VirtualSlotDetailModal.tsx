import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import TeamChip from '../../../components/TeamChip'
import type { HallSlot, Hall, Team, Game, Training, HallEvent, Event } from '../../../types'
import { formatTime, toISODate } from '../../../utils/dateHelpers'
import { describeExtraHalls } from '../../../utils/extraHalls'
import SlotContactForm from './SlotContactForm'

interface Props {
  /** A virtual slot (game / training / booking), or a plain hall slot a team holds. */
  slot: HallSlot
  halls: Hall[]
  teams: Team[]
  /** The slot's day in the shown week — what "Write to the coaches" refers to. */
  date?: Date
  isAdmin?: boolean
  onClose: () => void
  onEditSlot?: (training: Training) => void
}

function DetailRow({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div className="flex gap-3 py-1.5">
      <span className="w-24 shrink-0 text-sm font-medium text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  )
}

export default function VirtualSlotDetailModal({ slot, halls, teams, date, isAdmin, onClose, onEditSlot }: Props) {
  const { t } = useTranslation('hallenplan')
  const navigate = useNavigate()
  const meta = slot._virtual

  const hallName = [
    halls.find((h) => h.id === slot.hall)?.name ?? '',
    ...(meta?.source === 'training'
      ? describeExtraHalls((meta.sourceRecord as Training).extra_halls, halls, t)
      : describeExtraHalls(slot.extra_halls, halls, t)),
  ].filter(Boolean).join(' + ')
  const teamObjs = teams.filter((tm) => slot.team?.some((id) => String(id) === String(tm.id)))
  const teamName = teamObjs.map((tm) => tm.name).join(', ')

  // Who to write to: a slot a team actually holds this day. Not a freed slot (the
  // team gave it up), not an away game's freed hall, not a booking.
  const contactable = !!date && teamObjs.length > 0
    && !meta?.isFreed && !meta?.isSpielhalleFreed && !meta?.isAway && !meta?.isCancelled
    && (!meta || meta.source === 'training' || meta.source === 'game')
  const contactForm = contactable ? (
    <SlotContactForm
      teams={teamObjs}
      hallId={slot.hall || null}
      date={toISODate(date!)}
      startTime={slot.start_time?.slice(0, 5) ?? ''}
      endTime={slot.end_time?.slice(0, 5) ?? ''}
      slotType={slot.slot_type}
    />
  ) : null

  const slotTypeLabels: Record<string, string> = {
    training: t('typeTraining'),
    game: t('typeGame'),
    event: t('typeEvent'),
    away: t('typeAway'),
    other: t('typeOther'),
  }

  // A plain hall slot (no game / training behind it this week, e.g. beyond the
  // generated trainings): what it is, who holds it, and the contact form.
  if (!meta) {
    const kind = slotTypeLabels[slot.slot_type] ?? t('typeOther')
    const realTitle = teamName ? `${kind} — ${teamName}` : (slot.label || kind)
    return (
      <Modal open onClose={onClose} title={realTitle} size="sm">
        <div className="space-y-1">
          <DetailRow label={t('hall')} value={hallName} />
          {teamObjs.length > 0 && (
            <div className="flex gap-3 py-1.5">
              <span className="w-24 shrink-0 text-sm font-medium text-muted-foreground">{t('team')}</span>
              <span className="flex flex-wrap items-center gap-1">
                {teamObjs.map((tm) => (
                  <TeamChip key={tm.id} team={tm.name} size="sm" />
                ))}
              </span>
            </div>
          )}
          <DetailRow label={t('startTime')} value={slot.start_time?.slice(0, 5) || ''} />
          <DetailRow label={t('endTime')} value={slot.end_time?.slice(0, 5) || ''} />
          <DetailRow label={t('label')} value={teamName ? (slot.label || '') : ''} />
        </div>
        {contactForm}
      </Modal>
    )
  }

  // From here on the slot is a virtual one.
  const vm = meta

  function renderGame() {
    const game = vm.sourceRecord as Game
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
            <span className="w-24 shrink-0 text-sm font-medium text-muted-foreground">{t('team')}</span>
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
        {vm.isAway && game.home_team && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
            {t('typeAway')} — {game.home_team} vs {game.away_team}
          </div>
        )}
      </div>
    )
  }

  function renderTraining() {
    const training = vm.sourceRecord as Training

    return (
      <div className="space-y-1">
        <DetailRow label={t('hall')} value={hallName} />
        {teamObjs.length > 0 && (
          <div className="flex gap-3 py-1.5">
            <span className="w-24 shrink-0 text-sm font-medium text-muted-foreground">{t('team')}</span>
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
        {vm.isCancelled && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {t('cancelled')}{training.cancel_reason ? `: ${training.cancel_reason}` : ''}
          </div>
        )}
      </div>
    )
  }

  function renderHallEvent() {
    const event = vm.sourceRecord as HallEvent

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

  // A club event that books halls (migration 409). The slot carries this day's
  // window; the event may span several days.
  function renderClubEvent() {
    const event = vm.sourceRecord as Event
    return (
      <div className="space-y-1">
        <DetailRow label={t('hall')} value={hallName} />
        <DetailRow label={t('label')} value={event.title} />
        <DetailRow label={t('startTime')} value={event.all_day ? t('allDay') : slot.start_time?.slice(0, 5)} />
        <DetailRow label={t('endTime')} value={event.all_day ? '' : slot.end_time?.slice(0, 5)} />
        <DetailRow label={t('location')} value={event.location} />
        <p className="pt-2 text-xs text-muted-foreground">{t('clubEventBookingHint')}</p>
      </div>
    )
  }

  const titles: Record<string, string> = {
    game: vm.isAway ? t('typeAway') : t('typeGame'),
    training: t('typeTraining'),
    hall_event: t('typeEvent'),
    club_event: t('typeEvent'),
  }

  const gameRecord = vm.source === 'game' ? vm.sourceRecord as Game : null
  const hasGameNames = gameRecord?.home_team && gameRecord?.away_team

  const title = vm.isSpielhalleFreed
    ? 'Spielhalle'
    : vm.source === 'game'
      ? hasGameNames
        ? `${titles.game}: ${gameRecord!.home_team} vs ${gameRecord!.away_team}`
        : `${titles.game}${teamName ? ` — ${teamName}` : ''}`
      : vm.source === 'training'
        ? `${titles.training}${teamName ? ` — ${teamName}` : ''}`
        : (vm.sourceRecord as HallEvent).title

  return (
    <Modal open onClose={onClose} title={title} size="sm">
      {vm.isSpielhalleFreed ? (
        <div className="space-y-1">
          <DetailRow label={t('hall')} value={hallName} />
          <DetailRow label={t('slot')} value={`${slot.start_time?.slice(0, 5)}–${slot.end_time?.slice(0, 5)}`} />
        </div>
      ) : (
        <>
          {vm.source === 'game' && renderGame()}
          {vm.source === 'training' && renderTraining()}
          {vm.source === 'hall_event' && renderHallEvent()}
          {vm.source === 'club_event' && renderClubEvent()}
        </>
      )}

      {contactForm}

      <div className="mt-4 border-t border-border pt-3">
        {isAdmin && vm.source === 'club_event' && (
          <div className="mb-3 flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => { onClose(); navigate('/events') }}>
              {t('goToEvents')}
            </Button>
          </div>
        )}
        {isAdmin && (vm.source === 'training' || vm.source === 'game') && (
          <div className="mb-3 flex flex-wrap justify-end gap-2">
            {vm.source === 'training' && onEditSlot && (
              <Button variant="outline" onClick={() => onEditSlot(vm.sourceRecord as Training)}>
                {t('editSlot')}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                onClose()
                navigate(vm.source === 'training' ? '/trainings' : '/games')
              }}
            >
              {vm.source === 'training' ? t('goToTrainings') : t('goToGames')}
            </Button>
          </div>
        )}
        <div className="text-center">
          <span className="text-xs text-muted-foreground/80">{t('autoGenerated')}</span>
        </div>
      </div>
    </Modal>
  )
}
