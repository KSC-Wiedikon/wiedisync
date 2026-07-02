import { useState, useEffect, useMemo } from 'react'
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
import { parseRespondByTime, toUtcIsoFromDatetimeLocal, toDatetimeLocalFromUtcIso, toZurichDateString } from '../../utils/dateHelpers'
import type { Event, EventSession, Team } from '../../types'
import RoleChipPicker from '@/components/RoleChipPicker'
import MemberMultiSelect from '@/components/MemberMultiSelect'
import { createRecord, deleteRecord, updateRecord, kscwApi } from '../../lib/api'

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
  return d.toLocaleDateString('de-CH', { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function EventForm({ open, event, onSave, onCancel }: EventFormProps) {
  const { t, i18n } = useTranslation('events')
  const { t: tc } = useTranslation('common')
  const { user, coachTeamIds } = useAuth()
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
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
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
  const [enableTasks, setEnableTasks] = useState(false)
  const [participationMode, setParticipationMode] = useState<'whole' | 'per_day' | 'per_session'>('whole')
  const [sessions, setSessions] = useState<SessionDraft[]>([])
  const [invitedRoles, setInvitedRoles] = useState<string[]>([])
  const [invitedMembers, setInvitedMembers] = useState<string[]>([])
  const [sendEmailInvite, setSendEmailInvite] = useState(false)
  const [error, setError] = useState('')

  // Fetch existing sessions when editing
  const { data: existingSessionsRaw } = useCollection<EventSession>('event_sessions', {
    filter: event ? { event: { _eq: event.id } } : { id: { _eq: -1 } },
    sort: ['sort_order', 'date', 'start_time'],
    limit: 100,
    enabled: !!user && !!event,
  })
  const existingSessions = existingSessionsRaw ?? []

  useEffect(() => {
    if (event) {
      setTitle(event.title)
      setEventType(event.event_type)
      setStartDate(event.all_day
        ? toZurichDateString(event.start_date)
        : (event.start_date ? toDatetimeLocalFromUtcIso(event.start_date) : ''))
      setEndDate(event.all_day
        ? toZurichDateString(event.end_date)
        : (event.end_date ? toDatetimeLocalFromUtcIso(event.end_date) : ''))
      setAllDay(event.all_day)
      setLocation(event.location ?? '')
      setDescription(event.description ?? '')
      // teams from API are junction objects [{teams_id: {id, ...}}, ...] — extract team IDs
      setSelectedTeams((event.teams ?? []).map((t: any) => {
        if (typeof t === 'string' || typeof t === 'number') return String(t)
        const tid = t?.teams_id
        return String(typeof tid === 'object' ? tid?.id : tid ?? t?.id ?? t)
      }))
      const rbParsed = parseRespondByTime(event.respond_by)
      setRespondBy(rbParsed?.date ?? '')
      setRespondByTime(rbParsed?.time ?? '')
      setMaxPlayers(event.max_players ? String(event.max_players) : '')
      setMinParticipants(event.min_participants ? String(event.min_participants) : '')
      setRequireNoteIfAbsent(!!event.require_note_if_absent)
      setAllowMaybe(event.allow_maybe !== false)
      setParticipationMode((event.participation_mode as 'whole' | 'per_day' | 'per_session') || 'whole')
      setEnableTasks(event.features_enabled?.tasks === true)
      setEnablePositions(event.features_enabled?.position_preferences === true)
      setInvitedRoles(event.invited_roles ?? [])
      setInvitedMembers(
        (event.invited_members ?? []).map((m: any) => typeof m === 'object' ? String(m.members_id?.id ?? m.members_id ?? m) : String(m))
      )
      setSendEmailInvite(event.send_email_invite ?? false)
    } else {
      setTitle('')
      setEventType(effectiveIsAdmin ? 'verein' : 'social')
      setStartDate('')
      setEndDate('')
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
    }
    setError('')
  }, [event, open])

  // Load existing sessions into drafts
  useEffect(() => {
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
  }, [event, existingSessions])

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

  // Auto-select when user manages only one team (pre-fill, user can still remove)
  useEffect(() => {
    if (singleTeam && !event && availableTeams.length === 1 && selectedTeams.length === 0) {
      setSelectedTeams([availableTeams[0].id])
    }
  }, [singleTeam, event, availableTeams, selectedTeams.length])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!title || !startDate) {
      setError(tc('required'))
      return
    }

    const effectiveMode = isMultiDay ? participationMode : 'whole'

    const data = {
      title,
      event_type: eventType,
      start_date: allDay ? startDate : toUtcIsoFromDatetimeLocal(startDate),
      end_date: allDay ? (endDate || startDate) : toUtcIsoFromDatetimeLocal(endDate || startDate),
      all_day: allDay,
      location,
      description,
      teams: selectedTeams.map((id) => ({ teams_id: id })),
      created_by: user?.id,
      respond_by: respondBy
        ? toUtcIsoFromDatetimeLocal(`${respondBy}T${respondByTime || '23:59'}`)
        : null,
      max_players: maxPlayers ? Number(maxPlayers) : null,
      min_participants: minParticipants ? Number(minParticipants) : null,
      require_note_if_absent: requireNoteIfAbsent,
      allow_maybe: allowMaybe,
      participation_mode: effectiveMode,
      features_enabled: { tasks: enableTasks, position_preferences: enablePositions },
      invited_roles: invitedRoles.length > 0 ? invitedRoles : null,
      invited_members: invitedMembers.map((id) => ({ members_id: id })),
      send_email_invite: sendEmailInvite,
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

      // Send notifications for new events
      if (!event) {
        try {
          await kscwApi(`/events/${eventId}/notify`, {
            method: 'POST',
            body: { send_email: sendEmailInvite },
          })
        } catch {
          // Notification failure shouldn't block event creation
        }
      }

      // Sync sessions
      if (effectiveMode !== 'whole') {
        await syncSessions(eventId, sessions, existingSessions)
      } else if (event) {
        // Switching from per_day/per_session back to whole — delete all sessions
        // (independent rows, so fire in parallel).
        await Promise.all(existingSessions.map((s) => deleteRecord('event_sessions', s.id)))
      }

      onSave()
    } catch {
      setError(tc('errorSaving'))
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
          <div>
            <FormInput
              label={t('startDate')}
              type={allDay ? 'date' : 'datetime-local'}
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value)
                if (!endDate || endDate < e.target.value) setEndDate(e.target.value)
              }}
              required
            />
            {startDate && (
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDateLocale(new Date(startDate.split('T')[0] + 'T00:00:00'), 'EEEE', i18n.language)}
              </p>
            )}
          </div>
          <div>
            <FormInput
              label={t('endDate')}
              type={allDay ? 'date' : 'datetime-local'}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate}
            />
            {endDate && (
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDateLocale(new Date(endDate.split('T')[0] + 'T00:00:00'), 'EEEE', i18n.language)}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <Switch
            checked={allDay}
            onCheckedChange={(checked) => {
              setAllDay(checked)
              if (!checked) {
                // Switching to datetime-local: convert date-only to Zurich-local datetime-local string
                if (startDate && !startDate.includes('T')) setStartDate(`${startDate}T00:00`)
                if (endDate && !endDate.includes('T')) setEndDate(`${endDate}T00:00`)
              } else {
                // Switching to date: strip time component
                if (startDate.includes('T')) setStartDate(startDate.split('T')[0])
                if (endDate.includes('T')) setEndDate(endDate.split('T')[0])
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

        <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <Switch checked={enableTasks} onCheckedChange={setEnableTasks} />
          <div>
            <span>{t('enableTasks')}</span>
            <p className="text-xs text-muted-foreground">{t('enableTasksHint')}</p>
          </div>
        </div>

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
          <Button type="submit" loading={isLoading}>
            {isLoading ? tc('saving') : tc('save')}
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
        start_time: d.start_time,
        end_time: d.end_time,
        label: d.label,
        sort_order: d.sort_order,
      }
      return d.id && existingIds.has(d.id)
        ? updateRecord('event_sessions', d.id, payload)
        : createRecord('event_sessions', payload)
    }),
  )
}
