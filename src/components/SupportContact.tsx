import { useTranslation } from 'react-i18next'

// Direct line to the developer (Luca) for anyone stuck — shown on every auth
// screen (login, signup, set-password, pending) and as a footer in the app shell.
const PHONE_DISPLAY = '+41 79 789 18 17'
const PHONE_E164 = '+41797891817'

const CHANNELS = [
  { label: 'WhatsApp', href: `https://wa.me/${PHONE_E164.slice(1)}` },
  { label: 'Signal', href: `https://signal.me/#p/${PHONE_E164}` },
  { label: 'Telegram', href: `https://t.me/${PHONE_E164}` },
]

export default function SupportContact({ className = '' }: { className?: string }) {
  const { t } = useTranslation('common')
  return (
    <p className={`text-center text-xs leading-relaxed text-muted-foreground ${className}`}>
      {t('supportContactLead')}{' '}
      <a href={`tel:${PHONE_E164}`} className="whitespace-nowrap font-medium text-foreground hover:underline">
        {PHONE_DISPLAY}
      </a>
      <br />
      {CHANNELS.map((c, i) => (
        <span key={c.label}>
          {i > 0 && ' · '}
          <a
            href={c.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block py-1 font-medium text-primary hover:underline dark:text-brand-300"
          >
            {c.label}
          </a>
        </span>
      ))}
      <br />
      <span className="italic">{t('supportContactLanguages')}</span>
    </p>
  )
}
