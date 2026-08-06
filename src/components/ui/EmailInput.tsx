// ── Email field ──────────────────────────────────────────────────────────────
//
// Trims + lowercases on blur via `normalizeEmail` (src/utils/contact.ts — the
// mirror of kscw-endpoints/src/normalize.js). An address that fails the shape
// check is kept as typed and flagged: `members.email` is also the login, so
// quietly discarding an admin's correction is worse than showing it is odd.

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { normalizeEmail } from '@/utils/contact'

export interface EmailInputProps {
  value: string | null | undefined
  onChange: (value: string | null) => void
  id?: string
  disabled?: boolean
  placeholder?: string
  className?: string
  onValidityChange?: (ok: boolean, reason?: string) => void
}

export default function EmailInput({
  value,
  onChange,
  id,
  disabled,
  placeholder,
  className,
  onValidityChange,
}: EmailInputProps) {
  const { t } = useTranslation('admin')
  const [text, setText] = useState(value ?? '')
  const [invalid, setInvalid] = useState(false)
  const lastEmitted = useRef<string | null>(value ?? null)

  useEffect(() => {
    const incoming = value ?? null
    if (incoming === lastEmitted.current) return
    lastEmitted.current = incoming
    setText(incoming ?? '')
    setInvalid(false)
  }, [value])

  function emit(next: string | null) {
    lastEmitted.current = next
    onChange(next)
  }

  function handleBlur() {
    const result = normalizeEmail(text)
    setInvalid(!result.ok)
    onValidityChange?.(result.ok, result.reason)
    if (result.ok) {
      setText(result.value ?? '')
      emit(result.value)
    } else {
      emit(text || null)
    }
  }

  return (
    <div className={className}>
      <Input
        id={id}
        type="email"
        inputMode="email"
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="none"
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid && id ? `${id}-error` : undefined}
        className="min-h-[44px] w-full"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          emit(e.target.value || null)
        }}
        onBlur={handleBlur}
      />
      {invalid && (
        <p id={id ? `${id}-error` : undefined} className="mt-1 text-xs text-destructive">
          {t('explorerFieldsInvalidEmail')}
        </p>
      )}
    </div>
  )
}
