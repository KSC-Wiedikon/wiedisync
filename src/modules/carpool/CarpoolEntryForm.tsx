import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import DatePicker from '@/components/ui/DatePicker'
import { TeamPickerMulti, type TeamPickerOption } from '@/components/ui/TeamPicker'
import type { CarpoolDirection, CarpoolEntryInput, CarpoolKind } from './carpoolApi'
import { TriangleAlert } from 'lucide-react'
import { formatDayMonthZurich, formatWeekdayZurich } from '../../utils/dateHelpers'
import { CARPOOL_MAX_SEATS } from './carpoolFormat'

interface CarpoolEntryFormProps {
  kind: CarpoolKind
  /** The board the ride goes on — Going or Return (migration 393). Fixed. */
  direction: CarpoolDirection
  /** Pre-fill for a new ride's day: the activity's first (Going) or last (Return) day. */
  defaultDate?: string | null
  /** Present when editing an existing entry. */
  initial?: Partial<CarpoolEntryInput>
  /** Pre-fill for a new offer's time (e.g. the activity's meeting time). */
  suggestedTime?: string | null
  /** Days that already carry the viewer's ride of this kind and way (one per day, 397). */
  takenDays?: readonly string[]
  /** Seats already taken in this car — an offer cannot go below it. */
  minSeats?: number
  /** Teams an offer can be for (migration 380). Picker shown when ≥2. */
  teamOptions?: readonly TeamPickerOption[]
  onSubmit: (input: CarpoolEntryInput) => Promise<void>
  onCancel: () => void
}

/**
 * Inline offer / request form. Rendered inside the banner rather than as a
 * dialog: the banner itself lives inside the game/training/event modals, and a
 * dialog on top of those fights their focus traps.
 */
export default function CarpoolEntryForm({ kind, direction, defaultDate, initial, suggestedTime, takenDays = [], minSeats = 1, teamOptions = [], onSubmit, onCancel }: CarpoolEntryFormProps) {
  const { t } = useTranslation('carpool')
  const { t: tc } = useTranslation('common')
  const editing = !!initial
  const [seats, setSeats] = useState<number>(initial?.seats ?? (kind === 'offer' ? 3 : 1))
  const [date, setDate] = useState<string>(initial?.departure_date ?? defaultDate ?? '')
  const [time, setTime] = useState<string>(initial?.departure_time ?? (editing ? '' : suggestedTime ?? ''))
  const [teams, setTeams] = useState<string[]>((initial?.teams ?? []).map(String))
  const [location, setLocation] = useState<string>(initial?.departure_location ?? '')
  const [notes, setNotes] = useState<string>(initial?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const idp = `carpool-${kind}-${direction}`
  // One ride per way per day: the server refuses a second one, so say it here.
  const dayTaken = !!date && takenDays.includes(date)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving || dayTaken) return
    setSaving(true)
    try {
      await onSubmit({
        direction,
        seats,
        departure_date: date || null,
        departure_time: time || null,
        teams: kind === 'offer' ? teams.filter((id) => teamOptions.some((o) => o.id === id)).map(Number) : [],
        departure_location: location.trim() || null,
        notes: notes.trim() || null,
      })
    } finally {
      setSaving(false)
    }
  }

  const seatOptions = Array.from({ length: CARPOOL_MAX_SEATS }, (_, i) => i + 1).filter((n) => n >= minSeats)

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-sky-200 bg-card p-3.5 dark:border-sky-800">
      <p className="text-sm font-semibold text-foreground">
        {editing ? t(kind === 'offer' ? 'editOffer' : 'editRequest') : t(kind === 'offer' ? 'offerRide' : 'requestRide')}
        <span className="font-normal text-muted-foreground"> · {t(`tab_${direction}`)}</span>
      </p>

      {/* The day + clock of this way (Going or Return) — a return can be on
          another day than the way there (multi-day events). */}
      <div className="grid grid-cols-2 gap-3">
        <DatePicker id={`${idp}-date`} label={t('departureDate')} value={date} onChange={setDate} />
        <div className="space-y-1.5">
          <Label htmlFor={`${idp}-time`}>{t('departureTime')}</Label>
          <Input id={`${idp}-time`} type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      {dayTaken && (
        <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{t(kind === 'offer' ? 'sameDayOffer' : 'sameDayRequest', { way: t(`tab_${direction}`), day: `${formatWeekdayZurich(date)} ${formatDayMonthZurich(date)}` })}</span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idp}-seats`}>{t(kind === 'offer' ? 'seatsOffer' : 'seatsRequest')}</Label>
          <select
            id={`${idp}-seats`}
            value={seats}
            onChange={(e) => setSeats(Number(e.target.value))}
            className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 dark:bg-gray-800"
          >
            {seatOptions.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      {/* Which of the invited teams this ride is for (offers only). */}
      {kind === 'offer' && teamOptions.length >= 2 && (
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-foreground">{t('forTeams')}</span>
          <p className="text-xs text-muted-foreground">{t('forTeamsHint')}</p>
          <TeamPickerMulti teams={teamOptions} value={teams} onChange={setTeams} placeholder={t('addTeam')} />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={`${idp}-location`}>{t(kind === 'offer' ? 'departureLocation' : 'pickupLocation')}</Label>
        <Input
          id={`${idp}-location`}
          required={kind === 'offer'}
          maxLength={200}
          value={location}
          placeholder={t(kind === 'offer' ? 'departureLocationPlaceholder' : 'pickupLocationPlaceholder')}
          onChange={(e) => setLocation(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idp}-notes`}>{t('notes')}</Label>
        <Textarea id={`${idp}-notes`} rows={2} maxLength={500} value={notes} placeholder={t('notesPlaceholder')} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {/* Equal halves on a phone (same rule as the ride rows), right-aligned from sm. */}
      <div className="flex gap-2 sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1 sm:flex-none">{tc('cancel')}</Button>
        <Button type="submit" disabled={saving || dayTaken} className="flex-1 sm:flex-none">{editing ? tc('save') : t('post')}</Button>
      </div>
    </form>
  )
}
