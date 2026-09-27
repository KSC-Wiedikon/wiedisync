import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { CarpoolDirection, CarpoolEntryInput, CarpoolKind } from './carpoolApi'
import { CARPOOL_DIRECTIONS, CARPOOL_MAX_SEATS } from './carpoolFormat'

interface CarpoolEntryFormProps {
  kind: CarpoolKind
  /** Present when editing an existing entry. */
  initial?: Partial<CarpoolEntryInput>
  /** Pre-fill for a new offer's time (e.g. the activity's meeting time). */
  suggestedTime?: string | null
  /** Seats already taken in this car — an offer cannot go below it. */
  minSeats?: number
  onSubmit: (input: CarpoolEntryInput) => Promise<void>
  onCancel: () => void
}

/**
 * Inline offer / request form. Rendered inside the banner rather than as a
 * dialog: the banner itself lives inside the game/training/event modals, and a
 * dialog on top of those fights their focus traps.
 */
export default function CarpoolEntryForm({ kind, initial, suggestedTime, minSeats = 1, onSubmit, onCancel }: CarpoolEntryFormProps) {
  const { t } = useTranslation('carpool')
  const { t: tc } = useTranslation('common')
  const editing = !!initial
  const [direction, setDirection] = useState<CarpoolDirection>(initial?.direction ?? 'both')
  const [seats, setSeats] = useState<number>(initial?.seats ?? (kind === 'offer' ? 3 : 1))
  const [time, setTime] = useState<string>(initial?.departure_time ?? suggestedTime ?? '')
  const [location, setLocation] = useState<string>(initial?.departure_location ?? '')
  const [notes, setNotes] = useState<string>(initial?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const idp = `carpool-${kind}`

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      await onSubmit({
        direction,
        seats,
        departure_time: time || null,
        departure_location: location.trim() || null,
        notes: notes.trim() || null,
      })
    } finally {
      setSaving(false)
    }
  }

  const seatOptions = Array.from({ length: CARPOOL_MAX_SEATS }, (_, i) => i + 1).filter((n) => n >= minSeats)

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-sky-200 bg-white p-3 dark:border-sky-800 dark:bg-gray-900">
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        {editing ? t(kind === 'offer' ? 'editOffer' : 'editRequest') : t(kind === 'offer' ? 'offerRide' : 'requestRide')}
      </p>

      <div className="space-y-1.5">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('directionLabel')}</span>
        <div role="radiogroup" aria-label={t('directionLabel')} className="grid grid-cols-3 gap-1.5">
          {CARPOOL_DIRECTIONS.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={direction === d}
              onClick={() => setDirection(d)}
              className={`min-h-[44px] rounded-md border px-2 text-sm font-medium transition-colors ${
                direction === d
                  ? 'border-sky-600 bg-sky-600 text-white dark:border-sky-500 dark:bg-sky-600'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {t(`direction_${d}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idp}-seats`}>{t(kind === 'offer' ? 'seatsOffer' : 'seatsRequest')}</Label>
          <select
            id={`${idp}-seats`}
            value={seats}
            onChange={(e) => setSeats(Number(e.target.value))}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm dark:bg-gray-800"
          >
            {seatOptions.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idp}-time`}>{t('departureTime')}</Label>
          <Input id={`${idp}-time`} type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} className="h-11" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idp}-location`}>{t(kind === 'offer' ? 'departureLocation' : 'pickupLocation')}</Label>
        <Input
          id={`${idp}-location`}
          required={kind === 'offer'}
          maxLength={200}
          value={location}
          placeholder={t(kind === 'offer' ? 'departureLocationPlaceholder' : 'pickupLocationPlaceholder')}
          onChange={(e) => setLocation(e.target.value)}
          className="h-11"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idp}-notes`}>{t('notes')}</Label>
        <Textarea id={`${idp}-notes`} rows={2} maxLength={500} value={notes} placeholder={t('notesPlaceholder')} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>{tc('cancel')}</Button>
        <Button type="submit" disabled={saving}>{editing ? tc('save') : t('post')}</Button>
      </div>
    </form>
  )
}
