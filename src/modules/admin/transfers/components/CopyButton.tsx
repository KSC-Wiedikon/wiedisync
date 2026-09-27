import { useState } from 'react'
import { Button } from '@/components/ui/button'
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
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => { void copy() }}
      title={title}
      aria-label={title}
      // Dense `sm` tier (it sits in table cells). Icon-only it would be ~30px
      // wide, so the min-width keeps it square on the same scale (36 → 32).
      className="min-w-9 shrink-0 gap-1 px-2 text-gray-600 sm:min-w-8 dark:text-gray-300"
    >
      {copied
        ? <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" aria-hidden="true" />
        : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      {label && <span>{copied ? t('trCopied') : label}</span>}
    </Button>
  )
}
