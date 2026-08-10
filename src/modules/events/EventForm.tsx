import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/components/Modal'
import { useAuth } from '../../hooks/useAuth'
import { useAdminMode } from '../../hooks/useAdminMode'
import { useMutation } from '../../hooks/useMutation'
import { useCollection } from '../../lib/query'
import { Button } from '@/components/ui/button'
import { FormInput, FormTextarea, FormField } from '@/components/FormField'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DatePicker from '@/components/ui/DatePicker'
import TeamMultiSelect from '@/components/TeamMultiSelect'
import LocationCombobox from '@/components/LocationCombobox'
import { Switch } from '@/components/ui/switch'
import { teamNameToColorKey } from '../../utils/teamColors'
import { formatDateLocale } from '../../utils/dateUtils'
import { currentLocale, formatTime, parseRespondByTime, toUtcIsoFromDatetimeLocal, toDatetimeLocalFromUtcIso, toZurichDateString } from '../../utils/dateHelpers'
import type { Event, EventSession, Team } from '../../types'
import RoleChipPicker from '@/components/RoleChipPicker'
import MemberMultiSelect from '@/components/MemberMultiSelect'
import { createRecord, deleteRecord, updateRecord, kscwApi, m2mUpdatePayload } from '../../lib/api'
import { toast } from 'sonner'
import { useConfirm } from '@/components/ConfirmProvider'

/**
 * Directus M2M aliases come back either as bare IDs or as expanded junction
 * objects (`{ teams_id: { id, … } }` / `{ members_id: { id, … } }`), depending on
 * how the record was fetched — the `Event` type only models the bare-ID shape.
 * NB: a junction object's own `id` is the JUNCTION row PK, not the team/member
 * ID — only read it as a last-resort fallback (EventsPage requests both).
 */
type TeamRef = string | number | { teams_id?: string | number | { id: string | number } | null; id?: string | number | null }
type MemberRef = string | number | { members_id?: string | number | { id: string | number } | null; id?: string | number | null }

interface SessionDraft {
  id?: string // existing record id (for edit mode)
  date: string
  start_time: string
  end_time: string
  label: string
  sort_order: number
}

interface EventFormProps {
  open: boolean
  event?: Event | null
  onSave: () => void
  onCancel: () => void
}

