import { createContext, useContext } from 'react'

/**
 * App-wide replacement for the native window.confirm / window.prompt dialogs.
 * Both are promise-based so call sites keep their `if (!(await confirm(...)))
 * return` control flow, but render as branded shadcn modals (themed, dark-mode
 * aware, accessible) instead of the unstyled browser popups.
 *
 * Usage:
 *   const confirm = useConfirm()
 *   if (!(await confirm({ message: t('confirmDelete'), danger: true }))) return
 *
 *   const prompt = usePrompt()
 *   const url = await prompt({ message: t('linkUrl'), defaultValue: previous })
 *   if (url === null) return   // cancelled
 *
 * The provider COMPONENT (which renders the dialogs) lives in
 * `components/ConfirmDialogProvider.tsx` — a module may export either React
 * components or non-components, not both (react-refresh / Fast Refresh).
 */

export interface ConfirmOptions {
  /** Optional heading; falls back to a generic "Please confirm". */
  title?: string
  message: string
  /** Override the confirm button label (defaults to "Confirm"). */
  confirmLabel?: string
  /** Red confirm button for destructive actions. */
  danger?: boolean
}

export interface PromptOptions {
  title?: string
  message: string
  defaultValue?: string
  confirmLabel?: string
  placeholder?: string
}

export type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>
export type PromptFn = (opts: PromptOptions) => Promise<string | null>

export const ConfirmContext = createContext<ConfirmFn | null>(null)
export const PromptContext = createContext<PromptFn | null>(null)

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx
}

export function usePrompt(): PromptFn {
  const ctx = useContext(PromptContext)
  if (!ctx) throw new Error('usePrompt must be used within ConfirmProvider')
  return ctx
}
