import { useTranslation } from 'react-i18next'
import { X, type LucideIcon } from 'lucide-react'
import type { TransferMember, TransferStatus } from '../types'

const STATUS_ON_CLASS: Record<TransferStatus, string> = {
  done: 'border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300',
  pending: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  // Slate, not green: "we decided there is nothing to do" must not look like
  // "the certificate arrived". One is a conclusion, the other is evidence.
  not_needed: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-200',
}

/**
 * One of the three transfer-status toggles.
 *
 * ⚠ It is a standalone component and not a helper inside TransferStatusCell
 * because it has TWO independent callers: the status cell in the worklist and
 * the FoO-conflict table in Diagnostics, which offers only the `not_needed` /
 * `pending` pair. Inlining it into either one silently forks the control.
 *
 * The label is hidden below `sm` so the button is icon-only on a phone: the
 * `whitespace-nowrap` label was the single largest contributor to the Status
 * column's width ('Non necessario', 'Pas nécessaire' ≈ 122px each). `aria-label`
 * and `title` carry the full label at every width, so nothing is lost to a
 * screen reader or a hover. Reference impl: RosterEditor.tsx:488-493.
 */
export function TransferStatusButton({ member, value, label, icon: Icon, disabled, onSelect }: {
  member: TransferMember
  value: TransferStatus
  label: string
  icon: LucideIcon
  disabled: boolean
  onSelect: (m: TransferMember, next: TransferStatus) => void
}) {
  const on = member.transfer_status === value
  return (
    <button
      type="button"
      onClick={() => { onSelect(member, value) }}
      disabled={disabled}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50 sm:min-h-0 sm:min-w-0 ${
        on
          ? STATUS_ON_CLASS[value]
          : 'border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

/**
 * Clears a stored `transfer_status` back to NULL.
 *
 * ⚠ Same two callers as TransferStatusButton — this markup was duplicated
 * verbatim in the status cell and the conflict table, so it is one component
 * now. NULL is not "not needed": it means nobody has decided yet, which is what
 * puts the row back on the worklist.
 */
export function ClearStatusButton({ disabled, onClear }: { disabled: boolean; onClear: () => void }) {
  const { t } = useTranslation('admin')
  return (
    <button
      type="button"
      onClick={() => { onClear() }}
      disabled={disabled}
      aria-label={t('trClearStatus')}
      title={t('trClearStatus')}
      // Icon-only, so BOTH axes carry the 44px floor (the original was 44px tall
      // and ~30px wide).
      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-gray-200 px-2 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-50 sm:min-h-0 sm:min-w-0 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
    >
      <X className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  )
}
