export default {
  title: 'Live',
  subtitle: 'Verfolge das Spiel live aus der Halle.',

  // Verbindungs- / Spielstatus
  statusLive: 'Live',
  statusFinal: 'Beendet',
  statusIdle: 'Kein Live-Spiel',
  statusConnecting: 'Verbinden…',
  statusReconnecting: 'Neu verbinden…',

  // Leerer Zustand
  noMatch: 'Zurzeit kein Live-Spiel',
  noMatchHint: 'Diese Seite aktualisiert sich automatisch, sobald die Anzeigetafel ein Spiel startet.',

  // Sportart auf der Anzeigetafel
  sport_volleyball: 'Volleyball',
  sport_beach: 'Beachvolleyball',
  sport_basketball: 'Basketball',

  // Anzeigetafel — Volleyball / Beach
  serving: 'Aufschlag',
  sets: 'Sätze',
  set: 'Satz {{n}}',
  teamFallback: 'Team',
  toShort: 'AZ', // Auszeiten
  subShort: 'W', // Wechsel

  // Anzeigetafel — Basketball
  period: 'Viertel',
  quarter: 'V{{n}}',
  overtime: 'VL',
  overtimeN: 'VL{{n}}',
  foulsShort: 'Fouls', // Teamfouls in diesem Viertel
  bonus: 'Bonus',
  bonusHint: 'Im Bonus — der Gegner hat 5 Teamfouls, dieses Team erhält Freiwürfe.',
  possessionOf: 'Ballbesitz: {{team}}',

  // Ereignisse der Anzeigetafel
  eventSetEnd: 'Satz beendet',
  eventMatchEnd: 'Spiel beendet',
  eventSwitch: 'Seitenwechsel',

  updatedAt: 'Aktualisiert {{time}}',
}
