export default {
  title: 'Schreiberdienst',
  subtitle: 'Schreiber- und Schiedsrichterzuteilungen für Heimspiele.',

  // Tabs
  tabGames: 'Spiele',
  tabOverview: 'Übersicht',
  dutyScopeAll: 'Alle',
  dutyScopeMine: 'Ausgewählt',

  // Labels — Volleyball
  scorer: 'Schreiber',
  scoreboard: 'Täfeler',
  scorerTaefeler: 'Schreiber/Täfeler',
  referee: 'Schiedsrichter',
  confirmed: 'Bestätigt',

  // Labels — Basketball
  bbScorer: 'Anschreiber/in',
  bbTimekeeper: 'Zeitnehmer/in',
  bb24sOfficial: '24"-Offizielle/r',
  bbDutyTeam: 'Offiziellen-Team',

  // Sport toggle
  sportVolleyball: 'Volleyball',
  sportBasketball: 'Basketball',
  officialsDuties: 'Offizielle',
  dutyTeam: 'Dienst-Team',

  // Status labels
  statusConfirmed: 'Bestätigt',
  statusAssigned: 'Zugeteilt',
  statusOpen: 'Offen',
  confirmedBy: 'Bestätigt von',

  // Filters
  filters: 'Filter',
  filterDate: 'Datum',
  filterDutyTeam: 'Dienst-Team',
  filterDutyType: 'Dienstart',
  filterUnassigned: 'Offene Dienste',
  filterSearchAssignee: 'Person suchen',
  filterAllTeams: 'Alle Teams',
  filterAllTypes: 'Alle Arten',
  filterAllDuties: 'Alle Dienste',
  filterAnyUnassigned: 'Offene Zuteilungen',
  searchAssigneePlaceholder: 'Name eingeben...',
  clearFilters: 'Filter zurücksetzen',

  // Empty state
  noGames: 'Keine Spiele',
  noGamesDescription: 'Keine Spiele für den ausgewählten Filter gefunden.',

  // Error toasts
  errorUpdate: 'Die Zuteilung konnte nicht aktualisiert werden.',
  errorToggleReminders: 'Die Erinnerungseinstellung konnte nicht geändert werden.',
  errorDelegate: 'Die Delegation konnte nicht gesendet werden.',
  errorAcceptDelegation: 'Die Anfrage konnte nicht angenommen werden.',
  errorDeclineDelegation: 'Die Anfrage konnte nicht abgelehnt werden.',

  // Past games
  showOlderGames: 'Ältere Spiele anzeigen',
  loadMore: 'Mehr laden',
  hidePast: 'Ältere ausblenden',

  // Actions
  exportICal: 'Zum Kalender hinzufügen',
  unassigned: 'Nicht zugeteilt',
  unconfirm: 'Bestätigung aufheben',
  hide: 'Ausblenden',

  // Self-assign
  selfAssign: 'Ich übernehme',
  confirmSelfAssignTitle: 'Einsatz bestätigen',
  confirmSelfAssignMessage: 'Du meldest dich als <strong>{{role}}</strong> für das Spiel <strong>{{game}}</strong> am <strong>{{date}}</strong> an.',
  confirmSelfAssignArrival_scorer: 'Du musst spätestens <strong>30 Minuten</strong> vor Spielbeginn in der Halle sein.',
  confirmSelfAssignArrival_scoreboard: 'Du musst spätestens <strong>15 Minuten</strong> vor Spielbeginn in der Halle sein.',
  confirmSelfAssignArrival_scorer_scoreboard: 'Du musst spätestens <strong>30 Minuten</strong> vor Spielbeginn in der Halle sein.',
  confirmSelfAssignArrival_referee: 'Du musst spätestens <strong>30 Minuten</strong> vor Spielbeginn in der Halle sein.',
  confirmSelfAssignArrival_bb: 'Du musst spätestens <strong>15 Minuten</strong> vor Spielbeginn in der Halle sein.',
  confirmSelfAssignWarning: 'Diese Wahl ist <strong>endgültig</strong>. Sobald du eine Aufgabe übernimmst, kannst du sie nicht mehr abgeben — der einzige Weg ist, sie <strong>an ein anderes Mitglied zu delegieren</strong>.',
  confirmSelfAssignAbsence: 'Du hast an diesem Datum eine Absenz eingetragen. Du kannst den Dienst trotzdem übernehmen, prüfe aber zuerst deine Verfügbarkeit.',
  cancelAction: 'Abbrechen',
  confirmAction: 'Bestätigen',

  // Placeholders
  selectTeam: '— Team wählen —',
  selectPerson: '— Person wählen —',

  // Overview
  overviewEmpty: 'Keine Zuteilungen gefunden.',
  dutyCount: '{{count}} Einsätze',

  // Permissions
  permissionsNotice: 'Schreiberdienst kann nur von Admins und Coaches verwaltet werden.',

  // iCal export
  scorerDutyIcal: 'Schreiberdienst: {{home}} vs {{away}}',

  // Delegation
  delegate: 'Weitergeben',
  delegateTitle: 'Einsatz weitergeben',
  delegateDescription: 'Wähle ein Mitglied, dem du deinen Einsatz übergeben möchtest.',
  delegateSameTeam: 'Dein Team',
  delegateCrossTeam: 'Andere Mitglieder',
  delegateInstant: 'Sofort',
  delegateNeedsConfirm: 'Bestätigung nötig',
  delegateConfirmTitle: 'Einsatz weitergeben?',
  delegateConfirmInstant: 'Der Einsatz wird sofort an {{name}} übertragen.',
  delegateConfirmPending: '{{name}} erhält eine Anfrage und muss bestätigen.',
  delegateSuccess: 'Einsatz erfolgreich weitergegeben.',
  delegatePending: 'Anfrage gesendet. Warte auf Bestätigung.',
  delegateRequestTitle: 'Einsatz-Anfrage',
  delegateRequestMessage: '{{from}} möchte dir den {{role}}-Einsatz für {{game}} am {{date}} übergeben.',
  delegateAccept: 'Annehmen',
  delegateDecline: 'Ablehnen',
  delegateAccepted: 'Einsatz übernommen.',
  delegateDeclined: 'Anfrage abgelehnt.',
  delegateExpired: 'Abgelaufen',
  delegatePendingOutgoing: 'Anfrage ausstehend an {{name}}',
  searchMember: 'Name suchen...',
  noMembersFound: 'Keine passenden Mitglieder gefunden.',
  assignedTo: 'Zugeteilt an {{name}}',

  // Reminder toggle
  reminderEmails: 'Erinnerungs-E-Mails',
  reminderEmailsOn: 'AN — Erinnerungen werden am Vortag verschickt',
  reminderEmailsOff: 'AUS — Keine Erinnerungs-E-Mails',

  // Info panel
  infoTitle: 'Infos zum Schreiberdienst',
  infoArrivalTitle: 'Ankunftszeiten',
  infoArrivalScorer: 'Der Schreiber muss spätestens <strong>30 Minuten</strong> vor Spielbeginn in der Halle sein.',
  infoArrivalTaefeler: 'Der Täfeler muss spätestens <strong>15 Minuten</strong> vor Spielbeginn in der Halle sein.',
  infoArrivalReferee: 'Der Schiedsrichter muss spätestens <strong>30 Minuten</strong> vor Spielbeginn in der Halle sein.',
  // Ankunfts-Hinweise pro Karte (/scorer)
  arrivalHintSingle: '{{min}} Min. vor Spielbeginn in der Halle.',
  arrivalHintReferee: 'Schiedsrichter: {{min}} Min. vor Spielbeginn in der Halle.',
  arrivalHintSplit: 'Schreiber {{scorer}} Min. · Täfeler {{board}} Min. vor Spielbeginn.',
  infoWarningTitle: 'Achtung!',
  infoWarningFine: 'Verspätung oder Nichterscheinen wird mit einer Busse (50.– CHF) bestraft.',
  infoRequirementsTitle: 'Spielanforderungen',
  infoRequirements: 'Spiele ab 4. Liga und tiefer benötigen nur einen Schreiber, ohne Lizenz. In den Spieldetails ist dies als einziger «Schreiber/Täfeler» angegeben.',
  infoRequirementsArrival: 'In diesem Fall muss der Schreiber/Täfeler spätestens <strong>30 Minuten</strong> vor Spielbeginn in der Halle sein.',
  infoHowToTitle: 'So funktioniert\'s',
  infoHowTo: 'Klicke auf das Spiel, wähle deine Rolle aus, wähle dich im Dropdown aus und bestätige. Falls du dich nicht findest, kontaktiere Luca oder Thamy.',

  // Aufstellung Heimteam (nur Schreiber, ±1h um das Spiel)
  viewRoster: 'Aufstellung',
  rosterTitle: 'Aufstellung Heimteam',
  rosterColNumber: '#',
  rosterColName: 'Name',
  rosterColDob: 'Geburtsdatum',
  rosterEmpty: 'Keine Spieler für dieses Team gefunden.',
  rosterOutsideWindow: 'Die Aufstellung ist nur von 1 Stunde vor bis 1 Stunde nach dem Spiel verfügbar.',
  rosterNotScorer: 'Nur der eingeteilte Schreiber kann die Aufstellung sehen.',
  rosterNotHome: 'Die Aufstellung ist nur für Heimspiele verfügbar.',
  rosterNoTime: 'Für dieses Spiel ist noch keine Zeit angesetzt.',
  rosterError: 'Die Aufstellung konnte nicht geladen werden.',
} as const
