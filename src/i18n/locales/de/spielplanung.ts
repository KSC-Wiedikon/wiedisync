export default {
  title: 'Spielplanung',
  subtitleSeason: 'Saisonübersicht {{season}}',
  seasonPicker: 'Saison',

  // View options
  blockedDate: 'Gesperrt',
  viewCalendar: 'Kalender',
  viewWeek: 'Woche',
  viewByDate: 'Nach Datum',
  viewByTeam: 'Nach Team',

  // Week view
  weekPrev: 'Vorherige Woche',
  weekNext: 'Nächste Woche',
  weekToday: 'Heute',
  weekMoveSuccess: 'Spiel verschoben.',
  weekMoveFailed: 'Konnte Spiel nicht verschieben: {{message}}',

  // Filters
  filterAll: 'Alle',
  filterVolleyball: 'Volleyball',
  filterBasketball: 'Basketball',
  filterHome: 'Heim',
  filterAway: 'Auswärts',
  showAbsences: 'Absenzen anzeigen',

  // Absence overlay badge (calendar day cells)
  absenceBadge: {
    title: '{{count}} abwesend',
    aria: 'Absenzen: {{count}}',
  },

  showCrossTeam: 'Team-Konflikte anzeigen',
  crossTeamNeedsTeam: 'Zuerst ein Team wählen, um die Team-Konflikte zu sehen',
  crossTeamBadge: {
    title: 'Team-Konflikte: {{count}}',
    aria: 'Team-Konflikte: {{count}}',
    hint: 'Ein Team mit gemeinsamen Spielern spielt an diesem Tag — das blockiert hier einen Heimslot.',
    kind: {
      game: 'Spiel',
      home: 'Heimspiel',
      away: 'Auswärtsspiel',
    },
  },

  // Day overflow popover (month view)
  overflow: {
    more: '+{{count}} weitere',
  },

  // Admin-only Spielplaner assignments accordion
  assignments: {
    title: 'Spielplaner-Zuweisungen',
    hint: 'Weise Mitglieder spezifischen Teams zu, damit sie für diese Teams manuelle Spiele verwalten können. Mitglieder mit Club-weitem Spielplaner-Flag (★) haben bereits Zugriff auf alle Teams.',
    member: 'Mitglied',
    memberPlaceholder: 'Mitglied auswählen',
    team: 'Team',
    teamPlaceholder: 'Team auswählen',
    add: 'Hinzufügen',
    remove: 'Zuweisung entfernen',
    loading: 'Lade Zuweisungen…',
    empty: 'Noch keine teambezogenen Zuweisungen. Oben eine hinzufügen.',
    clubWide: '(Club-weiter Spielplaner)',
  },

  // Bulk import panel
  import: {
    title: 'Massen-Import',
    hint: 'Vorlage herunterladen, pro Zeile ein Spiel erfassen, dann hochladen zur Vorschau. Zeilen mit fehlenden / unbekannten Daten werden übersprungen.',
    downloadTemplate: 'Excel-Vorlage herunterladen',
    importing: 'Importiere…',
    importNValid: '{{count}} gültige Spiel(e) importieren',
    nSkipped: '{{count}} Zeile(n) werden übersprungen',
    result: '{{created}} Spiel(e) importiert. {{failed}} fehlgeschlagen.',
    col: {
      team: 'Team',
      type: 'H/A',
      opponent: 'Gegner',
      date: 'Datum',
      time: 'Zeit',
      hall: 'Halle',
      status: 'Status',
    },
    ok: 'OK',
    error: {
      unknownTeam: 'Unbekanntes Team',
      outOfScope: 'Ausserhalb Zuständigkeit',
      missingOpponent: 'Gegner fehlt',
      missingDate: 'Datum fehlt',
      unknownHall: 'Unbekannte Halle',
    },
  },

  // Manual game creation modal
  manualGame: {
    title: 'Manuelles Spiel erfassen',
    subtitle: 'Überspringt den Einlade-Flow — Admin / Spielplaner setzt alle Details selbst.',
    sport: 'Sportart',
    team: 'Team',
    teamPlaceholder: 'Team auswählen',
    homeAway: 'Heim / Auswärts',
    home: 'Heim',
    away: 'Auswärts',
    opponent: 'Gegner',
    opponentPlaceholder: 'z.B. Goldcoast Wädenswil 1',
    date: 'Datum',
    time: 'Zeit',
    hall: 'Halle',
    hallPlaceholder: 'Halle auswählen',
    hallComboAB: 'KWI A + B',
    saturdayHint: 'Vorbelegt: {{hall}} — Samstag empfohlen vor KWI A/B',
    awayVenue: 'Auswärts-Spielort',
    venueName: 'Name der Halle',
    venueAddress: 'Adresse',
    venueCity: 'PLZ / Ort',
    venuePlusCode: 'Plus-Code (optional)',
    league: 'Liga',
    leaguePlaceholder: 'Optional',
    round: 'Runde',
    autoConfirmRsvp: 'Automatisch bestätigen',
    autoConfirmRsvpHint: 'Team-Standard überschreiben ({{def}}). Alle berechtigten Mitglieder starten als bestätigt; sie müssen sich aktiv abmelden.',
    useTeamDefault: 'Team-Standard',
    on: 'An',
    off: 'Aus',
    create: 'Spiel erstellen',
    editTitle: 'Manuelles Spiel bearbeiten',
    save: 'Änderungen speichern',
    conflict: {
      sameTeamSameDay: 'Dieses Team spielt bereits am gleichen Tag ({{time}} gegen {{opponent}}).',
      hallOverlap: 'Die Halle ist zu einer überlappenden Zeit bereits belegt ({{time}}–{{endTime}}).',
      sameTeamWithinTwoDays: 'Dieses Team spielt auch am {{date}} um {{time}} ({{daysDelta}} Tage Abstand).',
    },
  },

  // Game detail drawer
  // List/row status labels
  status: {
    scheduled: 'Geplant',
    live: 'Live',
    completed: 'Gespielt',
    postponed: 'Verschoben',
  },
  emptyState: 'Keine Spiele gefunden',

  drawer: {
    vs: 'vs.',
    hall: 'Halle',
    league: 'Liga',
    round: 'Runde',
    svrzPush: 'SVRZ-Übertragung',
    notInVolleymanager: 'Noch nicht im Volleymanager',
    copySvrz: 'SVRZ-Details kopieren',
    copied: 'Kopiert!',
    sourceSVRZ: 'Verwaltet via SVRZ',
    sourceBasketplan: 'Verwaltet via Basketplan',
    sourceManual: 'Manuell',
    edit: 'Bearbeiten',
    delete: 'Löschen',
    deleteConfirmTitle: 'Manuelles Spiel löschen?',
    deleteConfirmBody: 'Dies kann nicht rückgängig gemacht werden.',
    confirmDelete: 'Löschen',
    cancel: 'Abbrechen',
    svrzReadOnlyHint: 'Offizielle Details stammen aus SVRZ. Änderungen bitte im Volleymanager vornehmen.',
    markAsComboAB: 'Als KWI A + B markieren',
    unmarkCombo: 'Auf Einzelhalle zurücksetzen',
  },
  colDate: 'Datum',
  colTime: 'Zeit',
  colTeam: 'Team',
  colMatchup: 'Begegnung',
  colType: 'H/A',
  colHall: 'Halle',
  colStatus: 'Status',
  gamesCount: '{{count}} Spiele',
} as const
