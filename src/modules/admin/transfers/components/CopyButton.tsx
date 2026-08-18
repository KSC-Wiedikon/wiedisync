import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, Copy } from 'lucide-react'

/**
 * Copy-to-clipboard button. Icon-only when no `label` is given, so it fits
 * inline next to a value inside a table cell.
 *
 * The transient tick is local state rather than a toast: the three things this
 * page copies (player number, address, request text) are often copied one after
 * another, and three stacked toasts obscure the table they came from. A FAILED
 * copy still toasts — clipboard access can be denied (insecure context, browser
 * permission) and silence there would leave the admin pasting nothing.
 */
export function CopyButton({ value, title, label }: { value: string; title: string; label?: string }) {
  const { t } = useTranslation('admin')
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      // Cosmetic only — if the row unmounts first React drops the update.
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error(t('trCopyFailed'))
    }
  }
  return (
    <button
      type="button"
      onClick={() => { void copy() }}
      title={title}
      aria-label={title}
      // ⚠ BOTH axes get the 44px floor. Icon-only this button is 44px tall but
      // only ~30px wide (a 14px icon between two 8px paddings), which fails the
      // touch-target rule on the short axis. Reference impl: RosterEditor.tsx:556
      // sizes both (`h-11 w-11 … sm:h-8 sm:w-8`).
      className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 sm:min-h-0 sm:min-w-0 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
    >
      {copied
        ? <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" aria-hidden="true" />
        : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      {label && <span>{copied ? t('trCopied') : label}</span>}
    </button>
  )
}
