/**
 * ConfirmProvider — mounts the branded confirm + prompt dialogs and publishes
 * the promise-based `confirm()` / `prompt()` functions on their contexts.
 *
 * Split out of `components/ConfirmProvider.tsx` (which keeps the contexts, the
 * `useConfirm` / `usePrompt` hooks and the option types) so neither module
 * exports both a React component and non-component values — required by
 * react-refresh/only-export-components (Fast Refresh).
 */

import { useCallback, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import ConfirmDialog from './ConfirmDialog'
import {
  ConfirmContext,
  PromptContext,
  type ConfirmFn,
  type ConfirmOptions,
  type PromptFn,
  type PromptOptions,
} from './ConfirmProvider'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

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
                aria-label={promptState?.message || promptState?.title || t('confirmTitle')}
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
