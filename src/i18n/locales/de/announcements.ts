export default {
  // Admin page
  pageTitle: 'Vereinsnews',
  newAnnouncement: 'Neue News',
  empty: 'Noch keine Vereinsnews. Klicke „Neue News" um zu starten.',
  loadError: 'Konnte Vereinsnews nicht laden',

  // Editor modal
  createTitle: 'Neue Vereinsnews',
  editTitle: 'Vereinsnews bearbeiten',
  image: 'Titelbild',
  uploadImage: 'Bild hochladen',
  titlePlaceholder: 'Titel',
  bodyPlaceholder: 'Text…',
  link: 'Link (optional)',

  // Audience
  audience: 'Zielgruppe',
  audienceLabel: 'Zielgruppe',
  audienceAll: 'Alle Mitglieder',
  audienceSport: 'Eine Sportart',
  sport: 'Sportart',
  volleyball: 'Volleyball',
  basketball: 'Basketball',

  // Pin / Schedule
  pin: 'Anheften (oben in News-Karte)',
  pinned: 'Angeheftet',
  expires: 'Ablaufdatum (optional)',

  // Publish + notify toggles
  publish: 'Veröffentlichen (sofort sichtbar)',
  notifyPush: 'Push-Benachrichtigung senden',
  notifyEmail: 'E-Mail senden',
  emailLayout: 'E-Mail-Layout',
  emailLayoutStandard: 'Standard',
  emailLayoutNewsletter: 'Newsletter',
  emailLayoutHint: 'Newsletter nutzt ein breites Masthead-Layout und zeigt das Bild der Mitteilung als Hero.',
  emailReplyTo: 'Antwortadresse',
  emailReplyToHint: 'Antworten gehen an diese Adresse. Leer lassen für No-Reply.',

  // Status badges
  statusPublished: 'Veröffentlicht',
  statusDraft: 'Entwurf',
  statusExpired: 'Abgelaufen',
  noTitle: 'Kein Titel',

  // Validation + toast
  titleRequired: 'Deutscher Titel ist Pflicht',
  sportRequired: 'Sport wählen',
  linkInvalid: 'Link muss mit https:// oder / beginnen',
  confirmMassEmail: 'Diese Vereinsnews wird per E-Mail an ALLE aktiven Mitglieder versendet. Fortfahren?',
  imageType: 'Nur PNG, JPEG oder WebP erlaubt',
  imageSize: 'Bild ist zu gross (max 5 MB)',
  imageUploaded: 'Bild hochgeladen',
  imageUploadError: 'Upload fehlgeschlagen',
  created: 'Vereinsnews erstellt',
  updated: 'Vereinsnews aktualisiert',
  deleted: 'Vereinsnews gelöscht',
  saveError: 'Speichern fehlgeschlagen',
  deleteError: 'Löschen fehlgeschlagen',

  // Actions
  cancel: 'Abbrechen',
  save: 'Speichern',
  create: 'Erstellen',
  delete: 'Löschen',
  confirmDeleteTitle: 'Vereinsnews löschen?',
  confirmDeleteBody: 'Diese Aktion kann nicht rückgängig gemacht werden.',

  // Detail modal + archive
  openLink: 'Mehr erfahren',
  linkHint: 'Link zum vergünstigten Ticket — der Rabatt sollte bereits angewendet sein.',
  loadMore: 'Mehr anzeigen',
  signInRequired: 'Bitte einloggen, um Neuigkeiten zu sehen.',

  // Email subject prefix
  emailSubjectPrefix: 'Vereinsnews',
} as const
