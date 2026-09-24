// Salute della stagione — solo chrome; i testi dei controlli e le colonne ricadono sull'inglese.
export default {
  title: 'Salute della stagione',
  subtitle: 'Questa stagione è impostata correttamente? Giocatori, licenze, staff, quote, partite, compiti, risposte, allenamenti ed eventi — ogni rilievo come elenco delle righe interessate.',
  seasonLine: 'Stagione {{season}} · generato alle {{time}}',
  rescan: 'Ricontrolla',
  scanning: 'Analisi…',
  retry: 'Riprova',
  loadFailed: 'Impossibile caricare il rapporto sulla salute della stagione.',
  notDeployed: 'L\'endpoint non è ancora pubblicato su questo backend — riprova dopo il prossimo deploy.',

  tab_volleyball: 'Pallavolo',
  tab_basketball: 'Basket',
  tab_club: 'Tutto il club',

  section_teams: 'Squadre e staff',
  section_players: 'Giocatori e licenze',
  section_finance: 'Quote e finanze',
  section_games: 'Partite',
  section_duties: 'Compiti',
  section_rsvp: 'Risposte',
  section_trainings: 'Allenamenti',
  section_events: 'Eventi',

  teamsTitle: 'Squadre',
  playersTitle: 'Giocatori',
  showClean: 'Mostra i controlli senza rilievi',
  export: 'Esporta',
  exportFailed: 'Esportazione fallita',
  checkFailed: 'Controllo fallito',
  registers: 'Registri',
  checkDesc_minor_without_guardian_login: 'Nessuno può rispondere o confermare il profilo di questo membro minorenne — né il bambino (nessun accesso attivato) né un account principale tramite il modello delle economie domestiche. Un collegamento conta solo quando il membro collegato è configurato; un collegamento che su /admin/households attende ancora «Configura» è elencato qui. Invitare il giocatore, collegare un account principale o premere Configura. Una data di nascita sconosciuta conta come minorenne.',
} as const
