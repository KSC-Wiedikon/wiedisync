import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, ExternalLink, MessageSquare, Pencil, Users } from 'lucide-react'
import StatusBadge from '../../components/StatusBadge'
import TeamChip from '../../components/TeamChip'
import RichText from '../../components/RichText'
import SessionParticipationSheet from '../../components/SessionParticipationSheet'
import type { RsvpStatus } from '../../utils/participationColors'
import ParticipationWarningBadge from '../../components/ParticipationWarningBadge'
import { getEventWarnings } from '../../utils/participationWarnings'
import { useAuth } from '../../hooks/useAuth'
import { useCollection } from '../../lib/query'
import { useMutation } from '../../hooks/useMutation'
import { useRealtime } from '../../hooks/useRealtime'
import { useMyCoveringAbsence } from '../../hooks/useMyCoveringAbsence'
import { useAbsenceNoteText } from '../../hooks/useAbsenceNoteText'
import { formatDate, formatTime, formatWeekday, formatDayMonthZurich, getDeadlineDate } from '../../utils/dateHelpers'
import { asTeams, teamId, isHtml, isSameDay, isGuestExcludedFromEvent } from './eventHelpers'
import type { Event, EventSession, Participation } from '../../types'
import CancelActivityButton from '../../components/CancelActivityButton'
import CarpoolChip from '../carpool/CarpoolChip'
import RsvpAnswerButtons from '../../components/RsvpAnswerButtons'
import TruncatedText from '../../components/TruncatedText'
import { DateRail, RowStripe, RowChip } from '../../components/ActivityRow'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { rsvpTone } from '../../utils/rsvpTone'

interface EventCardProps {
  event: Event
  onClick?: () => void
  /** Delete lives in the edit dialog (EventForm `onDelete`), not on the card. */
  onEdit?: (event: Event) => void
  onOpenRoster?: (event: Event) => void
  /** Pre-fetched participations for this event (from batch query) */
  participations?: Participation[]
  /** Pre-fetched current user's participation (from batch query) */
  myParticipation?: Participation
  /** Called after a participation save — parent can refetch */
  onParticipationSaved?: () => void
}

/** Status shown on the card's state stripe (the former left-edge banner).
 *  `mixed` is not a participation status — it's what a per-day event looks
 *  like when the member answered its sessions differently (some yes, some no),
 *  which has no single answer colour (see rsvpTone). */
type BannerStatus = Participation['status'] | 'mixed'

