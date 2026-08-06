// ── IBAN field ───────────────────────────────────────────────────────────────
//
// Uppercases as typed, groups into blocks of four for reading, and verifies the
// mod-97 checksum on blur via `normalizeIbanChecked` (src/utils/contact.ts —
// the mirror of kscw-endpoints/src/normalize.js).
//
// ⚠ The grouping is DISPLAY ONLY. The stored value is the compact uppercase
// string, which is what the finance QR-bill payload and ClubDesk both expect.

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { normalizeIbanChecked } from '@/utils/contact'

export interface IbanInputProps {
  value: string | null | undefined
  onChange: (value: string | null) => void
  id?: string
  disabled?: boolean
  className?: string
  onValidityChange?: (ok: boolean, reason?: string) => void
}

/** 'CH9300762011623852957' → 'CH93 0076 2011 6238 5295 7'. Display only. */
function groupIban(compact: string): string {
  return compact.replace(/(.{4})/g, '$1 ').trim()
}

/** Strip separators, uppercase — the shape actually stored. */
function compactIban(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export default function IbanInput({
  value,
  onChange,
  id,
  disabled,
  className,
  onValidityChange,
}: IbanInputProps) {
  const { t } = useTranslation('admin')
  const [text, setText] = useState(() => groupIban(compactIban(value ?? '')))
  const [invalid, setInvalid] = useState(false)
  const lastEmitted = useRef<string | null>(value ?? null)

  useEffect(() => {
    const incoming = value ?? null
    if (incoming === lastEmitted.current) return
    lastEmitted.current = incoming
    setText(groupIban(compactIban(incoming ?? '')))
    setInvalid(false)
  }, [value])

  function emit(next: string | null) {
    lastEmitted.current = next
    onChange(next)
  }

  function handleChange(raw: string) {
    const compact = compactIban(raw)
    setText(groupIban(compact))
    emit(compact || null)
  }

  function handleBlur() {
    const result = normalizeIbanChecked(text)
    setInvalid(!result.ok)
    onValidityChange?.(result.ok, result.reason)
    if (result.ok) {
      setText(result.value ? groupIban(result.value) : '')
      emit(result.value)
    } else {
      emit(compactIban(text) || null)
    }
  }

  return (
    <div className={className}>
      <Input
        id={id}
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="characters"
        // 34 IBAN characters + 8 grouping spaces.
        maxLength={42}
        disabled={disabled}
        placeholder="CH93 0076 2011 6238 5295 7"
        aria-invalid={invalid || undefined}
        aria-describedby={invalid && id ? `${id}-error` : undefined}
        className="min-h-[44px] w-full font-mono tabular-nums"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
      />
      {invalid && (
        <p id={id ? `${id}-error` : undefined} className="mt-1 text-xs text-destructive">
          {t('explorerFieldsInvalidIban')}
        </p>
      )}
    </div>
  )
}
