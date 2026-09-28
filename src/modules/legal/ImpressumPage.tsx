import { useTranslation } from 'react-i18next'

export default function ImpressumPage() {
  const { t } = useTranslation('legal')

  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-hairline bg-card p-5 shadow-card sm:p-8">
      <h1 className="mb-8 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
        {t('impressumTitle')}
      </h1>

      <Section>
        <p className="text-lg font-semibold text-foreground">
          {t('impressumClubName')}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('impressumFullName')}
        </p>
        <Whitespace text={t('impressumAddress')} />
        <p className="mt-2">{t('impressumContact')}</p>
        <p>
          <a
            href="https://kscw.ch"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary hover:underline dark:text-brand-300"
          >
            {t('impressumWebsite')}
          </a>
        </p>
        <p className="mt-2">{t('impressumBoard')}</p>
      </Section>

      <Section>
        <p>{t('impressumHosting')}</p>
      </Section>

      <Section title={t('impressumSocial')}>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <a
              href="https://www.facebook.com/KSC-Wiedikon-103576793063334"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary hover:underline dark:text-brand-300"
            >
              {t('impressumFacebook')}
            </a>
          </li>
          <li>
            <a
              href="https://www.instagram.com/ksc_wiedikon"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary hover:underline dark:text-brand-300"
            >
              {t('impressumInstagram')}
            </a>
          </li>
        </ul>
      </Section>

      <Section title={t('impressumDisclaimer')}>
        <p>{t('impressumDisclaimerText')}</p>
      </Section>

      <Section title={t('impressumLinks')}>
        <p>{t('impressumLinksText')}</p>
      </Section>

      <Section title={t('impressumCopyright')}>
        <p>{t('impressumCopyrightText')}</p>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      {title && (
        <h2 className="mb-3 text-base font-semibold tracking-tight text-foreground">
          {title}
        </h2>
      )}
      <div className="text-sm leading-relaxed text-foreground/85">
        {children}
      </div>
    </section>
  )
}

function Whitespace({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <span key={i}>
          {line}
          {i < text.split('\n').length - 1 && <br />}
        </span>
      ))}
    </>
  )
}
