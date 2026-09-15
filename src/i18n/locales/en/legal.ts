export default {
  // Privacy Policy page
  privacyTitle: 'Privacy policy',
  lastUpdated: 'Last updated: September 15, 2026',

  controllerTitle: '1. Data controller',
  controllerText:
    'KSC Wiedikon\nSchrennengasse 7\n8003 Zürich\nEmail: kscw@kscw.ch',

  dataCollectedTitle: '2. Data we collect',
  dataAccountTitle: 'Account data (upon registration)',
  dataAccountText:
    'When registering as a club member, we collect: name, email address, phone number, and date of birth. Profile photos are uploaded and managed by members themselves. License number, position, and team assignment are set by coaches or the board.',
  dataRosterTitle: 'Roster data (public)',
  dataRosterText:
    'On the publicly accessible team pages, player names, jersey numbers, positions, and photos are displayed. This information corresponds to data also published publicly by Swiss Volley.',
  dataInternalTitle: 'Internal club data',
  dataInternalText:
    'Training attendance, absences (including reason), scorer duty assignments, and game results are recorded internally for club management and are only visible to logged-in members or coaches.',
  dataTechnicalTitle: 'Technical data',
  dataTechnicalText:
    'When visiting the website, technical information such as IP address and browser information is automatically processed by our hosting provider (Cloudflare).',

  dataRegisterTitle:
    'Master data for club administration and federations',
  dataRegisterText:
    'For club administration and federation registration we additionally record postal address, postcode and town, nationality, sex, AHV (social security) number and — for junior coaches — the J+S personal number. The AHV number is required for federation and J+S filings and is visible only to the board and administration.',
  dataFinanceTitle:
    'Payment and invoicing data',
  dataFinanceText:
    'To invoice membership fees we record the fee category, billing address and payment details (IBAN). This data is visible only to the board and the finance administration.',
  dataIdentityTitle:
    'Identity documents (end-to-end encrypted)',
  dataIdentityText:
    'Some federations require a copy of an identity document for a playing licence. It is encrypted in the member’s own browser (AES-256-GCM) and reaches our server only as ciphertext; the key is wrapped separately for the authorised people. Neither the server operator nor the administration can read the file without that key.',

  legalBasisTitle: '3. Legal basis',
  legalBasisText:
    'The processing of personal data is based on:',
  legalBasisContract:
    'Contract fulfillment (club membership) — for managing member data, training, and game planning.',
  legalBasisInterest:
    'Legitimate interest — for the public display of team rosters, as is customary in club sports and expected by members.',
  legalBasisConsent:
    'Consent — Members upload their own profile photo and can change or remove it at any time.',

  thirdPartyTitle: '4. Sub-processors',
  thirdPartyIntro: 'The following service providers are used as sub-processors:',
  thirdPartyCloudflare:
    'Cloudflare, Inc. — Frontend hosting (Cloudflare Pages) | Global (US-based) | DPA, Standard Contractual Clauses, Swiss-US Data Privacy Framework',
  thirdPartySwissVolley:
    'Swiss Volley API (api.volleyball.ch) — We retrieve publicly available game data and rankings. No personal data is transmitted to Swiss Volley.',
  thirdPartyGCal:
    'Google Calendar — We retrieve a public calendar feed to display hall schedules. No personal data is transmitted to Google.',
  thirdPartyBasketplan:
    'Basketplan (basketball.ch) — We retrieve publicly available game data and rankings. No personal data is transmitted to Basketplan.',
  thirdPartyMigadu:
    'Migadu (migadu.com) — Email delivery for notifications and reminders | Switzerland | DPA',
  thirdPartyHetzner:
    'Hetzner Online GmbH — Backend hosting (Directus) | Germany (Nuremberg datacenter) | DPA, GDPR-compliant',
  thirdPartyClubDesk:
    'ClubDesk (club administration, Switzerland): member master data including contact details, AHV number and payment details is synchronised with the ClubDesk club administration system, which is the original source of most of this data.',
  thirdPartySentry:
    'Sentry (sentry.io) — Error tracking and performance monitoring | EU (de.sentry.io, Germany) | DPA, GDPR-compliant. No personal data (name, email) is transmitted to Sentry.',
  thirdPartyCloudflareWorkers:
    'Cloudflare Workers — Processing of push notifications | Global (US-based) | DPA, Standard Contractual Clauses, Swiss-US Data Privacy Framework',

  retentionTitle: '5. Data retention',
  retentionText:
    'Your data is stored for as long as you have an active account. You can delete your account yourself at any time in the profile settings; deletion is immediate and covers the linked records. Ending your membership does not, however, delete your data automatically: some of it must be retained for legal reasons, in particular business and accounting records for ten years under Art. 958f of the Swiss Code of Obligations. Data not subject to a retention obligation is deleted on request via the contact address below.',

  storageTitle: '6. Data storage',
  storageServer:
    'Data is stored on a server hosted by Hetzner Online GmbH in Germany (Nuremberg datacenter) running Directus. The frontend is served via Cloudflare Pages.',
  storageLocal:
    'The following non-personal preferences are stored in your browser: color scheme (light/dark) and language setting. For logged-in users, a session token is stored in the browser.',
  storageNoCookies:
    'The website itself does not set any cookies. Cloudflare may set technically necessary cookies that do not require consent.',

  rightsTitle: '7. Your rights',
  rightsText:
    'Under the Swiss Data Protection Act (nDSG), you have the following rights:',
  rightsAccess: 'Right of access — You can request information about your stored data.',
  rightsCorrection: 'Right to rectification — You can request the correction of inaccurate data. Most data can be updated directly in your profile.',
  rightsDeletion: 'Right to deletion — You can request deletion of your data, or delete your account yourself.',
  rightsPortability: 'Right to data portability — You can receive your data in a commonly used format.',
  rightsObject: 'Right to object — You may object to the processing of your data at any time.',
  rightsContact:
    'For requests regarding your rights, please contact: kscw@kscw.ch',
  rightsFDPIC:
    'You also have the right to file a complaint with the Swiss Federal Data Protection and Information Commissioner (FDPIC): www.edoeb.admin.ch',

  photosTitle: '8. Photos',
  photosText:
    'Player photos are uploaded by members themselves via their profile and can be changed or removed at any time. Uploaded photos are visible on the public team pages.',

  changesTitle: '9. Changes',
  changesText:
    'We reserve the right to update this privacy policy as needed. The current version is available on this page.',

  // Impressum page
  impressumTitle: 'Legal notice',
  impressumClubName: 'KSC Wiedikon',
  impressumAddress: 'Schrennengasse 7\n8003 Zürich',
  impressumFullName: 'Kultur- und Sportclub Wiedikon',
  impressumContact: 'Email: kscw@kscw.ch',
  impressumWebsite: 'Website: kscw.ch',
  impressumBoard: 'Responsible: Board of KSC Wiedikon',
  impressumHosting: 'Hosting: Cloudflare Pages (frontend), Hetzner Online GmbH, Germany (backend)',
  impressumLinks: 'Liability for links',
  impressumLinksText:
    'Our website contains links to external third-party websites over whose content we have no influence. The respective provider is always responsible for the content of linked pages. If we become aware of any legal violations, we will remove such links immediately.',
  impressumCopyright: 'Copyright',
  impressumCopyrightText:
    'The content and works created by KSC Wiedikon on this website are subject to Swiss copyright law. Reproduction, editing, or distribution beyond the scope of copyright law requires the written consent of the club.',
  impressumSocial: 'Social media',
  impressumFacebook: 'Facebook: KSC Wiedikon',
  impressumInstagram: 'Instagram: @ksc_wiedikon',
  impressumDisclaimer: 'Disclaimer',
  impressumDisclaimerText:
    'KSC Wiedikon assumes no liability for the accuracy, completeness, or timeliness of the information provided. Liability claims against KSC Wiedikon relating to material or immaterial damages are generally excluded.',

  // Privacy notice bar
  noticeCookies: 'This website does not use tracking cookies.',
  noticeLink: 'Learn more',
} as const
