export default {
  title: 'Hallefinder',
  subtitle: 'Freii Sporthalle vo de Stadt Züri für d Saison',
  intro: 'Städtischi Halle mit eme freie, regelmässige Slot über di ganz Wintersaison. D Verfüegbarkeit wird jedi Nacht us em Buechigstool vo de Stadt übernoh; Wuche mit Schuelferie zelled nöd.',
  filters: {
    weekday: 'Wuchetag',
    startFrom: 'Ab',
    minDuration: 'Min. Dauer',
    district: 'Kreis',
    hallType: 'Halletyp',
    freeAllWeeks: 'Jedi Wuche frei (ohni Schuelferie)',
    allDistricts: 'Alli Kreis',
    allTypes: 'Alli Type',
    anyDay: 'Mä–Fr',
    search: 'Sueche',
  },
  weekday: {
    1: 'Mäntig', 2: 'Ziischtig', 3: 'Mittwuch', 4: 'Dunschtig', 5: 'Friitig', 6: 'Samschtig', 7: 'Sunntig',
  },
  weekdayShort: {
    1: 'Mä', 2: 'Zi', 3: 'Mi', 4: 'Du', 5: 'Fr', 6: 'Sa', 7: 'Su',
  },
  type: {
    gym_room: 'Gymnastikruum', sports_hall: 'Sporthalle', triple_hall: 'Dreifachhalle', double_hall: 'Doppelhalle',
  },
  table: {
    day: 'Tag', hall: 'Halle', photo: 'Foti', size: 'Grössi (L × B × H)', window: 'Freis Fänschter', weeks: 'Freii Wuche', district: 'Kreis', address: 'Adrässe', actions: 'Bueche',
  },
  photoOpen: 'Foti ufmache',
  courtCount_one: '{{count}} Fäld',
  courtCount_other: '{{count}} Fälder',
  allWeeks: 'Alli {{total}}',
  someWeeks: '{{free}} / {{total}}',
  book: 'Aafrage',
  calendar: 'Kaländer',
  lastUpdated: 'Date aktualisiert {{ago}}',
  neverUpdated: 'No nöd synchronisiert',
  noData: 'No kei Verfüegbarkeitsdate — de nächtlich Sync isch no nöd gloffe.',
  noResults: 'Mit dene Filter isch kei Halle di ganz Saison frei. Probier e chürzeri Dauer oder en spötere Start.',
  loading: 'Verfüegbarkeit wird glade…',
  error: 'D Verfüegbarkeit hät nöd chöne glade werde.',
  resultCount_one: '{{count}} Halle',
  resultCount_other: '{{count}} Halle',
  durationOption: '{{h}} h',
  exportXlsx: 'Excel exportiere',
  exporting: 'Exportiere…',
  exportFailed: 'Export fählgschlage',
  exportDone: '{{count}} Halle exportiert',
  // Workbook contents. English-only by convention — these files get forwarded
  // to people who do not share the exporter's UI language — so the other
  // locales deliberately carry no `xlsx` block.
}