/** Generate dates between start and end (inclusive) as YYYY-MM-DD strings */
function getDateRange(start: string, end: string): string[] {
  const dates: string[] = []
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  while (s <= e) {
    const yyyy = s.getFullYear()
    const mm = String(s.getMonth() + 1).padStart(2, '0')
    const dd = String(s.getDate()).padStart(2, '0')
    dates.push(`${yyyy}-${mm}-${dd}`)
    s.setDate(s.getDate() + 1)
  }
  return dates
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString(currentLocale(), { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function EventForm({ open, event, onSave, onCancel }: EventFormProps) {
  const { t, i18n } = useTranslation('events')
  const { t: tc } = useTranslation('common')
  const confirm = useConfirm()
  const { user, coachTeamIds, isSuperAdmin } = useAuth()
  const { effectiveIsAdmin } = useAdminMode()
  const { create, update, isLoading } = useMutation<Event>('events')
  const { data: allTeamsRaw } = useCollection<Team>('teams', { filter: { active: { _eq: true } }, sort: ['name'], limit: 50 })
  const allTeams = allTeamsRaw ?? []

  // Filter teams by permissions: admins see all, coaches see only their teams
  const availableTeams = useMemo(() => {
    if (effectiveIsAdmin) return allTeams
    if (coachTeamIds.length === 0) return allTeams
    return allTeams.filter((t) => coachTeamIds.includes(t.id))
  }, [allTeams, effectiveIsAdmin, coachTeamIds])

  const [sportFilter, setSportFilter] = useState<'all' | 'volleyball' | 'basketball'>('all')

  const teamOptions = useMemo(() =>
    availableTeams
      .filter((team) => sportFilter === 'all' || team.sport === sportFilter)
      .map((team) => ({
        value: team.id,
        label: team.name,
        colorKey: teamNameToColorKey(team.name, team.sport),
        group: team.sport === 'volleyball' ? tc('volleyball') : tc('basketball'),
      })),
  [availableTeams, tc, sportFilter])

  const singleTeam = availableTeams.length === 1

  const [title, setTitle] = useState('')
  const [eventType, setEventType] = useState<Event['event_type']>(effectiveIsAdmin ? 'verein' : 'social')
  // Dates are always kept date-only (YYYY-MM-DD); the clock time lives in
  // startTime/endTime and is only used when the event is not all-day. This lets
  // Start/End render the same branded DatePicker as Respond-by (plus a time
  // field when timed) instead of the native <input type="date"> the browser drew.
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [allDay, setAllDay] = useState(true)
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [selectedTeams, setSelectedTeams] = useState<string[]>([])
  const [respondBy, setRespondBy] = useState('')
  const [respondByTime, setRespondByTime] = useState('')
  const [maxPlayers, setMaxPlayers] = useState('')
  const [minParticipants, setMinParticipants] = useState('')
  const [requireNoteIfAbsent, setRequireNoteIfAbsent] = useState(false)
  const [allowMaybe, setAllowMaybe] = useState(true)
  const [enablePositions, setEnablePositions] = useState(false)
  const [participationMode, setParticipationMode] = useState<'whole' | 'per_day' | 'per_session'>('whole')
  const [sessions, setSessions] = useState<SessionDraft[]>([])
  const [invitedRoles, setInvitedRoles] = useState<string[]>([])
  const [invitedMembers, setInvitedMembers] = useState<string[]>([])
  const [sendEmailInvite, setSendEmailInvite] = useState(false)
  const [jsRelevant, setJsRelevant] = useState(false)
  const [jsActivityType, setJsActivityType] = useState<'Training' | 'Wettkampf' | 'Trainingstag' | 'Lagertag'>('Training')
  const [signupUrl, setSignupUrl] = useState('')
  const [signupBusy, setSignupBusy] = useState(false)
  const [templateDraft, setTemplateDraft] = useState<string | null>(null)
  const [error, setError] = useState('')
  // Covers the WHOLE submit — useMutation's isLoading only spans the create/update
  // call, so it went idle while the session sync was still running.
  const [submitting, setSubmitting] = useState(false)

  // Fetch existing sessions when editing
  const { data: existingSessionsRaw } = useCollection<EventSession>('event_sessions', {
    filter: event ? { event: { _eq: event.id } } : { id: { _eq: -1 } },
    sort: ['sort_order', 'date', 'start_time'],
    limit: 100,
    enabled: !!user && !!event,
  })
  const existingSessions = existingSessionsRaw ?? []

  // Seed / reset the form from the `event` prop (and whenever the modal reopens).
  // Adjust-state-during-render (React's reset-on-prop-change pattern) instead of a
  // setState-in-effect. The `null` sentinel makes the very first render seed as
  // well — exactly what the mount run of the former effect did — and it re-seeds
  // on every `event` / `open` change, as before.
  const [seededFrom, setSeededFrom] = useState<{ event: typeof event; open: boolean } | null>(null)
  if (!seededFrom || seededFrom.event !== event || seededFrom.open !== open) {
    setSeededFrom({ event, open })
    if (event) {
      setTitle(event.title)
      setEventType(event.event_type)
      if (event.all_day) {
        setStartDate(toZurichDateString(event.start_date))
        setEndDate(toZurichDateString(event.end_date))
        setStartTime('')
        setEndTime('')
      } else {
        const s = event.start_date ? toDatetimeLocalFromUtcIso(event.start_date) : ''
        const e = event.end_date ? toDatetimeLocalFromUtcIso(event.end_date) : ''
        setStartDate(s.split('T')[0] ?? '')
        setEndDate(e.split('T')[0] ?? '')
        setStartTime(s.split('T')[1] ?? '')
        setEndTime(e.split('T')[1] ?? '')
      }
      setAllDay(event.all_day)
      setLocation(event.location ?? '')
      setDescription(event.description ?? '')
      // teams from API are junction objects [{teams_id: {id, ...}}, ...] — extract team IDs
      setSelectedTeams((event.teams ?? []).map((t: TeamRef) => {
        if (typeof t === 'string' || typeof t === 'number') return String(t)
        const tid = t?.teams_id
        return String(typeof tid === 'object' ? tid?.id : tid ?? t?.id ?? t)
      }))
      // Same fallback the deadline check uses (EventCard → getDeadlineDate), so the
      // form shows the deadline that is actually enforced, not the 00:00 sentinel.
      const rbParsed = parseRespondByTime(
        event.respond_by,
        event.start_date ? formatTime(event.start_date) : undefined,
      )
      setRespondBy(rbParsed?.date ?? '')
      setRespondByTime(rbParsed?.time ?? '')
      setMaxPlayers(event.max_players ? String(event.max_players) : '')
      setMinParticipants(event.min_participants ? String(event.min_participants) : '')
      setRequireNoteIfAbsent(!!event.require_note_if_absent)
      setAllowMaybe(event.allow_maybe !== false)
      setParticipationMode((event.participation_mode as 'whole' | 'per_day' | 'per_session') || 'whole')
      setEnablePositions(event.features_enabled?.position_preferences === true)
      setInvitedRoles(event.invited_roles ?? [])
      setInvitedMembers(
        (event.invited_members ?? []).map((m: MemberRef) => {
          if (typeof m !== 'object') return String(m)
          const mid = m.members_id
          return String((typeof mid === 'object' ? mid?.id : mid) ?? m)
        })
      )
      setSendEmailInvite(event.send_email_invite ?? false)
      setJsRelevant(!!event.js_relevant)
      setJsActivityType((event.js_activity_type as 'Training' | 'Wettkampf' | 'Trainingstag' | 'Lagertag') || 'Training')
      setSignupUrl(event.signup_url ?? '')
    } else {
      setTitle('')
      setEventType(effectiveIsAdmin ? 'verein' : 'social')
      setStartDate('')
      setEndDate('')
      setStartTime('')
      setEndTime('')
      setAllDay(true)
      setLocation('')
      setDescription('')
      setSelectedTeams([])
      setRespondBy('')
      setRespondByTime('')
      setMaxPlayers('')
      setMinParticipants('')
      setRequireNoteIfAbsent(false)
      setAllowMaybe(true)
      setEnablePositions(false)
      setSportFilter('all')
      setParticipationMode('whole')
      setSessions([])
      setInvitedRoles([])
      setInvitedMembers([])
      setSendEmailInvite(false)
      setJsRelevant(false)
      setJsActivityType('Training')
      setSignupUrl('')
    }
    setSignupBusy(false)
    setError('')
  }

  // Load existing sessions into drafts once the fetch resolves. Same triggers as
  // the former effect ([event, existingSessions]) — `existingSessions` is
  // `existingSessionsRaw ?? []`, so keying on the raw value is equivalent (the
  // fresh `[]` identity it produced every render never passed the length guard).
  const [seededSessions, setSeededSessions] = useState<{ event: typeof event; src: typeof existingSessionsRaw } | null>(null)
  if (!seededSessions || seededSessions.event !== event || seededSessions.src !== existingSessionsRaw) {
    setSeededSessions({ event, src: existingSessionsRaw })
    if (event && existingSessions.length > 0) {
      setSessions(existingSessions.map((s) => ({
        id: s.id,
        date: s.date?.split('T')[0] ?? '',
        start_time: s.start_time ?? '',
        end_time: s.end_time ?? '',
        label: s.label ?? '',
        sort_order: s.sort_order ?? 0,
      })))
    }
  }

  // Is this a multi-day event?
  const isMultiDay = useMemo(() => {
    if (!startDate || !endDate) return false
    return endDate > startDate
  }, [startDate, endDate])

  // Auto-generate per-day sessions when switching to per_day mode
  function generatePerDaySessions() {
    if (!startDate || !endDate) return
    const dates = getDateRange(startDate, endDate)
    setSessions(dates.map((d, i) => ({
      date: d,
      start_time: '',
      end_time: '',
      label: '',
      sort_order: i,
    })))
  }

  // Handle participation mode change
  function handleModeChange(mode: 'whole' | 'per_day' | 'per_session') {
    setParticipationMode(mode)
    if (mode === 'per_day') {
      generatePerDaySessions()
    } else if (mode === 'per_session') {
      // Start with one session per day, user can add time blocks
      if (!startDate || !endDate) return
      const dates = getDateRange(startDate, endDate)
      setSessions(dates.map((d, i) => ({
        date: d,
        start_time: '09:00',
        end_time: '17:00',
        label: '',
        sort_order: i,
      })))
    } else {
      setSessions([])
    }
  }

  // Keep session rows in step with the event's date range when the user edits
  // the start/end dates. Without this, sessions were only ever (re)generated on
  // a mode switch, so moving an existing per-day event's dates left its sessions
  // stranded on the old days (e.g. event moved to Sat–Sun but sessions still on
  // Fri–Sat). Per-day: one row per day, preserving each row's id + label BY INDEX
  // so existing session_id RSVP references survive the date shift. Per-session:
  // just drop rows whose day fell out of the new range (surviving days keep their
  // time blocks; new days get an empty bucket the user fills in).
  function reconcileSessionDates(newStart: string, newEnd: string) {
    if (!newStart) return
    const s = newStart.split('T')[0]
    const e = (newEnd || newStart).split('T')[0]
    if (participationMode === 'per_day') {
      const dates = getDateRange(s, e)
      setSessions((prev) => dates.map((d, i) => ({
        id: prev[i]?.id,
        date: d,
        start_time: '',
        end_time: '',
        label: prev[i]?.label ?? '',
        sort_order: i,
      })))
    } else if (participationMode === 'per_session') {
      const dateSet = new Set(getDateRange(s, e))
      setSessions((prev) => prev.filter((sess) => dateSet.has(sess.date)))
    }
  }

  function addSessionForDate(date: string) {
    const maxOrder = sessions.reduce((m, s) => Math.max(m, s.sort_order), 0)
    setSessions((prev) => [...prev, {
      date,
      start_time: '09:00',
      end_time: '12:00',
      label: '',
      sort_order: maxOrder + 1,
    }])
  }

  function removeSession(index: number) {
    setSessions((prev) => prev.filter((_, i) => i !== index))
  }

  function updateSession(index: number, field: keyof SessionDraft, value: string | number) {
    setSessions((prev) => prev.map((s, i) => i === index ? { ...s, [field]: value } : s))
  }

  // Auto-select when user manages only one team (pre-fill, user can still remove).
  // Adjust-state-during-render: the guard (`selectedTeams.length === 0`) was itself
  // a dependency of the former effect, so it fired on exactly the same transitions,
  // and it converges immediately once the team is selected.
  if (singleTeam && !event && availableTeams.length === 1 && selectedTeams.length === 0) {
    setSelectedTeams([availableTeams[0].id])
  }

  /**
   * Which OpnForm form new signup forms are copied from. Lives in `app_settings`
   * rather than an env var so a superuser can repoint it without an SSH round-trip
   * and a container recreate. The endpoint falls back to OPNFORM_TEMPLATE_FORM_ID
   * when no row exists, so an unset value here is not necessarily "unconfigured".
   */
  const { data: templateRowsRaw, refetch: refetchTemplate } = useCollection<{ id: string; value: string | null }>(
    'app_settings',
    { filter: { key: { _eq: 'opnform_event_template_id' } }, limit: 1, enabled: !!user && isSuperAdmin },
  )
  const templateRow = (templateRowsRaw ?? [])[0]
  const templateValue = templateRow?.value ?? ''

  async function handleSaveTemplate() {
    const next = (templateDraft ?? '').trim()
    setSignupBusy(true)
    try {
      if (templateRow) {
        await updateRecord('app_settings', templateRow.id, { value: next })
      } else {
        await createRecord('app_settings', { key: 'opnform_event_template_id', value: next, enabled: true })
      }
      await refetchTemplate()
      setTemplateDraft(null)
      toast.success(t('signupTemplateSaved'))
    } catch {
      toast.error(t('signupFormFailed'))
    } finally {
      setSignupBusy(false)
    }
  }

  /**
   * Duplicates the OpnForm template and links the copy to this event. Server-side
   * so the OpnForm token never reaches the browser. Only available once the event
   * exists — the endpoint keys off its id, and the slug is built from its title.
   */
  async function handleCreateSignupForm() {
    if (!event) return
    const replacing = !!signupUrl.trim()
    if (replacing && !(await confirm({ message: t('signupFormReplaceConfirm'), danger: true }))) return

    setSignupBusy(true)
    try {
      const res = await kscwApi<{ url: string; slug: string }>(
        `/events/${event.id}/signup-form`,
        { method: 'POST', body: { force: replacing } },
      )
      // The endpoint writes signup_url itself, so mirror it into local state —
      // otherwise the next save would push the stale value back over it.
      setSignupUrl(res.url)
      toast.success(t('signupFormCreated'))
    } catch (err) {
      const body = (err as { body?: { message?: string; error?: string } }).body
      toast.error(body?.message || body?.error || t('signupFormFailed'))
    } finally {
      setSignupBusy(false)
    }
  }

  async function handleUnlinkSignupForm() {
    if (!event) return
    if (!(await confirm({ message: t('signupFormUnlinkConfirm'), danger: true }))) return
    setSignupBusy(true)
    try {
      await kscwApi(`/events/${event.id}/signup-form`, { method: 'DELETE' })
      setSignupUrl('')
      toast.success(t('signupFormUnlinked'))
    } catch {
      toast.error(t('signupFormFailed'))
    } finally {
      setSignupBusy(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!title || !startDate) {
      setError(tc('required'))
      return
    }
    if (submitting) return
    setSubmitting(true)

    const effectiveMode = isMultiDay ? participationMode : 'whole'

    const data = {
      title,
      event_type: eventType,
      start_date: allDay
        ? startDate
        : toUtcIsoFromDatetimeLocal(`${startDate}T${startTime || '00:00'}`),
      end_date: allDay
        ? (endDate || startDate)
        : toUtcIsoFromDatetimeLocal(`${endDate || startDate}T${endTime || startTime || '00:00'}`),
      all_day: allDay,
      location,
      description,
      teams: m2mUpdatePayload('teams_id', selectedTeams, event?.teams),
      created_by: user?.id,
      respond_by: respondBy
        ? toUtcIsoFromDatetimeLocal(`${respondBy}T${respondByTime || '23:59'}`)
        : null,
      max_players: maxPlayers ? Number(maxPlayers) : null,
      min_participants: minParticipants ? Number(minParticipants) : null,
      require_note_if_absent: requireNoteIfAbsent,
      allow_maybe: allowMaybe,
      participation_mode: effectiveMode,
      features_enabled: { position_preferences: enablePositions },
      invited_roles: invitedRoles.length > 0 ? invitedRoles : null,
      invited_members: m2mUpdatePayload('members_id', invitedMembers, event?.invited_members),
      send_email_invite: sendEmailInvite,
      js_relevant: jsRelevant,
      js_activity_type: jsRelevant ? jsActivityType : null,
      signup_url: signupUrl.trim() || null,
    }

    try {
      let eventId: string
      if (event) {
        await update(event.id, data)
        eventId = event.id
      } else {
        const rec = await create(data)
        eventId = rec.id
      }

      // Sync sessions
      if (effectiveMode !== 'whole') {
        await syncSessions(eventId, sessions, existingSessions)
      } else if (event) {
        // Switching from per_day/per_session back to whole — delete all sessions
        // (independent rows, so fire in parallel).
        await Promise.all(existingSessions.map((s) => deleteRecord('event_sessions', s.id)))
      }

      // Notify the audience of a new event — deliberately NOT awaited. The
      // endpoint sends one mail per recipient serially, so inviting a dozen
      // teams holds the request open for the whole batch; awaiting it here kept
      // the modal standing for minutes with the Save button already back to
      // idle (useMutation's isLoading only covers the create call), which reads
      // as "Save did nothing" and invites a second click. The event and its
      // sessions are committed by this point, so nothing is lost by closing
      // now, and a failed send surfaces as a toast rather than being swallowed.
      if (!event) {
        if (sendEmailInvite) toast.info(t('inviteSending'))
        void kscwApi(`/events/${eventId}/notify`, {
          method: 'POST',
          body: { send_email: sendEmailInvite },
        }).catch(() => toast.error(t('inviteFailed')))
      }

      onSave()
    } catch {
      setError(tc('errorSaving'))
    } finally {
      setSubmitting(false)
    }
  }

  // Group sessions by date for per_session display
  const sessionsByDate = useMemo(() => {
    if (!isMultiDay || participationMode === 'whole') return new Map<string, SessionDraft[]>()
    const map = new Map<string, SessionDraft[]>()
    const dates = getDateRange(startDate, endDate)
    for (const d of dates) {
      map.set(d, [])
    }
    for (const s of sessions) {
      const arr = map.get(s.date)
      if (arr) arr.push(s)
      else map.set(s.date, [s])
    }
    return map
  }, [sessions, startDate, endDate, isMultiDay, participationMode])

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={event ? t('editEvent') : t('newEvent')}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormInput
          label={t('eventTitle')}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />

        <FormField label={t('eventType')}>
          <Select value={eventType} onValueChange={(v) => setEventType(v as Event['event_type'])}>
            <SelectTrigger className="min-h-[44px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {effectiveIsAdmin && <SelectItem value="verein">{t('club')}</SelectItem>}
              <SelectItem value="social">{t('social')}</SelectItem>
              <SelectItem value="meeting">{t('meeting')}</SelectItem>
              <SelectItem value="tournament">{t('tournament')}</SelectItem>
              <SelectItem value="trainingsweekend">{t('trainingsweekend')}</SelectItem>
              <SelectItem value="friendly">{t('friendly')}</SelectItem>
              <SelectItem value="other">{t('other')}</SelectItem>
            </SelectContent>
          </Select>
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <DatePicker
              label={t('startDate')}
              value={startDate}
              onChange={(v) => {
                setStartDate(v)
                const newEnd = (!endDate || endDate < v) ? v : endDate
                if (!endDate || endDate < v) setEndDate(v)
                reconcileSessionDates(v, newEnd)
              }}
            />
            {!allDay && (
              <FormInput
                label={t('startTime')}
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            )}
            {startDate && (
              <p className="text-xs text-muted-foreground">
                {formatDateLocale(new Date(startDate + 'T00:00:00'), 'EEEE', i18n.language)}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <DatePicker
              label={t('endDate')}
              value={endDate}
              onChange={(v) => {
                setEndDate(v)
                reconcileSessionDates(startDate, v)
              }}
              min={startDate}
            />
            {!allDay && (
              <FormInput
                label={t('endTime')}
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            )}
            {endDate && (
              <p className="text-xs text-muted-foreground">
                {formatDateLocale(new Date(endDate + 'T00:00:00'), 'EEEE', i18n.language)}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <Switch
            checked={allDay}
            onCheckedChange={(checked) => {
              setAllDay(checked)
              // Dates stay date-only; only seed default clock times when the
              // event becomes timed so the time fields aren't blank.
              if (!checked) {
                if (!startTime) setStartTime('00:00')
                if (!endTime) setEndTime(startTime || '00:00')
              }
            }}
          />
          {t('allDay')}
        </div>

        <FormField label={t('location')}>
          <LocationCombobox
            value={location}
            onChange={setLocation}
          />
        </FormField>

        <FormTextarea
          label={t('description')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />

        <div className="space-y-2">
          <DatePicker
            label={t('respondBy')}
            value={respondBy}
            onChange={(v) => {
              setRespondBy(v)
              if (v && !respondByTime) setRespondByTime('23:59')
            }}
            helperText={t('respondByHint')}
          />
          {respondBy && (
            <FormInput
              label={t('respondByTime')}
              type="time"
              value={respondByTime || '23:59'}
              onChange={(e) => setRespondByTime(e.target.value)}
            />
          )}
        </div>

        <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <Switch checked={requireNoteIfAbsent} onCheckedChange={setRequireNoteIfAbsent} />
          <div>
            <span>{t('requireNoteIfAbsent', { ns: 'participation' })}</span>
            <p className="text-xs text-muted-foreground">{t('requireNoteIfAbsentHint', { ns: 'participation' })}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <Switch checked={allowMaybe} onCheckedChange={setAllowMaybe} />
          <div>
            <span>{t('allowMaybe')}</span>
            <p className="text-xs text-muted-foreground">{t('allowMaybeHint')}</p>
          </div>
        </div>

        {/* J+S export opt-in — flags the event as a J+S activity and picks its NDS type. */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <Switch checked={jsRelevant} onCheckedChange={setJsRelevant} />
            <div>
              <span>{t('eventJsInScope', { ns: 'jsExport' })}</span>
              <p className="text-xs text-muted-foreground">{t('eventJsInScopeHint', { ns: 'jsExport' })}</p>
            </div>
          </div>
          {jsRelevant && (
            <FormField label={t('eventJsType', { ns: 'jsExport' })}>
              <Select value={jsActivityType} onValueChange={(v) => setJsActivityType(v as typeof jsActivityType)}>
                <SelectTrigger className="min-h-[44px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Training">Training</SelectItem>
                  <SelectItem value="Wettkampf">Wettkampf</SelectItem>
                  <SelectItem value="Trainingstag">Trainingstag</SelectItem>
                  <SelectItem value="Lagertag">Lagertag</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          )}
        </div>

        {/* Public signup form (OpnForm). The door for NON-members: members RSVP
            natively above, which is what drives counts and rosters. On a
            club-wide event kscw.ch renders this URL as its "Anmelden" button. */}
        {effectiveIsAdmin && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <div>
              <span className="text-sm font-medium">{t('signupForm')}</span>
              <p className="text-xs text-muted-foreground">{t('signupFormHint')}</p>
            </div>

            {!event ? (
              <p className="text-xs text-muted-foreground">{t('signupFormSaveFirst')}</p>
            ) : (
              <>
                <FormInput
                  label={t('signupFormUrl')}
                  type="url"
                  value={signupUrl}
                  onChange={(e) => setSignupUrl(e.target.value)}
                  placeholder="https://forms.kscw.ch/forms/..."
                />
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-[44px]"
                    disabled={signupBusy}
                    onClick={handleCreateSignupForm}
                  >
                    {signupUrl.trim() ? t('signupFormReplace') : t('signupFormCreate')}
                  </Button>
                  {signupUrl.trim() && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-[44px]"
                        onClick={() => {
                          navigator.clipboard.writeText(signupUrl.trim())
                          toast.success(tc('copied'))
                        }}
                      >
                        {t('signupFormCopy')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-[44px]"
                        disabled={signupBusy}
                        onClick={handleUnlinkSignupForm}
                      >
                        {t('signupFormUnlink')}
                      </Button>
                    </>
                  )}
                </div>
              </>
            )}

            {/* Template picker — superuser only. The value is club-wide, but it
                lives here rather than on a settings page because this is the only
                screen it affects, and it is edited about once a season. */}
            {isSuperAdmin && (
              <div className="border-t border-border pt-2">
                <FormInput
                  label={t('signupTemplateId')}
                  value={templateDraft ?? templateValue}
                  onChange={(e) => setTemplateDraft(e.target.value)}
                  placeholder="42"
                  helperText={t('signupTemplateIdHint')}
                />
                {templateDraft !== null && templateDraft !== templateValue && (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-2 min-h-[44px]"
                    disabled={signupBusy}
                    onClick={handleSaveTemplate}
                  >
                    {t('signupTemplateSave')}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {['tournament', 'trainingsweekend', 'friendly'].includes(eventType) && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <FormInput
                label={t('minParticipants')}
                type="number"
                value={minParticipants}
                onChange={(e) => setMinParticipants(e.target.value)}
                min={0}
              />
              <FormInput
                label={t('maxPlayers')}
                type="number"
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(e.target.value)}
                min={0}
              />
            </div>

            <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <Switch checked={enablePositions} onCheckedChange={setEnablePositions} />
              <div>
                <span>{t('enablePositions')}</span>
                <p className="text-xs text-muted-foreground">{t('enablePositionsHint')}</p>
              </div>
            </div>
          </>
        )}

        <FormField label={t('teamsInvolved')} helperText={t('teamsInvolvedHint')}>
          <div className="mb-2 flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-gray-600 dark:bg-gray-800">
            {(['all', 'volleyball', 'basketball'] as const).map((sport) => (
              <button
                key={sport}
                type="button"
                onClick={() => {
                  setSportFilter(sport)
                  // Remove selected teams that don't match the new filter
                  if (sport !== 'all') {
                    const validIds = new Set(availableTeams.filter(t => t.sport === sport).map(t => t.id))
                    setSelectedTeams(prev => prev.filter(id => validIds.has(id)))
                  }
                }}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  sportFilter === sport
                    ? 'bg-brand-500 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                {sport === 'all' ? tc('all') : sport === 'volleyball' ? tc('volleyball') : tc('basketball')}
              </button>
            ))}
          </div>
          <TeamMultiSelect
            options={teamOptions}
            selected={selectedTeams}
            onChange={setSelectedTeams}
          />
        </FormField>

        {/* Role targeting */}
        <FormField label={t('inviteByRole', { ns: 'invitations' })}>
          <RoleChipPicker selected={invitedRoles} onChange={setInvitedRoles} />
        </FormField>

        {/* Member targeting */}
        <FormField label={t('inviteSpecificMembers', { ns: 'invitations' })}>
          <MemberMultiSelect selected={invitedMembers} onChange={setInvitedMembers} />
        </FormField>

        {/* Email invite toggle */}
        <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <Switch checked={sendEmailInvite} onCheckedChange={setSendEmailInvite} />
          <div>
            <span>{t('sendEmailInvite', { ns: 'invitations' })}</span>
            <p className="text-xs text-muted-foreground">{t('sendEmailInviteHint', { ns: 'invitations' })}</p>
          </div>
        </div>

        {/* Participation mode selector — only for multi-day events */}
        {isMultiDay && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('participationMode')}</label>
            <div className="mt-2 flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-gray-600 dark:bg-gray-800">
              {(['whole', 'per_day', 'per_session'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => handleModeChange(mode)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    participationMode === mode
                      ? 'bg-brand-500 text-white shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  {t(mode === 'whole' ? 'modeWhole' : mode === 'per_day' ? 'modePerDay' : 'modePerSession')}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Session list for per_day mode */}
        {isMultiDay && participationMode === 'per_day' && sessions.length > 0 && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="border-b border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 dark:border-gray-700 dark:text-gray-300">
              {t('sessions')} ({sessions.length})
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {sessions.map((s, i) => (
                <div key={`${s.date}-${i}`} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-[100px] text-sm font-medium text-gray-700 dark:text-gray-300">
                    {formatDateShort(s.date)}
                  </span>
                  <label className="flex-1">
                    <span className="sr-only">{t('sessionLabel')}</span>
                    <input
                      type="text"
                      value={s.label}
                      onChange={(e) => updateSession(i, 'label', e.target.value)}
                      placeholder={t('sessionLabel')}
                      className="w-full rounded border border-gray-200 bg-transparent px-2 py-1 text-sm dark:border-gray-600 dark:text-gray-100"
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Session builder for per_session mode */}
        {isMultiDay && participationMode === 'per_session' && (
          <div className="space-y-3">
            {Array.from(sessionsByDate.entries()).map(([date, dateSessions]) => (
              <div key={date} className="rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {formatDateShort(date)}
                  </span>
                  <button
                    type="button"
                    onClick={() => addSessionForDate(date)}
                    className="rounded px-2 py-0.5 text-xs font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-900/30"
                  >
                    + {t('addTimeBlock')}
                  </button>
                </div>
                {dateSessions.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-400">{t('addTimeBlock')}</div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-700">
                    {dateSessions.map((s) => {
                      const idx = sessions.indexOf(s)
                      return (
                        <div key={idx} className="flex items-center gap-2 px-3 py-2">
                          <input
                            type="time"
                            value={s.start_time}
                            onChange={(e) => updateSession(idx, 'start_time', e.target.value)}
                            className="w-24 rounded border border-gray-200 bg-transparent px-2 py-1 text-sm dark:border-gray-600 dark:text-gray-100"
                          />
                          <span className="text-gray-400">–</span>
                          <input
                            type="time"
                            value={s.end_time}
                            onChange={(e) => updateSession(idx, 'end_time', e.target.value)}
                            className="w-24 rounded border border-gray-200 bg-transparent px-2 py-1 text-sm dark:border-gray-600 dark:text-gray-100"
                          />
                          <input
                            type="text"
                            value={s.label}
                            onChange={(e) => updateSession(idx, 'label', e.target.value)}
                            placeholder={t('sessionLabel')}
                            className="flex-1 rounded border border-gray-200 bg-transparent px-2 py-1 text-sm dark:border-gray-600 dark:text-gray-100"
                          />
                          <button
                            type="button"
                            onClick={() => removeSession(idx)}
                            className="text-red-400 hover:text-red-600"
                            title={t('removeSession')}
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="ghost" type="button" onClick={onCancel}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={submitting || isLoading}>
            {submitting || isLoading ? tc('saving') : tc('save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Sync session drafts with PB: create new, update changed, delete removed */
async function syncSessions(
  eventId: string,
  drafts: SessionDraft[],
  existing: EventSession[],
) {
  const existingIds = new Set(existing.map((s) => s.id))
  const draftIds = new Set(drafts.filter((d) => d.id).map((d) => d.id!))

  // Delete removed — independent rows, so fire in parallel.
  await Promise.all(
    existing
      .filter((s) => !draftIds.has(s.id))
      .map((s) => deleteRecord('event_sessions', s.id)),
  )

  // Create or update — independent rows, so fire in parallel.
  await Promise.all(
    drafts.map((d) => {
      const payload = {
        event: eventId,
        date: d.date,
        // Empty time → null, never '' — a `per_day` session has no clock time,
        // and Postgres's `time` column rejects '' ("invalid input syntax for
        // type time"). Directus coerced '' → null on INSERT but passed it raw on
        // UPDATE, 500-ing every edit of a per-day event.
        start_time: d.start_time || null,
        end_time: d.end_time || null,
        label: d.label,
        sort_order: d.sort_order,
      }
      return d.id && existingIds.has(d.id)
        ? updateRecord('event_sessions', d.id, payload)
        : createRecord('event_sessions', payload)
    }),
  )
}
