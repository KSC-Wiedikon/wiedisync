import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import ConfirmDialog from './ConfirmDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

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

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>
type PromptFn = (opts: PromptOptions) => Promise<string | null>

const ConfirmContext = createContext<ConfirmFn | null>(null)
const PromptContext = createContext<PromptFn | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common')

  const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null)
  const confirmResolver = useRef<((v: boolean) => void) | null>(null)

  const [promptState, setPromptState] = useState<PromptOptions | null>(null)
  const [promptValue, setPromptValue] = useState('')
  const promptResolver = useRef<((v: string | null) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((opts) => {
    setConfirmState(opts)
    return new Promise<boolean>((resolve) => { confirmResolver.current = resolve })
  }, [])

  const settleConfirm = useCallback((result: boolean) => {
    confirmResolver.current?.(result)
    confirmResolver.current = null
    setConfirmState(null)
  }, [])

  const prompt = useCallback<PromptFn>((opts) => {
    setPromptState(opts)
    setPromptValue(opts.defaultValue ?? '')
    return new Promise<string | null>((resolve) => { promptResolver.current = resolve })
  }, [])

  const settlePrompt = useCallback((result: string | null) => {
    promptResolver.current?.(result)
    promptResolver.current = null
    setPromptState(null)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      <PromptContext.Provider value={prompt}>
        {children}

        <ConfirmDialog
          open={confirmState !== null}
          title={confirmState?.title ?? t('confirmTitle')}
          message={confirmState?.message ?? ''}
          confirmLabel={confirmState?.confirmLabel}
          danger={confirmState?.danger}
          onConfirm={() => settleConfirm(true)}
          onClose={() => settleConfirm(false)}
        />

        <Dialog open={promptState !== null} onOpenChange={(o) => { if (!o) settlePrompt(null) }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{promptState?.title ?? t('confirmTitle')}</DialogTitle>
              <DialogDescription className="whitespace-pre-line break-words">
                {promptState?.message}
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => { e.preventDefault(); settlePrompt(promptValue) }}
            >
              <input
                autoFocus
                type="text"
                value={promptValue}
                placeholder={promptState?.placeholder}
                onChange={(e) => setPromptValue(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              />
              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" size="sm" onClick={() => settlePrompt(null)}>
                  {t('cancel')}
                </Button>
                <Button type="submit" size="sm">
                  {promptState?.confirmLabel ?? t('confirm')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </PromptContext.Provider>
    </ConfirmContext.Provider>
  )
}

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