export default function EventCard({ event, onClick, onEdit, onOpenRoster, participations, myParticipation, onParticipationSaved }: EventCardProps) {
  const { t } = useTranslation('events')
  const { user, canParticipateIn, memberTeamIds, getGuestLevel } = useAuth()
  const teams = asTeams(event.teams)
  // Migration 324: `invite_guests: false` drops the invited teams' guest players
  // from the audience — they still SEE the event (the read policy is unchanged),
  // they just can't answer it. Same shape as a training's excluded guest tier.
  const guestExcluded = isGuestExcludedFromEvent(event, { memberId: user?.id, memberTeamIds, getGuestLevel })
  // Club-wide events (no teams): all logged-in users can RSVP
  // Team events: only members of those teams can RSVP
  const canRSVP = user && !guestExcluded && (
    !event.teams?.length || event.teams.some((tid) => canParticipateIn(teamId(tid)))
  )
  const warnings = getEventWarnings(participations ?? [], event.min_participants)

  // The banner used to read `myParticipation.status` — the batch-fetched SERVER
  // row — while the Yes/Maybe/No buttons right below it read their own optimistic
  // state. So the button flipped on click and the coloured strip only caught up a
  // refetch later (and for a brand-new RSVP appeared out of nowhere). The RSVP
  // control now reports the status it is actually displaying and the banner
  // follows it, so both change in the same frame.
  //
  // It also fixes per-day events: `myParticipation` is whichever of the member's
  // per-session rows the batch map happened to keep last, so a member who
  // confirmed day 1 and declined day 2 got an arbitrary colour. The session
  // control reports its aggregate instead ('mixed' when the days disagree).
  const rsvpControlsVisible = !!canRSVP && !event.cancelled
  const [liveStatus, setLiveStatus] = useState<BannerStatus | null | undefined>(undefined)
  const myStatus: BannerStatus | null = rsvpControlsVisible && liveStatus !== undefined
    ? liveStatus
    : (myParticipation?.status ?? null)

  const cancelled = !!event.cancelled
  const sameDay = isSameDay(event.start_date, event.end_date)
  // Rail extra line: the end — "–18:00" on a timed one-day event, "– 14.06"
  // (+ time) on a multi-day one. Wraps inside the rail, never truncates.
  const railEnd = !sameDay
    ? `– ${formatDayMonthZurich(event.end_date)}${!event.all_day ? ` ${formatTime(event.end_date)}` : ''}`
    : !event.all_day && event.end_date ? `–${formatTime(event.end_date)}` : undefined
  const targeted = (event.invited_roles ?? []).length > 0 || (event.invited_members ?? []).length > 0
  // The answer buttons carry the totals, so the counters row is down to the
  // warnings badge (the counters-only view was never shown to non-answerers here).
  const showCounters = warnings.length > 0 && (rsvpControlsVisible || !canRSVP)

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-2xl border border-hairline bg-card shadow-card',
        onClick && 'cursor-pointer transition-shadow hover:shadow-card-lg',
        cancelled && 'opacity-60',
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      // Only the card itself reacts to Enter/Space — a keystroke bubbling up
      // from the note input or an RSVP pill must not open the detail modal
      // (and Space must still type a space in the note).
      onKeyDown={onClick ? (e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
    >
      <div className="flex flex-1 items-stretch gap-2.5 p-3 sm:gap-3">
        {/* Rail neutral unless cancelled; my RSVP colours the stripe only (a
            red date for "I declined" would read as "event cancelled"). */}
        <DateRail
          eyebrow={formatWeekday(event.start_date)}
          main={<span title={formatDate(event.start_date)}>{formatDayMonthZurich(event.start_date)}</span>}
          sub={event.all_day ? t('allDay') : formatTime(event.start_date)}
          extra={railEnd}
          tone={cancelled ? 'red' : 'gray'}
        />
        <RowStripe tone={cancelled ? 'red' : user ? rsvpTone(myStatus) : 'gray'} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            {/* Primary text WRAPS — a truncated title hid the part that tells two events apart. */}
            <h2 className="min-w-0 flex-1 break-words text-sm font-semibold leading-snug text-foreground sm:text-[15px]">{event.title}</h2>
            {cancelled && (
              <span className="mt-0.5 flex shrink-0 items-center">
                <RowChip tone="red">{t('cancelled')}</RowChip>
              </span>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-stretch gap-1.5">
            <StatusBadge status={event.event_type} />
            {teams.map((team) => (
              <TeamChip key={team.id} team={team.name} size="sm" />
            ))}
            {targeted && <RowChip tone="violet">{t('targetedEvent', { ns: 'invitations' })}</RowChip>}
          </div>

          {event.location && (
            <p className="mt-1.5 flex min-w-0 text-sm text-muted-foreground">
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 items-center gap-1 hover:text-primary hover:underline dark:hover:text-brand-300"
                onClick={(e) => e.stopPropagation()}
              >
                <TruncatedText text={event.location} />
                <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
              </a>
            </p>
          )}
          {event.description && (
            isHtml(event.description)
              ? <RichText html={event.description} className="mt-1 text-sm text-muted-foreground" />
              : <p className="mt-1 break-words text-sm text-muted-foreground">{event.description}</p>
          )}
          {cancelled && event.cancel_reason && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{event.cancel_reason}</p>
          )}

          {/* RSVP. The wrapper swallows clicks: the per-day sheet is a portal,
              and React bubbles portal clicks through the tree to the card. */}
          {rsvpControlsVisible && (
            <div className="mt-2.5" onClick={(e) => e.stopPropagation()}>
              {event.participation_mode && event.participation_mode !== 'whole' ? (
                <EventCardSessionParticipation
                  event={event}
                  participations={participations}
                  onSaved={onParticipationSaved}
                  onStatusChange={setLiveStatus}
                />
              ) : (
                <EventCardParticipation
                  event={event}
                  existingParticipation={myParticipation}
                  participations={participations}
                  onSaved={onParticipationSaved}
                  onStatusChange={setLiveStatus}
                />
              )}
            </div>
          )}
          {guestExcluded && !cancelled && (
            <p className="mt-2 text-xs italic text-muted-foreground">{t('guestNotInvited')}</p>
          )}

          {/* Counters in the body, under the RSVP. */}
          {showCounters && (
            <div className="mt-2 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <ParticipationWarningBadge warnings={warnings} namespace="participation" />
            </div>
          )}
        </div>
      </div>

      {/* ONE tools line at every width (replaces the sm+ header cluster AND the
          phone-only footer that duplicated it). Swallows clicks so a tool never
          also opens the detail modal; `empty:hidden` drops the hairline when
          the viewer has nothing to do here. */}
      <div
        className="flex flex-wrap items-center gap-1.5 border-t border-border/60 px-3 py-2 empty:hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Car pooling (migration 378) — straight to the rides board. */}
        {!cancelled && event.carpool_enabled && user && (
          <CarpoolChip type="event" id={event.id} scope={event.carpool_teams} />
        )}
        {onOpenRoster && (
          <Button size="tool" variant="outline" onClick={() => onOpenRoster(event)} title={t('viewRoster')} aria-label={t('viewRoster')}>
            <Users aria-hidden />
            {t('rosterTitle', { ns: 'participation' })}
          </Button>
        )}
        {onEdit && (
          <Button size="tool" variant="outline" onClick={() => onEdit(event)} title={t('editEvent')} aria-label={t('editEvent')}>
            <Pencil aria-hidden />
            {t('edit', { ns: 'common' })}
          </Button>
        )}
        <CancelActivityButton
          kind="event"
          activityId={event.id}
          isCancelled={cancelled}
          teamIds={asTeams(event.teams).map((tm) => String(tm.id))}
          variant="icon"
          onDone={onParticipationSaved}
        />
      </div>
    </div>
  )
}

/** Inline Yes/Maybe/No buttons for event cards — matches training/game card pattern, no dropdown overflow */
function EventCardParticipation({ event, existingParticipation, participations, onSaved, onStatusChange }: { event: Event; existingParticipation?: Participation; participations?: Participation[]; onSaved?: () => void; onStatusChange?: (status: Participation['status'] | null) => void }) {
  const { t } = useTranslation('participation')
  const { user, isStaffOnlyForTeams } = useAuth()
  const isStaff = isStaffOnlyForTeams((event.teams ?? []).map((tm) => teamId(tm)))
  const { create, update } = useMutation<Participation>('participations')
  const { absence, hasAbsence } = useMyCoveringAbsence('event', event.start_date)
  const absenceLabel = absence?.type === 'weekly' ? 'declinedUnavailable' : 'absent'
  const absenceNoteText = useAbsenceNoteText(absence)

  const deadlinePassed = event.respond_by
    ? getDeadlineDate(event.respond_by, event.start_date ? formatTime(event.start_date) : undefined) < new Date()
    : false

  const [optimisticStatus, setOptimisticStatus] = useState<Participation['status'] | null>(null)
  const [saveConfirmed, setSaveConfirmed] = useState(false)
  const [noteText, setNoteText] = useState(existingParticipation?.note ?? '')
  const [noteError, setNoteError] = useState(false)
  const noteInitRef = useRef(existingParticipation?.note ?? '')
  const noteInputRef = useRef<HTMLInputElement>(null)

  // Sync note: prefer server note, otherwise prefill with absence label.
  const serverNote = existingParticipation?.note ?? ''
  const effectiveSync = serverNote || absenceNoteText
  if (effectiveSync !== noteInitRef.current) {
    noteInitRef.current = effectiveSync
    setNoteText(effectiveSync)
  }

  const serverStatus = existingParticipation?.status ?? null
  const displayStatus = optimisticStatus ?? serverStatus

  // Auto-dismiss confirmation after 2s
  useEffect(() => {
    if (!saveConfirmed) return
    const timer = setTimeout(() => setSaveConfirmed(false), 2000)
    return () => clearTimeout(timer)
  }, [saveConfirmed])

  // Report what these buttons are showing so the card's left-edge banner can
  // paint the same thing in the same frame. `displayStatus` already folds in the
  // optimistic value and reverts to the server row if the save throws, so the
  // banner self-corrects without any extra bookkeeping.
  useEffect(() => { onStatusChange?.(displayStatus) }, [displayStatus, onStatusChange])

  const setStatus = useCallback(async (status: Participation['status'], note?: string) => {
    if (!user) return
    const n = note ?? noteText
    // If note is required for decline/tentative and no note yet, focus the note input
    if (event.require_note_if_absent && (status === 'declined' || status === 'tentative') && !n.trim()) {
      setOptimisticStatus(status)
      setNoteError(true)
      setTimeout(() => noteInputRef.current?.focus(), 50)
      return
    }
    setOptimisticStatus(status)
    setSaveConfirmed(false)
    try {
      if (existingParticipation) {
        await update(existingParticipation.id, { status, note: n, guest_count: status === 'declined' ? 0 : (existingParticipation.guest_count ?? 0) })
      } else {
        await create({
          member: user.id,
          activity_type: 'event' as const,
          activity_id: event.id,
          status,
          note: n,
          guest_count: 0,
          is_staff: isStaff,
        })
      }
      setSaveConfirmed(true)
      onSaved?.()
    } catch {
      setOptimisticStatus(null)
    }
  }, [user, existingParticipation, event.id, event.require_note_if_absent, isStaff, noteText, create, update, onSaved])

  const saveNote = () => {
    if (noteText.trim() && displayStatus) {
      setNoteError(false)
      setStatus(displayStatus, noteText.trim())
    }
  }

  const isLocked = deadlinePassed

  return (
    <div className="space-y-1.5">
      {hasAbsence && (
        <p className="text-xs italic text-muted-foreground">{t(absenceLabel)}</p>
      )}
      {/* Totals inside the buttons (compact card mode); the household caption,
          "Deadline passed" and the waitlist count come from the component. */}
      <RsvpAnswerButtons
        compact
        activityType="event"
        activityId={event.id}
        participations={participations ?? []}
        value={displayStatus}
        onSelect={(status) => { void setStatus(status) }}
        locked={isLocked}
        saved={saveConfirmed}
        options={rsvpOptions(event)}
        hideCoachPresent
      />

      {event.respond_by && !deadlinePassed && (
        <p className="text-[10px] leading-tight text-muted-foreground/80">
          {t('respondBy', { ns: 'events' })}: {formatDate(event.respond_by)}, {formatTime(event.respond_by) || (event.start_date ? formatTime(event.start_date) : '')}
        </p>
      )}

      {/* Note input — always visible once a status is set; required for declined/tentative when event.require_note_if_absent is on */}
      {displayStatus && (
        <div className="flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
          <input
            ref={noteInputRef}
            type="text"
            value={noteText}
            onChange={(e) => { setNoteText(e.target.value); setNoteError(false) }}
            onKeyDown={(e) => { if (e.key === 'Enter') saveNote() }}
            onBlur={saveNote}
            placeholder={t('notePlaceholder')}
            className={`h-9 min-w-0 flex-1 rounded-lg border bg-card px-2 text-xs text-foreground sm:h-8 placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/20 ${
              noteError ? 'border-red-400 dark:border-red-500' : 'border-input'
            }`}
          />
        </div>
      )}
      {noteError && (
        <p className="text-[10px] text-red-500 dark:text-red-400">{t('noteRequiredError')}</p>
      )}
    </div>
  )
}

/** RSVP control for per-day / per-session events on the card.
 *  Two ways to answer, per product decision:
 *   - Quick Yes/Maybe/No writes that status to EVERY session at once (one
 *     participation row per session_id) — the "confirm all days" shortcut.
 *   - "Per day" opens the granular per-leg sheet.
 *  A per-day event must NEVER get a session-less whole-event row (the old card
 *  did that, which is why the roster's day tabs showed 0 while Overall showed
 *  N/2). Aggregate status: all-same → that button is active; mixed → no button
 *  active, and an "X/Y confirmed" hint shows. */
function EventCardSessionParticipation({ event, participations, onSaved, onStatusChange }: { event: Event; participations?: Participation[]; onSaved?: () => void; onStatusChange?: (status: Participation['status'] | 'mixed' | null | undefined) => void }) {
  const { t: te } = useTranslation('events')
  const { user, isStaffOnlyForTeams } = useAuth()
  // Every invited team, not just `teams[0]` — a D1 coach on an H3 + D1 event
  // was classified as a player whenever H3 sorted first in the junction.
  const isStaff = isStaffOnlyForTeams((event.teams ?? []).map((tm) => teamId(tm)))
  const { create, update } = useMutation<Participation>('participations')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [savingAll, setSavingAll] = useState(false)
  const [optimisticAll, setOptimisticAll] = useState<Participation['status'] | null>(null)

  const { data: sessionsRaw, isError: sessionsError } = useCollection<EventSession>('event_sessions', {
    filter: { event: { _eq: event.id } },
    sort: ['sort_order', 'date', 'start_time'],
    limit: 100,
    enabled: !!user,
  })
  const sessions = useMemo(() => sessionsRaw ?? [], [sessionsRaw])

  const { data: myRowsRaw, refetch, isError: myRowsError } = useCollection<Participation>('participations', {
    filter: user
      ? { _and: [
          { member: { _eq: user.id } },
          { activity_type: { _eq: 'event' } },
          { activity_id: { _eq: event.id } },
        ] }
      : { id: { _eq: -1 } },
    all: true,
    enabled: !!user,
  })
  const myRows = useMemo(() => myRowsRaw ?? [], [myRowsRaw])
  useRealtime<Participation>('participations', (e) => {
    if (e.record.activity_id === event.id && e.record.member === user?.id) refetch()
  })

  const myBySession = useMemo(() => {
    const m = new Map<string, Participation>()
    for (const p of myRows) if (p.session_id) m.set(String(p.session_id), p)
    return m
  }, [myRows])

  const total = sessions.length
  const statuses = sessions.map((s) => myBySession.get(String(s.id))?.status ?? null)
  const confirmedCount = statuses.filter((s) => s === 'confirmed').length
  const answeredCount = statuses.filter((s) => s != null).length
  const uniform = (val: Participation['status']) => total > 0 && statuses.every((s) => s === val)
  const aggregate: Participation['status'] | null =
    optimisticAll ?? (uniform('confirmed') ? 'confirmed' : uniform('declined') ? 'declined' : uniform('tentative') ? 'tentative' : null)
  const mixed = !aggregate && answeredCount > 0

  const deadlinePassed = event.respond_by
    ? getDeadlineDate(event.respond_by, event.start_date ? formatTime(event.start_date) : undefined) < new Date()
    : false
  const isLocked = deadlinePassed

  // Same reporter as the whole-event control, but the value that matters here is
  // the AGGREGATE across sessions — 'mixed' when the member answered the days
  // differently, which is exactly the case the banner used to render as an
  // arbitrary single colour. Declared above the `total === 0` early return so the
  // hook order stays stable.
  //
  // `undefined` while this control's own two queries are still in flight: it means
  // "I have nothing to say yet", so the banner keeps showing the batch-fetched
  // server row instead of blinking off and back on — which is the very lag this
  // change is here to remove.
  // ⚠ `isLoading` goes false on ERROR while `data` stays undefined, so a bare
  // `data === undefined` gate never releases after a failed fetch — a permanent
  // skeleton is worse than the wrong frame it replaced. Errors fall through.
  const sessionDataReady =
    (sessionsRaw !== undefined && myRowsRaw !== undefined) || sessionsError || myRowsError
  useEffect(() => {
    onStatusChange?.(sessionDataReady ? (aggregate ?? (mixed ? 'mixed' : null)) : undefined)
  }, [sessionDataReady, aggregate, mixed, onStatusChange])

  const setAll = useCallback(async (status: Participation['status']) => {
    // `myBySession` is empty until BOTH queries land, so a click in that window
    // would take the create() branch for every session — including the ones that
    // already have a row — and migration 246's partial unique index rejects those
    // mid-`Promise.all`, leaving the RSVP half-written with no toast. The render
    // gate below means no button exists to click yet; this is the belt.
    if (!user || savingAll || total === 0 || !sessionDataReady) return
    setOptimisticAll(status)
    setSavingAll(true)
    try {
      await Promise.all(sessions.map((s) => {
        const existing = myBySession.get(String(s.id))
        return existing
          ? update(existing.id, { status })
          : create({
              member: user.id,
              activity_type: 'event' as const,
              activity_id: event.id,
              status,
              note: '',
              guest_count: 0,
              is_staff: isStaff,
              session_id: s.id,
            })
      }))
      onSaved?.()
    } catch {
      setOptimisticAll(null)
    } finally {
      setSavingAll(false)
    }
  }, [user, savingAll, total, sessionDataReady, sessions, myBySession, update, create, event.id, isStaff, onSaved])

  // Until both queries land, `statuses` is all-null and `aggregate` is therefore
  // null — three unselected buttons would be a definitive "you have not answered"
  // for a member who did. So the buttons render in their `loading` state (same
  // footprint, disabled, nothing selected-looking) until the real answer lands.
  if (sessionDataReady && total === 0) return null

  return (
    <div className="space-y-1.5">
      <RsvpAnswerButtons
        compact
        activityType="event"
        activityId={event.id}
        participations={participations ?? []}
        value={sessionDataReady ? aggregate : null}
        onSelect={(status) => { void setAll(status) }}
        locked={isLocked}
        loading={!sessionDataReady || savingAll}
        options={rsvpOptions(event)}
        hideCoachPresent
        trailing={!isLocked && sessionDataReady ? (
          <Button
            type="button"
            size="tool"
            variant="outline"
            onClick={() => setSheetOpen(true)}
            className="text-primary dark:text-brand-300"
          >
            <CalendarDays aria-hidden />
            {te('perDay', { defaultValue: 'Per day' })}
          </Button>
        ) : undefined}
      />
      {mixed && (
        <p className="text-[10px] leading-tight text-muted-foreground/80">
          {te('sessionsConfirmed', { confirmed: confirmedCount, total })}
        </p>
      )}
      {event.respond_by && !deadlinePassed && (
        <p className="text-[10px] leading-tight text-muted-foreground/80">
          {te('respondBy')}: {formatDate(event.respond_by)}, {formatTime(event.respond_by) || (event.start_date ? formatTime(event.start_date) : '')}
        </p>
      )}
      {sheetOpen && (
        <SessionParticipationSheet
          activityId={event.id}
          sessions={sessions}
          isStaff={isStaff}
          onClose={() => { setSheetOpen(false); onSaved?.() }}
        />
      )}
    </div>
  )
}

/** Answers this event offers on its card (Maybe off when `allow_maybe` is false). */
function rsvpOptions(event: Event): RsvpStatus[] {
  return event.allow_maybe === false ? ['confirmed', 'declined'] : ['confirmed', 'tentative', 'declined']
}
