import { useTranslation } from 'react-i18next'

// Shared between the member upload page (My submissions) and the finance
// Expenses tab — lives in its own file so both stay fast-refresh clean.

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  paid: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

export function ExpenseStatusBadge({ status }: { status?: string | null }) {
  const { t } = useTranslation('finance')
  const s = status || 'pending'
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[s] ?? STATUS_BADGE.pending}`}>
      {t(`expenseStatus_${s}`, { defaultValue: s })}
    </span>
  )
}
