import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Wallet } from 'lucide-react'
import { formatChf, type DuesNews } from '../../../hooks/useFinance'
import { formatDateCompactZurich, todayLocal } from '../../../utils/dateHelpers'

/**
 * "A bill is due" — the one news-feed row that is derived state rather than a
 * stored announcement/notification. It exists exactly while the member has a
 * payable invoice, so marking one paid on /finance/dues removes it without any
 * dismiss/read bookkeeping. Sits above the stored feed and does not consume one
 * of its slots, so an admin's pinned announcement still shows.
 */
export default function DuesNewsRow({ news }: { news: DuesNews }) {
  const { t } = useTranslation('finance')
  const navigate = useNavigate()
  const overdue = !!news.dueDate && news.dueDate < todayLocal()

  return (
    <div
      onClick={() => navigate('/finance/dues')}
      className="flex min-h-[44px] cursor-pointer items-center gap-3 border-b border-gray-100 bg-amber-50/50 px-4 py-2.5 last:border-b-0 hover:bg-amber-50 active:bg-amber-100 dark:border-gray-700 dark:bg-amber-900/15 dark:hover:bg-amber-900/25 dark:active:bg-amber-900/40"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
        <Wallet className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
          {t('newsTitle', { count: news.count, amount: formatChf(news.total) })}
        </p>
        <p className="truncate text-xs text-amber-700 dark:text-amber-300">{t('newsHint')}</p>
      </div>
      <span className={`shrink-0 whitespace-nowrap text-xs font-medium ${overdue ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
        {news.dueDate
          ? (overdue ? t('newsOverdue') : t('newsDue', { date: formatDateCompactZurich(news.dueDate) }))
          : ''}
      </span>
    </div>
  )
}
