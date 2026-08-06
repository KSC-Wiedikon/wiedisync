// ── Swiss AHV/AVS number field ───────────────────────────────────────────────
//
// Formats to '756.1234.5678.97' as digits are typed and verifies the EAN-13
// check digit on blur via `normalizeAhv` (src/utils/contact.ts — the mirror of
// kscw-endpoints/src/normalize.js; the maths is never reimplemented here).
//
// A failing checksum keeps the raw text and says so. An AHV number is copied off
// a document by hand, and a silent revert would look like the field "didn't
// save" while the real problem is one transposed digit.

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { normalizeAhv } from '@/utils/contact'

export interface AhvInputProps {
  value: string | null | undefined
  onChange: (value: string | null) => void
  id?: string
  disabled?: boolean
  className?: string
  onValidityChange?: (ok: boolean, reason?: string) => void
}

/** 13 digits → '756.1234.5678.97'. Partial input keeps only the dots it has earned. */
function formatAhvDigits(digits: string): string {
  const d = digits.slice(0, 13)
  return [d.slice(0, 3), d.slice(3, 7), d.slice(7, 11), d.slice(11, 13)]
    .filter((part) => part.length > 0)
    .join('.')
}

export default function AhvInput({
  value,
  onChange,
  id,
  disabled,
  className,
  onValidityChange,
}: AhvInputProps) {
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

  function handleChange(raw: string) {
    // Anything that is not digits/dots/spaces is a legacy or pasted oddity —
    // show it back verbatim rather than silently eating characters. The blur
    // check will flag it.
    if (/[^0-9. ]/.test(raw)) {
      setText(raw)
      emit(raw || null)
      return
    }
    const formatted = formatAhvDigits(raw.replace(/\D/g, ''))
    setText(formatted)
    emit(formatted || null)
  }

  function handleBlur() {
    const result = normalizeAhv(text)
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
        type="text"
        inputMode="numeric"
        autoComplete="off"
        // 13 digits + 3 dots.
        maxLength={16}
        disabled={disabled}
        placeholder="756.1234.5678.97"
        aria-invalid={invalid || undefined}
        aria-describedby={invalid && id ? `${id}-error` : undefined}
        className="min-h-[44px] w-full tabular-nums"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
      />
      {invalid && (
        <p id={id ? `${id}-error` : undefined} className="mt-1 text-xs text-destructive">
          {t('explorerFieldsInvalidAhv')}
        </p>
      )}
    </div>
  )
}
