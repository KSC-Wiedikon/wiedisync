// src/components/TypedConfirmDialog.tsx
//
// A confirmation dialog for actions that are worth a moment's friction: the
// user has to TYPE a literal (e.g. `DELETE`) before the destructive button
// unlocks. `useConfirm()` covers ordinary "are you sure" — this is for the ones
// you cannot undo, and it can host arbitrary content (the delete-impact table)
// between the message and the input, which is why it is built on `Dialog`
// rather than `AlertDialog`.
//
// Purpose-built modal, per CLAUDE.md: window.confirm / prompt are never used.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface TypedConfirmDialogProps {
  open: boolean
  title: string
  /** Rendered above the impact body. */
  message: string
  /** Arbitrary content between the message and the typed input — the impact table. */
  children?: ReactNode
  /** The literal the user must type. Compared case-SENSITIVELY, trimmed. */
  requiredText: string
  /** Label above the input, e.g. t('admin:explorerDangerTypeToConfirm'). */
  inputLabel: string
  /** Shown under the input while the text does not match. */
  mismatchHint: string
  confirmLabel: string
  cancelLabel: string
  /** Disables confirm regardless of the typed text (e.g. a RESTRICT blocker). */
  blocked?: boolean
  busy?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export default function TypedConfirmDialog({
  open,
  title,
  message,
  children,
  requiredText,
  inputLabel,
  mismatchHint,
  confirmLabel,
  cancelLabel,
  blocked,
  busy,
  onConfirm,
  onCancel,
}: TypedConfirmDialogProps) {
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()

  // Clear the typed literal on every open/close transition, so a previous
  // "DELETE" can never carry over into the next record's dialog and arm its
  // button before the operator has read anything. Done during render (the
  // documented "adjust state when a prop changes" pattern) rather than in an
  // effect — react-hooks/set-state-in-effect is an error in this repo.
  const [primedOpen, setPrimedOpen] = useState(open)
  if (primedOpen !== open) {
    setPrimedOpen(open)
    setTyped('')
  }

  useEffect(() => {
    if (!open) return undefined
    // Autofocus on tablet/desktop only — on a phone it throws up the keyboard
    // over the impact table the operator is meant to read first.
    if (typeof window === 'undefined' || window.innerWidth < 640) return undefined
    const id = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => window.clearTimeout(id)
  }, [open])

  const matches = typed.trim() === requiredText
  const canConfirm = matches && !blocked && !busy

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Escape and the overlay both cancel (Radix routes both through here).
        if (!next && !busy) onCancel()
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-destructive">{title}</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>

        {children}

        <div className="space-y-1.5">
          <Label htmlFor={inputId}>{inputLabel}</Label>
          <Input
            ref={inputRef}
            id={inputId}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canConfirm) {
                e.preventDefault()
                void onConfirm()
              }
            }}
            disabled={busy || blocked}
            // Keep the browser out of the way: this is a literal, not a word.
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="min-h-[44px] font-mono"
            aria-invalid={typed.length > 0 && !matches}
            aria-describedby={typed.length > 0 && !matches ? `${inputId}-hint` : undefined}
          />
          {typed.length > 0 && !matches && (
            <p id={`${inputId}-hint`} className="text-xs text-destructive">
              {mismatchHint}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => { void onConfirm() }}
            disabled={!canConfirm}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
