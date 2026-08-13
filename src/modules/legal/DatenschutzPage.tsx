import { useTranslation } from 'react-i18next'

export default function DatenschutzPage() {
  const { t } = useTranslation('legal')

  return (
    <div className="mx-auto max-w-3xl" role="region" aria-label={t('privacyTitle')} tabIndex={0}>
      <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">
        {t('privacyTitle')}
      </h1>
      <p className="mb-8 text-sm text-gray-500 dark:text-gray-400">
        {t('lastUpdated')}
      </p>

      <Section title={t('controllerTitle')}>
        <Whitespace text={t('controllerText')} />
      </Section>

      <Section title={t('dataCollectedTitle')}>
        <h3 className="mb-1 font-semibold text-gray-800 dark:text-gray-200">
          {t('dataAccountTitle')}
        </h3>
        <p className="mb-4">{t('dataAccountText')}</p>

        {/* Added 2026-08-13. This section enumerated only name, email, phone, birthdate,
            photo, licence, position and team — while `members` also holds postal
            address, nationality, AHV number, IBAN, billing details, fee category and
            J+S id, and identity documents are stored too. This component is rendered
            inside the signup flow (SignUpPage), so the incomplete list WAS the Art. 19
            notice shown at account creation. */}
        <h3 className="mb-1 font-semibold text-gray-800 dark:text-gray-200">
          {t('dataRegisterTitle')}
        </h3>
        <p className="mb-4">{t('dataRegisterText')}</p>

        <h3 className="mb-1 font-semibold text-gray-800 dark:text-gray-200">
          {t('dataFinanceTitle')}
        </h3>
        <p className="mb-4">{t('dataFinanceText')}</p>

        {/* The end-to-end encryption reads as a strength once it is written down: the
            document is ciphertext before it leaves the member's browser. */}
        <h3 className="mb-1 font-semibold text-gray-800 dark:text-gray-200">
          {t('dataIdentityTitle')}
        </h3>
        <p className="mb-4">{t('dataIdentityText')}</p>

        <h3 className="mb-1 font-semibold text-gray-800 dark:text-gray-200">
          {t('dataRosterTitle')}
        </h3>
        <p className="mb-4">{t('dataRosterText')}</p>

        <h3 className="mb-1 font-semibold text-gray-800 dark:text-gray-200">
          {t('dataInternalTitle')}
        </h3>
        <p className="mb-4">{t('dataInternalText')}</p>

        <h3 className="mb-1 font-semibold text-gray-800 dark:text-gray-200">
          {t('dataTechnicalTitle')}
        </h3>
        <p>{t('dataTechnicalText')}</p>
      </Section>

      <Section title={t('legalBasisTitle')}>
        <p className="mb-3">{t('legalBasisText')}</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>{t('legalBasisContract')}</li>
          <li>{t('legalBasisInterest')}</li>
          <li>{t('legalBasisConsent')}</li>
        </ul>
      </Section>

      <Section title={t('thirdPartyTitle')}>
        <p className="mb-3">{t('thirdPartyIntro')}</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>{t('thirdPartyCloudflare')}</li>
          <li>{t('thirdPartySwissVolley')}</li>
          <li>{t('thirdPartyBasketplan')}</li>
          <li>{t('thirdPartyGCal')}</li>
          <li>{t('thirdPartyMigadu')}</li>
          <li>{t('thirdPartyHetzner')}</li>
          {/* ClubDesk receives the full contact record including AHV number and
              IBAN and was absent from this list. It is the ORIGIN of most of those
              fields (one-way down-sync) and the up-push is gated off on prod, so
              this is a completeness gap rather than an undisclosed new transfer. */}
          <li>{t('thirdPartyClubDesk')}</li>
          <li>{t('thirdPartySentry')}</li>
          <li>{t('thirdPartyCloudflareWorkers')}</li>
        </ul>
      </Section>

      <Section title={t('retentionTitle')}>
        <p>{t('retentionText')}</p>
      </Section>

      <Section title={t('storageTitle')}>
        <p className="mb-3">{t('storageServer')}</p>
        <p className="mb-3">{t('storageLocal')}</p>
        <p>{t('storageNoCookies')}</p>
      </Section>

      <Section title={t('rightsTitle')}>
        <p className="mb-3">{t('rightsText')}</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>{t('rightsAccess')}</li>
          <li>{t('rightsCorrection')}</li>
          <li>{t('rightsDeletion')}</li>
          <li>{t('rightsPortability')}</li>
          <li>{t('rightsObject')}</li>
        </ul>
        <p className="mt-4">{t('rightsContact')}</p>
        <p className="mt-2">{t('rightsFDPIC')}</p>
      </Section>

      <Section title={t('photosTitle')}>
        <p>{t('photosText')}</p>
      </Section>

      <Section title={t('messagingTitle')} id="nachrichten">
        <p className="mb-4">{t('messagingIntro')}</p>

        <h3 className="mb-1 font-semibold text-gray-800 dark:text-gray-200">
          {t('messagingDataTitle')}
        </h3>
        <p className="mb-4">{t('messagingDataText')}</p>

        <h3 className="mb-1 font-semibold text-gray-800 dark:text-gray-200">
          {t('messagingRetentionTitle')}
        </h3>
        <p className="mb-4">{t('messagingRetentionText')}</p>

        <h3 className="mb-1 font-semibold text-gray-800 dark:text-gray-200">
          {t('messagingAccessTitle')}
        </h3>
        <p className="mb-4">{t('messagingAccessText')}</p>

        <h3 className="mb-1 font-semibold text-gray-800 dark:text-gray-200">
          {t('messagingRightsTitle')}
        </h3>
        <p className="mb-4">{t('messagingRightsText')}</p>

        <h3 className="mb-1 font-semibold text-gray-800 dark:text-gray-200">
          {t('messagingReportsTitle')}
        </h3>
        <p className="mb-4">{t('messagingReportsText')}</p>

        <h3 className="mb-1 font-semibold text-gray-800 dark:text-gray-200">
          {t('messagingPushTitle')}
        </h3>
        <p>{t('messagingPushText')}</p>
      </Section>

      <Section title={t('changesTitle')}>
        <p>{t('changesText')}</p>
      </Section>
    </div>
  )
}

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section className="mb-8 scroll-mt-20" id={id}>
      <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-white">
        {title}
      </h2>
      <div className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
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
