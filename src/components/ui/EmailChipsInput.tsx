// ── Recipient field with chips ───────────────────────────────────────────────
//
// Outlook-style To/Cc/Bcc input: paste a block of contacts and each one becomes
// its own removable chip. Commits on Enter, Tab, comma and semicolon; Backspace
// on an empty input takes the last chip back for editing.
//
// The value stays a comma-separated string so callers (and the send endpoint)
// keep working with the same shape they always had — see emailChips.ts for the
// parsing rules and why `Name <a@b.ch>` must be normalised before sending.

import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { parseAddressList, serializeChips, type AddressChip } from '@/components/ui/emailChips'

export interface EmailChipsInputProps {
  /** Comma-separated recipient list. */
  value: string
  onChange: (value: string) => void
  id?: string
  disabled?: boolean
  /** Shown only while the field is empty — with chips present it is noise. */
  placeholder?: string
  'aria-label'?: string
  className?: string
}

export default function EmailChipsInput({
  value,
  onChange,
  id,
  disabled,
  placeholder,
  'aria-label': ariaLabel,
  className,
}: EmailChipsInputProps) {
  const { t } = useTranslation('common')
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const chips = useMemo(() => parseAddressList(value), [value])

  const emit = (next: AddressChip[]) => onChange(serializeChips(next))

  /** Fold `extra` (typed or pasted text) into the chips. Returns what could not
   *  be turned into a chip and should stay in the input. */
  const commit = (extra: string): string => {
    const parsed = parseAddressList(extra)
    if (parsed.length === 0) return ''
    const known = new Set(chips.map((c) => c.email.toLowerCase()))
    const added = parsed.filter((c) => !known.has(c.email.toLowerCase()))
    if (added.length > 0) emit([...chips, ...added])
    return ''
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      if (!text.trim()) {
        // Nothing to commit. Enter still must not bubble into a submit, but Tab
        // and the separators stay ordinary keystrokes.
        if (e.key === 'Enter') e.preventDefault()
        return
      }
      e.preventDefault()
      setText(commit(text))
      return
    }
    if (e.key === 'Tab' && text.trim()) {
      e.preventDefault()
      setText(commit(text))
      return
    }
    if (e.key === 'Backspace' && !text && chips.length > 0) {
      // Take the last chip back into the input rather than deleting it
      // outright — a mistyped address is nearly always meant to be fixed.
      e.preventDefault()
      const last = chips[chips.length - 1]
      emit(chips.slice(0, -1))
      setText(last.email)
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text')
    if (!pasted) return
    e.preventDefault()
    const combined = text + pasted
    const parsed = parseAddressList(combined)
    // A single unusable fragment (someone pasting half an address) is left in
    // the input to finish typing instead of becoming a red chip straight away.
    if (parsed.length === 1 && parsed[0].invalid) {
      setText(combined.trim())
      return
    }
    setText(commit(combined))
  }

  const remove = (idx: number) => {
    emit(chips.filter((_, i) => i !== idx))
    inputRef.current?.focus()
  }

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className={cn(
        'mt-1 flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-gray-300 bg-white p-1.5 text-sm focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500 dark:border-gray-600 dark:bg-gray-900',
        disabled && 'opacity-60',
        className,
      )}
    >
      {chips.map((chip, i) => (
        <span
          key={`${chip.email}-${i}`}
          title={chip.invalid ? t('emailChipsInvalid') : (chip.name ? `${chip.name} <${chip.email}>` : chip.email)}
          className={cn(
            'inline-flex min-h-8 max-w-full items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs',
            chip.invalid
              ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300'
              : 'border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200',
          )}
        >
          <span className="truncate">{chip.email}</span>
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => { e.stopPropagation(); remove(i) }}
            aria-label={t('emailChipsRemove')}
            title={t('emailChipsRemove')}
            className={cn(
              'rounded p-1',
              chip.invalid
                ? 'text-red-500 hover:bg-red-100 hover:text-red-800 dark:hover:bg-red-900 dark:hover:text-red-200'
                : 'text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200',
            )}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="email"
        autoComplete="off"
        aria-label={ariaLabel}
        disabled={disabled}
        value={text}
        placeholder={chips.length === 0 ? (placeholder ?? t('emailChipsPlaceholder')) : undefined}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={() => setText(commit(text))}
        className="min-w-[10rem] flex-1 bg-transparent px-1 py-1 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-gray-100 dark:placeholder:text-gray-500"
      />
    </div>
  )
}
