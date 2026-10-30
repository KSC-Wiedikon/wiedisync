export default {
  title: 'Schriiberdienst',
  subtitle: 'Schriiber- und Täfeler-Iisätz für Heimspiel verwalte.',
  subtitleBb: "Tischoffizielli (Aaschriiber, Ziitnehmer, 24s) für Basketball-Heimspiel.",

  // Tabs
  tabGames: 'Spiel',
  tabOverview: 'Übersicht',
  dutyScopeAll: 'Alli',
  dutyScopeMine: 'Mini Iisätz',

  // Labels — Volleyball
  scorer: 'Schriiber',
  scoreboard: 'Täfeler',
  scorerTaefeler: 'Schriiber/Täfeler',
  referee: 'Schiedsrichter',
  confirmed: 'Bestätigt',

  // Labels — Basketball
  bbScorer: 'Aaschriiber/in',
  bbTimekeeper: 'Ziitnehmer/in',
  bb24sOfficial: '24s',
  bbDutyTeams: 'Iisatzteams',
  bbDutyTeam: 'Offizielle-Team',

  // Sport toggle
  sportVolleyball: 'Volleyball',
  sportBasketball: 'Basketball',
  officialsDuties: 'Offizielli',
  dutyTeam: 'Dienst-Team',

  // Status labels
  statusConfirmed: 'Bestätigt',
  statusAssigned: 'Zueteilt',
  statusOpen: 'Offe',
  confirmedBy: 'Bestätigt vo',

  // Filters
  filters: 'Filter',
  filterDate: 'Datum',
  filterDutyTeam: 'Dienst-Team',
  filterPlayingTeam: 'Spielends Team',
  overviewByTeam: 'Nach Dienst-Team',
  overviewByGame: 'Nach Spiel',
  overviewColTeam: 'Team',
  overviewColDuties: 'Dienst',
  overviewColOpen: 'Offe',
  filterDutyType: 'Dienstart',
  filterUnassigned: 'Offeni Dienst',
  filterSearchAssignee: 'Person sueche',
  filterAllTeams: 'Alli Teams',
  filterAllTypes: 'Alli Arte',
  filterAllDuties: 'Alli Dienst',
  filterAnyUnassigned: 'Offeni Zueteilige',
  searchAssigneePlaceholder: 'Name iigäh...',
  clearFilters: 'Filter zruggsetze',

  // Empty state
  noGames: 'Kei Spiel',
  noGamesDescription: 'Kei Spiel für de usgwählte Filter gfunde.',
  noPastGamesThisSeason: 'Kei vergangene Spiel i dere Saison',

  // Error toasts
  errorUpdate: 'D Zueteilig hät nöd chöne aktualisiert werde.',
  errorToggleReminders: 'D Erinnerigs-Iistellig hät nöd chöne gänderet werde.',
  errorDelegate: 'D Delegation hät nöd chöne gschickt werde.',
  errorAcceptDelegation: 'D Aafrag hät nöd chöne aagnah werde.',
  errorDeclineDelegation: 'D Aafrag hät nöd chöne abglehnt werde.',

  // Past games
  showOlderGames: 'Älteri Spiel aazeige',
  loadMore: 'Meh lade',
  hidePast: 'Älteri usblände',

  // Actions
  exportICal: 'Zum Kaländer hinzuefüege',
  unassigned: 'Nöd zueteilt',
  unconfirm: 'Bestätigig ufhebe',
  hide: 'Usblände',

  // Self-assign
  selfAssign: 'I übernimm',
  selfAssignSuccess: 'Aagmäldet — bis dänn!',
  selfAssignError: 'Aamäldig hät nöd klappt (evtl. grad vergäh oder nöd berächtigt).',
  selfAssignClash: 'Du häsch zu dere Ziit scho en Iisatz.',
  staffAssignSuccess: 'Iiteilt.',
  staffUnassignSuccess: 'Entfernt.',
  staffAssignClash: 'Die Person hät zu dere Ziit scho en Iisatz.',
  staffAssignError: 'Iiteile isch nöd gange (Platz vergäh, Lizänz fählt oder nöd berächtigt).',
  confirmSelfAssignTitle: 'Iisatz bestätige',
  confirmSelfAssignMessage: 'Du mäldsch di als <strong>{{role}}</strong> für s Spiel <strong>{{game}}</strong> am <strong>{{date}}</strong> aa.',
  confirmSelfAssignArrival_scorer: 'Du muesch spötischtens <strong>30 Minute</strong> vor Spielbeginn i de Halle sii.',
  confirmSelfAssignArrival_scoreboard: 'Du muesch spötischtens <strong>15 Minute</strong> vor Spielbeginn i de Halle sii.',
  confirmSelfAssignArrival_scorer_scoreboard: 'Du muesch spötischtens <strong>30 Minute</strong> vor Spielbeginn i de Halle sii.',
  confirmSelfAssignArrival_referee: 'Du muesch spötischtens <strong>30 Minute</strong> vor Spielbeginn i de Halle sii.',
  confirmSelfAssignArrival_bb: 'Du muesch spötischtens <strong>20 Minute</strong> vor Spielbeginn i de Halle sii.',
  confirmSelfAssignWarning: 'Die Wahl isch <strong>endgültig</strong>. Sobald du en Iisatz übernimmsch, chasch en nüme abgäh — du chasch en nur no <strong>amene andere Mitglied wiitergäh</strong>.',
  confirmSelfAssignAbsence: 'Du häsch a däm Datum e Absänz iiträit. Du chasch de Dienst trotzdäm übernäh, aber prüef zerscht dini Verfüegbarkeit.',
  cancelAction: 'Abbräche',
  confirmAction: 'Bestätige',

  // Placeholders
  selectTeam: 'Team wähle',
  selectPerson: 'Person wähle',
  pickDutyTeamTitle: 'Weles Dienst-Team?',
  pickDutyTeamBody: '{{name}} isch i mehrere Teams — wähl das, wo für dä Dienst zueständig isch.',

  // Overview
  overviewEmpty: 'Kei Zueteilige gfunde.',
  dutyCount: '{{count}} Iisätz',

  // Permissions
  permissionsNotice: 'Schriiberdienst cha nur vo Admins und Coaches verwaltet werde.',

  // iCal export
  scorerDutyIcal: 'Schriiberdienst: {{home}} vs {{away}}',

  // Delegation
  delegate: 'Wiitergäh',
  delegateTitle: 'Iisatz wiitergäh',
  delegateDescription: 'Wähl es Mitglied, wo din Iisatz söll übernäh.',
  delegateSameTeam: 'Dis Team',
  delegateCrossTeam: 'Anderi Mitglieder',
  delegateInstant: 'Sofort',
  delegateNeedsConfirm: 'Bestätigig nötig',
  delegateConfirmTitle: 'Iisatz wiitergäh?',
  delegateConfirmInstant: 'De Iisatz wird sofort a {{name}} überträit.',
  delegateConfirmPending: '{{name}} überchunnt e Aafrag und mues bestätige.',
  delegateSuccess: 'Iisatz erfolgriich wiitergäh.',
  delegatePending: 'Aafrag gschickt. Wart uf Bestätigig.',
  delegateRequestTitle: 'Iisatz-Aafrag',
  delegateRequestMessage: '{{from}} möcht dir de {{role}}-Iisatz für {{game}} am {{date}} übergäh.',
  delegateAccept: 'Aanäh',
  delegateDecline: 'Ablehne',
  delegateAccepted: 'Iisatz übernoh.',
  delegateDeclined: 'Aafrag abglehnt.',
  delegateExpired: 'Abgloffe',
  delegatePendingOutgoing: 'Aafrag usstehend a {{name}}',
  searchMember: 'Name sueche...',
  noMembersFound: 'Kei passende Mitglieder gfunde.',
  assignedTo: 'Zueteilt a {{name}}',

  // Reminder toggle
  reminderEmails: 'Erinnerigs-E-Mails',
  reminderEmailsOn: 'AA — Erinnerige werded am Vortag verschickt',
  reminderEmailsOff: 'US — Kei Erinnerigs-E-Mails',

  // Info panel
  infoTitle: 'Infos zum Schriiberdienst',
  infoArrivalTitle: 'Aachunftsziite',
  infoArrivalScorer: 'De Schriiber mues spötischtens <strong>30 Minute</strong> vor Spielbeginn i de Halle sii.',
  infoArrivalTaefeler: 'De Täfeler mues spötischtens <strong>15 Minute</strong> vor Spielbeginn i de Halle sii.',
  infoArrivalReferee: 'De Schiedsrichter mues spötischtens <strong>30 Minute</strong> vor Spielbeginn i de Halle sii.',
  // Per-card arrival hints (/scorer)
  arrivalHintSingle: '{{min}} Min. vor Spielbeginn i de Halle.',
  arrivalHintReferee: 'Schiedsrichter: {{min}} Min. vor Spielbeginn i de Halle.',
  arrivalHintSplit: 'Schriiber {{scorer}} Min. · Täfeler {{board}} Min. vor Spielbeginn.',
  infoWarningTitle: 'Achtung!',
  infoWarningFine: 'Verspötig oder Nöd-Erschiine wird mit ere Buess (50.– CHF) bestraft.',
  infoRequirementsTitle: 'Spielaaforderige',
  infoRequirements: 'Spiel ab 4. Liga und tüüfer bruuched nur en Schriiber, ohni Lizänz. I de Spieldetails isch das als einzige «Schriiber/Täfeler» aagäh.',
  infoRequirementsArrival: 'I dem Fall mues de Schriiber/Täfeler spötischtens <strong>30 Minute</strong> vor Spielbeginn i de Halle sii.',
  infoArrivalBb: "Aaschriiber/in, Ziitnehmer/in und 24s müend spötischtens <strong>20 Minute</strong> vor Spielbeginn i de Halle sii.",
  infoLicencesTitleBb: "Lizänze",
  infoLicencesBb: "Aaschriiber/in und Ziitnehmer/in bruuched OTR1 oder höcher (OTR2, OTN). De 24s-Platz bruucht OTR2 oder OTN. Du chasch di nur für en Platz iitrage, wo dini Lizänz abdeckt.",
  infoHowToBb: "Mach s Spiel uf, wähl din Platz und bestätig. Alli Mitglieder vomene Team under \"Iisatzteams\" chönd en Platz übernäh, wo ihri Lizänz abdeckt.",
  infoHowToTitle: 'So funktionierts',
  infoHowTo: 'Klick uf s Spiel, wähl dini Rolle us, wähl di im Dropdown us und bestätig. Falls du di nöd findsch, kontaktier de Luca oder d Thamy.',
  // Home-team roster (Schreiber only, ±1h around the game)
  viewRoster: 'Ufstellig',
  rosterTitle: 'Ufstellig Heimteam',
  rosterColNumber: '#',
  rosterColName: 'Name',
  rosterColDob: 'Geburtsdatum',
  rosterColDobShort: 'Geb.',
  rosterEmpty: 'Für das Team sind kei Spieler gfunde worde.',
  rosterOutsideWindow: 'D Ufstellig isch erscht ab 40 Minute vor em Spiel bis zum Spieländ verfüegbar.',
  rosterNotScorer: 'Nur de iiteilti Schriiber cha d Ufstellig gseh.',
  rosterNotHome: 'D Ufstellig gits nur für Heimspiel.',
  rosterNoTime: 'Für das Spiel isch no kei Ziit aagsetzt.',
  rosterError: 'D Ufstellig hät nöd chöne glade werde.',
  rosterColLicence: 'Lizänz',
  rosterSourceVm: 'Einsatzliste us em Volleymanager',
  rosterSourceRsvp: 'Kei Einsatzliste im Volleymanager — nur Spieler, wo zuegseit händ',
  rosterNotEligible: 'Gemäss Volleymanager nöd spielberächtigt',
  rosterNoConfirmed: 'No kei zuegseiti Spieler.',
  rosterCaptain: 'Captain',
  rosterCaptainShort: 'C',
  rosterCoaches: 'Coaches',
  // Duty banner + emergency (homepage)
  dutyBadge: 'Iisatz',
  dutyBannerTitle: 'Du häsch {{role}}-Iisatz',
  dutyEmergencyButton: 'Notfall: Team-Leiter kontaktiere',
  dutyEmergencySent: 'Team-Leiter aazeigt — de Verein isch informiert.',
  dutyEmergencyError: 'Alarm hät nöd chöne gschickt werde. Bitte en Team-Leiter direkt aalüüte.',
  dutyEmergencyRevealed: 'Team-Leiter — jetz kontaktiere:',
  dutyEmergencyNoLeaders: 'Kei Team-Leiter hinterleit. Luca oder Thamy kontaktiere.',
  roleCoach: 'Coach',
  roleResponsible: 'Teamverantwortliche/r',
} as const
