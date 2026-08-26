import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/FormField'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { meetingTimeFromOffset } from '../utils/dateHelpers'

/**
 * Besammlung picker for games and trainings (migration 340).
 *
 * What is stored is an OFFSET in minutes before the start, not a clock time —
 * that is what keeps the meeting time correct after Swiss Volley moves a
 * fixture or slot-cascade regenerates a training. What a coach reads is still a
 * clock: `startClock` drives the live "→ 15:00" preview next to the picker, so
 * nobody has to do the subtraction in their head.
 *
 * ⚠ `''` is the empty sentinel, not `'0'`. Radix Select treats an empty-string
 * item value as "clear", and 0 minutes before is a legitimate answer meaning
 * "meet at the start time" — the two must not collapse into each other.
 */

/** Offsets a club actually uses. Covers warm-up through travel-together. */
const OFFSET_CHOICES = [0, 5, 10, 15, 20, 30, 45, 60, 75, 90, 120] as const

const NONE = '__none__'

interface MeetingTimeSelectProps {
  /** Minutes before the start; null/undefined = no meeting time. */
  value: number | null | undefined
  onChange: (value: number | null) => void
  /** The activity's start time ('HH:MM' or 'HH:MM:SS'), for the clock preview. */
  startClock?: string | null
  label?: string
  disabled?: boolean
  className?: string
}

export function MeetingTimeSelect({
  value,
  onChange,
  startClock,
  label,
  disabled,
  className,
}: MeetingTimeSelectProps) {
  const { t } = useTranslation('common')

  const selected = value === null || value === undefined ? NONE : String(value)
  const preview = meetingTimeFromOffset(startClock, value)

  // An offset restored from an older row (or typed into Directus directly) may
  // not be one of ours — keep it selectable instead of silently resetting it.
  const choices = value !== null && value !== undefined && !OFFSET_CHOICES.includes(value as never)
    ? [...OFFSET_CHOICES, value].sort((a, b) => a - b)
    : [...OFFSET_CHOICES]

  return (
    <FormField label={label ?? t('meetingTime')} className={className}>
      <div className="flex items-center gap-2">
        <Select
          value={selected}
          onValueChange={(v) => onChange(v === NONE ? null : Number(v))}
          disabled={disabled}
        >
          <SelectTrigger className="min-h-[44px] flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('meetingTimeNone')}</SelectItem>
            {choices.map((m) => (
              <SelectItem key={m} value={String(m)}>
                {t('minutesBefore', { count: m })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {preview && (
          <span className="shrink-0 text-sm tabular-nums text-gray-600 dark:text-gray-300" aria-hidden="true">
            → {preview}
          </span>
        )}
      </div>
    </FormField>
  )
}
