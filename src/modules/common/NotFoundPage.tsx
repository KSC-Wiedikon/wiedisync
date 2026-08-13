import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'

/**
 * Catch-all route target.
 *
 * This app had NO catch-all, so any unmatched path rendered a literally blank page —
 * no message, no navigation, nothing to click. That is not hypothetical: the route
 * table above it enumerates `terminplanung/:token`, `terminplanung/club/:token` and
 * `terminplanung/bb/:token` one by one, each added after a pasted opponent link turned
 * into a blank screen for someone outside the club.
 *
 * Rendered INSIDE `<Layout>` so the header and navigation survive — a member who
 * mistypes a URL should be one click from where they meant to go, not stranded.
 */
export default function NotFoundPage() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-6xl font-bold text-muted-foreground/40" aria-hidden="true">
        404
      </p>
      <h1 className="text-2xl font-bold text-foreground">{t('notFoundTitle')}</h1>
      <p className="max-w-prose text-muted-foreground">{t('notFoundText')}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <Button asChild>
          <Link to="/">{t('notFoundHome')}</Link>
        </Button>
        {/* -1 rather than a fixed route: the common case is a mistyped or stale link
            arrived at from somewhere real, and back is where they actually want to go. */}
        <Button variant="outline" onClick={() => navigate(-1)}>
          {t('notFoundBack')}
        </Button>
      </div>
    </div>
  )
}
