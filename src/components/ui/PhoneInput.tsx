// ── Phone number field with an international prefix picker ───────────────────
//
// Two controls, one value: a searchable calling-code combobox and the national
// part. The stored value is whatever `normalizePhone` returns — canonical Swiss
// '+41 79 123 45 67' or compact E.164 '+436501234567'.
//
// ⚠ The parsing is NOT reimplemented here. `src/utils/contact.ts` is a
// byte-behaviour mirror of `kscw-endpoints/src/normalize.js` with a parity test;
// this component only composes '+<dial><national>' and asks that helper.
//
// When normalisation fails the raw text is kept and reported — an admin who
// typed a real but odd number must never have it silently dropped.

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command'
import { DIAL_CODES, FAVORITE_DIAL_CODES, splitDialCode } from '@/components/ui/dialCodes'
import { normalizePhone } from '@/utils/contact'
import { countryLabel } from '@/utils/countries'
import { cn } from '@/lib/utils'

export interface PhoneInputProps {
  value: string | null | undefined
  /** Canonical value from normalizePhone on blur, or the raw text while typing. */
  onChange: (value: string | null) => void
  id?: string
  disabled?: boolean
  placeholder?: string
  className?: string
  'aria-label'?: string
  /** Fired on blur with the normalizePhone verdict so the caller can style/report. */
  onValidityChange?: (ok: boolean, reason?: string) => void
}

/** '+41' + '79 123 45 67' → '+4179 123 45 67'; a pasted E.164 string is left alone. */
function compose(dial: string, national: string): string {
  const n = national.trim()
  if (!n) return ''
  if (n.startsWith('+') || n.startsWith('00')) return n
  return `+${dial}${n}`
}

export default function PhoneInput({
  value,
  onChange,
  id,
  disabled,
  placeholder,
  className,
  'aria-label': ariaLabel,
  onValidityChange,
}: PhoneInputProps) {
  const { t } = useTranslation(['admin', 'common'])
  const initial = splitDialCode(value)
  const [dial, setDial] = useState(initial.dial)
  const [national, setNational] = useState(initial.national)
  const [invalid, setInvalid] = useState(false)
  const [open, setOpen] = useState(false)

  // Everything this component emits is recorded here, so the resync effect can
  // tell "the record was reloaded underneath us" (resplit) from "our own
  // keystroke came back through the parent's draft state" (leave the caret be).
  const lastEmitted = useRef<string | null>(value ?? null)

  useEffect(() => {
    const incoming = value ?? null
    if (incoming === lastEmitted.current) return
    lastEmitted.current = incoming
    const next = splitDialCode(incoming)
    setDial(next.dial)
    setNational(next.national)
    setInvalid(false)
  }, [value])

  function emit(next: string | null) {
    lastEmitted.current = next
    onChange(next)
  }

  function handleDial(nextDial: string) {
    setDial(nextDial)
    setOpen(false)
    emit(compose(nextDial, national) || null)
  }

  function handleNational(raw: string) {
    setNational(raw)
    // Raw while typing — rewriting mid-entry fights the caret and mangles a
    // number the member is still halfway through.
    emit(compose(dial, raw) || null)
  }

  function handleBlur() {
    const composed = compose(dial, national)
    const result = normalizePhone(composed)
    setInvalid(!result.ok)
    onValidityChange?.(result.ok, result.reason)
    if (result.ok) {
      emit(result.value)
      const next = splitDialCode(result.value)
      setDial(next.dial)
      setNational(next.national)
    } else {
      emit(composed || null)
    }
  }

  const selected = DIAL_CODES.find((d) => d.dial === dial)
  // Pinned group keeps FAVORITE_DIAL_CODES' own order (Switzerland first — it is
  // the default and covers most of the register), not the alphabetical one.
  const favourites = FAVORITE_DIAL_CODES
    .map((code) => DIAL_CODES.find((d) => d.code === code))
    .filter((d): d is (typeof DIAL_CODES)[number] => Boolean(d))
  const rest = DIAL_CODES.filter((d) => !FAVORITE_DIAL_CODES.includes(d.code))

  function renderOption(code: string, dialValue: string, flag: string, name: string) {
    return (
      <CommandItem
        key={code}
        // cmdk filters on this string — the ISO code, the localized name, the
        // English name and the digits all find the row.
        value={`${code} ${name} ${countryLabel(code)} +${dialValue} ${dialValue}`}
        onSelect={() => handleDial(dialValue)}
        className={cn(
          'min-h-[44px] border-l-2 px-3',
          dialValue === dial
            ? 'border-l-primary bg-primary/10 font-semibold text-primary dark:bg-primary/30 dark:text-primary-foreground'
            : 'border-l-transparent',
        )}
      >
        <Check className={cn('h-4 w-4 shrink-0', dialValue === dial ? 'opacity-100' : 'opacity-0')} />
        <span aria-hidden="true">{flag}</span>
        <span className="flex-1 truncate">{countryLabel(code) || name}</span>
        <span className="tabular-nums text-muted-foreground">+{dialValue}</span>
      </CommandItem>
    )
  }

  return (
    <div className={className}>
      <div className="flex items-stretch gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={t('admin:explorerFieldsDialCode')}
              className="flex min-h-[44px] shrink-0 items-center gap-1 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span aria-hidden="true">{selected?.flag ?? '🏳️'}</span>
              <span className="tabular-nums">+{dial}</span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0">
            <Command>
              <CommandInput placeholder={t('common:search')} />
              <CommandList>
                <CommandEmpty>{t('common:noResults')}</CommandEmpty>
                <CommandGroup>
                  {favourites.map((d) => renderOption(d.code, d.dial, d.flag, d.name))}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup>
                  {rest.map((d) => renderOption(d.code, d.dial, d.flag, d.name))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid && id ? `${id}-error` : undefined}
          disabled={disabled}
          placeholder={placeholder ?? '79 123 45 67'}
          className="min-h-[44px] flex-1"
          value={national}
          onChange={(e) => handleNational(e.target.value)}
          onBlur={handleBlur}
        />
      </div>
      {invalid && (
        <p id={id ? `${id}-error` : undefined} className="mt-1 text-xs text-destructive">
          {t('admin:explorerFieldsInvalidPhone')}
        </p>
      )}
    </div>
  )
}
