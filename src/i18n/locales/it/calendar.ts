export default {
  title: 'Calendario',

  // View options
  viewHall: 'Palestra',
  viewWeek: 'Settimana',
  viewMonth: 'Calendario',
  viewSchedule: 'Partite',
  viewList: 'Lista',

  // Subtitles
  subtitleHall: 'Piano di occupazione della palestra',
  subtitleWeek: 'Panoramica settimanale di tutti gli eventi',
  subtitleMonth: 'Panoramica mensile di tutti gli eventi',
  subtitleSchedule: 'Partite proposte e confermate delle tue squadre',
  subtitleList: 'Tutti gli eventi in ordine cronologico',

  // Filter modal
  filterTitle: 'Filtro',
  filterCategories: 'Categorie',
  showHiddenAbsences: 'Mostra indisponibilità e assenze non bloccanti',
  showHiddenAbsencesHint: 'Disattivato di default — ingombrano il calendario e non influiscono sul resto della squadra.',

  // Filter groups
  filterGroupGames: 'Partite',
  filterGroupActivities: 'Attività',
  filterGroupVenue: 'Palestra',
  filterGroupOther: 'Altro',

  // Source filters
  sourceGames: 'Partite',
  sourceTrainings: 'Allenamenti',
  sourceClosures: 'Chiusure',
  sourceEvents: 'Eventi',

  // Game type filters
  gameTypeHome: 'Partite in casa',
  gameTypeAway: 'Partite fuori casa',
  sourceHallHW: 'Halle HW',
  sourceAbsences: 'Assenze',

  // Type labels
  typeGame: 'Partita',
  typeTraining: 'Allenamento',
  typeClosure: 'Chiusura palestra',
  typeEvent: 'Evento',
  typeHall: 'Prenotazione palestra',
  typeAbsence: 'Assenza',

  // Other
  noEntries: 'Nessun elemento trovato',
  weekLabel: 'SC {{week}}: {{start}} – {{end}}',
  exportICal: 'Esporta iCal',
  subscribeICal: 'Abbonati',

  // iCal modal
  icalSubscribeTitle: 'Abbonati al calendario',
  icalDownloadTitle: 'Esporta calendario',
  icalFilterLabel: 'A cosa vuoi abbonarti?',
  icalTeamFilter: 'Filtra per squadra',
  icalTeamHint: 'Vuoto = tutte le squadre',
  icalGenerateLink: 'Genera link di abbonamento',
  icalLinkReadyLabel: 'Link di abbonamento (copialo nella tua app calendario):',
  icalCopyLink: 'Copia',
  icalLinkCopied: 'Copiato!',
  icalCopyFailed: 'Impossibile copiare — seleziona il link e copialo manualmente',
  icalOpenInApp: 'Oppure apri direttamente nella tua app calendario',
  icalSubscribeHint:
    'Incolla questo link nella tua app calendario per abbonarti — si aggiorna automaticamente. Google Calendar: Altri calendari → Da URL. Apple Calendario: Archivio → Nuovo abbonamento calendario.',

  // Turni di segnapunti (personali)
  sourceScorerDuty: 'I miei turni',
  typeScorerDuty: 'Turno di segnapunti',
  icalDutiesTitle: 'I tuoi turni di segnapunti',
  icalDutiesHint: 'Abbonati a un calendario personale che aggiunge automaticamente i tuoi turni da segnapunti e tabellone.',
  icalDutiesGenerate: 'Genera il mio link dei turni',
  icalDutiesPrivacyHint: 'Link personale — tienilo privato. Mostra solo il tuo calendario dei turni (nessun dato personale).',
  icalDutiesError: 'Impossibile creare il tuo link personale.',
} as const
