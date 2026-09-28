import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

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
      <div className="flex max-w-lg items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm shadow-lg">
        <p className="text-muted-foreground">
          {t('noticeCookies')}{' '}
          <Link to="/datenschutz" className="underline hover:text-foreground">
            {t('noticeLink')}
          </Link>
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={dismiss}
          className="shrink-0"
        >
          OK
        </Button>
      </div>
    </div>
  )
}
