import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Coffee, Copy, ExternalLink, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { handlePWAExternalClick } from '../../utils/pwa'
import { PAYREXX_URL, TWINT_NUMBER, useDonateVisible } from './donateConfig'

/**
 * "Buy the developer a coffee" — a page rather than a modal so it can be
 * reached from both the options menu and the changelog without stacking a
 * dialog on top of the already-open MoreSheet drawer.
 */
export default function SupportPage() {
  const { t } = useTranslation('support')
  const visible = useDonateVisible()

  // Not an authorisation boundary — no money moves through this app and the
  // links below are public URLs. It only keeps the ask off the screens of
  // juniors and of anyone the board has switched it off for.
  if (!visible) return <Navigate to="/" replace />

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(TWINT_NUMBER)
      toast.success(t('twint.copied'))
    } catch {
      toast.error(t('twint.copyFailed'))
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <Coffee className="h-6 w-6 text-brand-600 dark:text-gold-400" />
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t('lead')}</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('leadTwo')}</p>
      </header>

      <div className="space-y-4">
        {PAYREXX_URL && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('online.title')}</CardTitle>
              <CardDescription>{t('online.body')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full sm:w-auto">
                <a
                  href={PAYREXX_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => handlePWAExternalClick(e, PAYREXX_URL)}
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {t('online.action')}
                </a>
              </Button>
            </CardContent>
          </Card>
        )}

        {TWINT_NUMBER && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('twint.title')}</CardTitle>
              <CardDescription>{t('twint.body')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <span className="font-mono text-lg font-medium tracking-wide text-foreground">
                  {TWINT_NUMBER}
                </span>
                <Button variant="outline" onClick={copyNumber} className="sm:ml-auto">
                  <Copy className="mr-2 h-4 w-4" />
                  {t('twint.copy')}
                </Button>
              </div>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Smartphone className="h-3.5 w-3.5 shrink-0" />
                {t('twint.hint')}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <p className="mt-6 text-sm text-muted-foreground">{t('thanks')}</p>
      <p className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
        {t('disclaimer')}
      </p>
    </div>
  )
}
