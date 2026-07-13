import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

const STORAGE_KEY = 'wiedisync-privacy-noticed'

export default function PrivacyNotice() {
  const { t } = useTranslation('legal')
  // Read localStorage in a lazy initialiser (once, on mount) instead of an effect
  // that immediately setStates — same result, one render less.
  const [visible, setVisible] = useState(() => {
    try {
      return !localStorage.getItem(STORAGE_KEY)
    } catch {
      // Storage disabled (e.g. Safari private mode) — show the notice each time.
      return true
    }
  })

  if (!visible) return null

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // Storage disabled — dismiss for this session only.
    }
    setVisible(false)
  }

  return (
    <div className="fixed bottom-16 left-0 right-0 z-50 flex items-center justify-center px-4 sm:bottom-4">
      <div className="flex max-w-lg items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-800">
        <p className="text-gray-600 dark:text-gray-300">
          {t('noticeCookies')}{' '}
          <Link to="/datenschutz" className="underline hover:text-gray-900 dark:hover:text-white">
            {t('noticeLink')}
          </Link>
        </p>
        <button
          onClick={dismiss}
          className="shrink-0 rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
        >
          OK
        </button>
      </div>
    </div>
  )
}
