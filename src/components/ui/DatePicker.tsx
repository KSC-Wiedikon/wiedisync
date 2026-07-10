import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Calendar as CalendarIcon } from 'lucide-react'
import { parseISO } from 'date-fns'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getLocale, toDateKey } from '../../utils/dateUtils'
import { formatDateZurich } from '../../utils/dateHelpers'

interface DatePickerProps {
  value: string
  onChange: (value: string) => void
  label?: string
  error?: string
  helperText?: string
  min?: string
  max?: string
  placeholder?: string
  id?: string
  required?: boolean
  disabled?: boolean
  className?: string
  /** Earliest year shown in the year dropdown. Defaults to 1900 (needed for birthdates).
   *  Clamped to the selected date's year so editing an older value stays selectable. */
  fromYear?: number
}

export default function DatePicker({
  value,
  onChange,
  label,
  error,
  helperText,
  min,
  max,
  placeholder,
  id,
  disabled,
  className = '',
  fromYear,
}: DatePickerProps) {
  const { t, i18n } = useTranslation('common')
  const lang = i18n.language
  const [open, setOpen] = useState(false)

  const selectedDate = value ? parseISO(value) : undefined
  const [month, setMonth] = useState<Date>(
    selectedDate ?? new Date(),
  )

  // Sync month when value changes externally
  useEffect(() => {
    if (selectedDate) setMonth(selectedDate)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const minDate = min ? parseISO(min) : undefined
  const maxDate = max ? parseISO(max) : undefined

  const startYear =
    fromYear != null
      ? Math.min(fromYear, selectedDate ? selectedDate.getFullYear() : fromYear)
      : 1900

  const displayValue = selectedDate
    ? formatDateZurich(selectedDate)
    : ''

  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)
  const errorId = error && inputId ? `${inputId}-error` : undefined
  const helpId = helperText && !error && inputId ? `${inputId}-help` : undefined
  const locale = getLocale(lang)

  function handleSelect(date: Date | undefined) {
    if (date) {
      onChange(toDateKey(date))
      setOpen(false)
    }
  }

  function handleToday() {
    const today = new Date()
    onChange(toDateKey(today))
    setMonth(today)
    setOpen(false)
  }

  function handleClear() {
    onChange('')
    setOpen(false)
  }

  return (
    <div>
      {label && (
        <Label htmlFor={inputId} className="mb-1.5">
          {label}
        </Label>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={inputId}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId || helpId}
            data-testid="datepicker-trigger"
            className={cn(
              'flex min-h-[44px] min-w-[140px] w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-left text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
              error && 'border-destructive',
              className,
            )}
          >
            <span className={displayValue ? '' : 'text-muted-foreground'}>
              {displayValue || placeholder || t('selectDate')}
            </span>
            <CalendarIcon className="h-4 w-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            captionLayout="dropdown"
            showOutsideDays={false}
            selected={selectedDate}
            onSelect={handleSelect}
            month={month}
            onMonthChange={setMonth}
            locale={locale}
            weekStartsOn={1}
            startMonth={new Date(startYear, 0)}
            endMonth={new Date(Math.max(2035, new Date().getFullYear() + 10), 11)}
            disabled={(date) => {
              if (minDate && toDateKey(date) < toDateKey(minDate)) return true
              if (maxDate && toDateKey(date) > toDateKey(maxDate)) return true
              return false
            }}
          />
          <div className={cn('border-t p-2 flex', selectedDate ? 'justify-between' : 'justify-end')}>
            {selectedDate && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClear}
                type="button"
              >
                {t('clear')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToday}
              type="button"
            >
              {t('today')}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {error && <p id={errorId} className="mt-1 text-xs text-destructive">{error}</p>}
      {helperText && !error && <p id={helpId} className="mt-1 text-xs text-muted-foreground">{helperText}</p>}
    </div>
  )
}
