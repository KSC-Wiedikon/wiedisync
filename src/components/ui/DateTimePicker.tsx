import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import DatePicker from '@/components/ui/DatePicker'

interface DateTimePickerProps {
  /** Local datetime string `YYYY-MM-DDTHH:mm` (same shape a native
   *  `<input type="datetime-local">` produces), or '' when empty. */
  value: string
  /** Emits `YYYY-MM-DDTHH:mm` (or '' when the date is cleared) — a drop-in
   *  replacement for a native datetime-local `onChange` value. */
  onChange: (value: string) => void
  label?: string
  error?: string
  helperText?: string
  /** Lower/upper bounds — accepts a datetime-local or a date-only string;
   *  only the date part gates the calendar. */
  min?: string
  max?: string
  id?: string
  disabled?: boolean
  className?: string
}

/** Branded datetime picker: the shared `DatePicker` calendar plus a time field,
 *  emitting the same `YYYY-MM-DDTHH:mm` string a native datetime-local input
 *  would. Standardizes date entry away from the browser's native picker. */
export default function DateTimePicker({
  value,
  onChange,
  label,
  error,
  helperText,
  min,
  max,
  id,
  disabled,
  className,
}: DateTimePickerProps) {
  const { t } = useTranslation('common')
  const datePart = value ? value.split('T')[0] : ''
  const timePart = value && value.includes('T') ? value.split('T')[1].slice(0, 5) : ''

  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)
  const errorId = error && inputId ? `${inputId}-error` : undefined
  const helpId = helperText && !error && inputId ? `${inputId}-help` : undefined

  function emit(nextDate: string, nextTime: string) {
    if (!nextDate) {
      onChange('')
      return
    }
    onChange(`${nextDate}T${nextTime || '00:00'}`)
  }

  return (
    <div className={className}>
      {label && (
        <Label htmlFor={inputId} className="mb-1.5">
          {label}
        </Label>
      )}
      {/* `flex-wrap`: the date field alone has a 140px floor and the time field
          is another 120px, so side by side they never fit a narrow column (the
          member Danger zone's action cell on a phone). Wrapping drops the time
          under the date instead of overflowing the container. */}
      <div className="flex flex-wrap gap-2">
        {/* ⚠ An explicit basis, and deliberately NO `min-w-0`: the date box
            carries a 140px floor, so with a zero basis flexbox packs both
            fields onto one line and lets the date box overflow its own flex
            item instead of wrapping. The basis is also this control's PREFERRED
            width — 11rem + gap + the 7.5rem time field is what an auto-sized
            parent (a table cell, a flex row) hands it, and anything less makes
            the time field wrap on a desktop that had room for both. */}
        <div className="flex-1 basis-44">
          <DatePicker
            id={inputId}
            value={datePart}
            onChange={(d) => emit(d, timePart)}
            min={min?.split('T')[0]}
            max={max?.split('T')[0]}
            disabled={disabled}
            className={error ? 'border-destructive' : undefined}
          />
        </div>
        <Input
          type="time"
          aria-label={t('time')}
          value={timePart}
          disabled={disabled || !datePart}
          onChange={(e) => emit(datePart, e.target.value)}
          className={`min-h-[44px] w-[7.5rem] shrink-0 dark:bg-gray-800${error ? ' border-destructive' : ''}`}
        />
      </div>
      {error && <p id={errorId} className="mt-1 text-xs text-destructive">{error}</p>}
      {helperText && !error && <p id={helpId} className="mt-1 text-xs text-muted-foreground">{helperText}</p>}
    </div>
  )
}
