// ── Postal code field ────────────────────────────────────────────────────────
//
// ⚠ `members.plz` / `members.billing_plz` are VARCHAR and must stay that way:
// a leading zero is significant in plenty of countries and a numeric column
// would eat it. Nothing here coerces to a number, and nothing rejects a foreign
// format — the hint below the field is advice, never a gate.

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'

export interface PostalCodeInputProps {
  value: string | null | undefined
  onChange: (value: string | null) => void
  id?: string
  disabled?: boolean
  className?: string
  /** Default 'CH' — only affects the 4-digit hint, never the stored value. */
  countryHint?: string
}

export default function PostalCodeInput({
  value,
  onChange,
  id,
  disabled,
  className,
  countryHint = 'CH',
}: PostalCodeInputProps) {
  const { t } = useTranslation('admin')
  const [text, setText] = useState(value ?? '')
  const lastEmitted = useRef<string | null>(value ?? null)

  useEffect(() => {
    const incoming = value ?? null
    if (incoming === lastEmitted.current) return
    lastEmitted.current = incoming
    setText(incoming ?? '')
  }, [value])

  function emit(next: string | null) {
    lastEmitted.current = next
    onChange(next)
  }

  const showHint =
    countryHint.trim().toUpperCase() === 'CH' &&
    text.trim().length > 0 &&
    !/^[0-9]{4}$/.test(text.trim())
  const hintId = id ? `${id}-hint` : undefined

  return (
    <div className={className}>
      <Input
        id={id}
        type="text"
        // `numeric` (not `tel`) keeps the digit keypad without the phone glyphs,
        // while the text type preserves leading zeros and foreign formats.
        inputMode="numeric"
        pattern="[0-9A-Za-z ]*"
        autoComplete="postal-code"
        maxLength={10}
        disabled={disabled}
        placeholder="8003"
        aria-describedby={showHint ? hintId : undefined}
        className="min-h-[44px] w-full tabular-nums"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          emit(e.target.value.trim() || null)
        }}
      />
      {showHint && (
        <p id={hintId} className="mt-1 text-xs text-muted-foreground">
          {t('explorerFieldsPostalHint')}
        </p>
      )}
    </div>
  )
}
