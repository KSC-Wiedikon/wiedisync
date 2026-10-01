import { useTranslation } from 'react-i18next'

// Direct line to the developer (Luca) for anyone stuck — shown on every auth
// screen (login, signup, set-password, pending) and as a footer in the app shell.
const SUPPORT_EMAIL = 'admin@wiedisync.kscw.ch'

export default function SupportContact({ className = '' }: { className?: string }) {
  const { t } = useTranslation('common')
  return (
    <p className={`text-center text-xs leading-relaxed text-muted-foreground ${className}`}>
      {t('supportContactLead')}{' '}
      <a
        href={`mailto:${SUPPORT_EMAIL}`}
        className="inline-block whitespace-nowrap py-1 font-medium text-primary hover:underline dark:text-brand-300"
      >
        {SUPPORT_EMAIL}
      </a>
      <br />
      <span className="italic">{t('supportContactLanguages')}</span>
    </p>
  )
}
