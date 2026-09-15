export default {
  menu: {
    title: 'Guida',
    subtitle: 'Scopri WiediSync',
    resetAll: 'Reimposta tutto',
    completed: 'Completato',
    steps: '{{count}} passi',
    restart: 'Rivedere il tour?',
  },
  welcome: {
    title: 'Benvenuto su WiediSync!',
    body: 'Vuoi una breve introduzione alle funzioni principali?',
    start: 'Sì, iniziamo',
    skip: 'Salta',
  },
  offer: {
    coachTools: 'Hai strumenti coach qui. Tour rapido?',
    adminTools: 'Ecco i tuoi strumenti admin. Tour rapido?',
    start: 'Mostrami',
    skip: 'Non ora',
  },
  tooltip: {
    skip: 'Salta',
    back: 'Indietro',
    next: 'Avanti',
    finish: 'Fatto',
    stepOf: 'di',
  },
  sections: {
    basics: 'Basi',
    member: 'Funzioni membro',
    coach: 'Funzioni coach',
    admin: 'Funzioni admin',
  },
  tours: {
    gettingStarted: {
      title: 'Primi passi',
      description: 'Impara le basi di WiediSync',
      steps: {
        nav: {
          title: 'Navigazione',
          body: 'Qui trovi tutte le sezioni dell\'app. Sul cellulare la navigazione è in basso.',
        },
        home: {
          title: 'Home',
          body: 'La tua dashboard personale: prossime partite, allenamenti, sondaggi aperti e moduli da compilare in un colpo d\'occhio.',
        },
        profile: {
          title: 'Il mio profilo',
          body: 'Visualizza e modifica le tue informazioni personali, i contatti e le impostazioni di notifica.',
        },
        language: {
          title: 'Lingua',
          body: 'La lingua dell\'app può essere cambiata in qualsiasi momento nel menu delle impostazioni.',
        },
        notifications: {
          title: 'Notifiche',
          body: 'Resta aggiornato — gestisci le notifiche push e gli avvisi in-app qui.',
        },
      },
    },
    trainingPlayer: {
      title: 'Allenamenti — Giocatore',
      description: 'Come gestire la tua presenza agli allenamenti',
      steps: {
        list: {
          title: 'Lista allenamenti',
          body: 'Tutti i prossimi allenamenti della tua squadra con data, ora e luogo.',
        },
        rsvpButtons: {
          title: 'RSVP',
          body: 'Tocca Sì, Forse o No. A seconda delle impostazioni della tua squadra potresti essere già confermato automaticamente — in tal caso tocca No solo quando non puoi venire. Il tuo coach vede le statistiche di partecipazione.',
        },
        absence: {
          title: 'Nota di assenza',
          body: 'Se non puoi partecipare, puoi aggiungere una breve spiegazione della tua assenza.',
        },
        stats: {
          title: 'Statistiche presenza',
          body: 'Tieni traccia del tuo tasso di presenza durante tutta la stagione.',
        },
      },
    },
    trainingCoach: {
      title: 'Allenamenti — Coach',
      description: 'Come gestire gli allenamenti come coach',
      steps: {
        overview: {
          title: 'Panoramica squadra',
          body: 'Vedi a colpo d\'occhio chi è presente, chi è assente e chi non ha ancora risposto.',
        },
        create: {
          title: 'Crea allenamento',
          body: 'Aggiungi una nuova sessione con data, ora, luogo e note facoltative.',
        },
        attendance: {
          title: 'Lista presenze',
          body: 'Visualizza la lista completa delle presenze per ogni allenamento ed esportala se necessario.',
        },
        cancel: {
          title: 'Annulla un allenamento',
          body: 'Usa l\'icona di annullamento su una scheda allenamento per annullarlo con un motivo facoltativo — i giocatori vengono notificati e gli RSVP si bloccano. Dallo stesso punto puoi ripristinare una sessione annullata.',
        },
      },
    },
    gamesPlayer: {
      title: 'Partite — Giocatore',
      description: 'Come seguire le tue partite e risultati',
      steps: {
        list: {
          title: 'Lista partite',
          body: 'Tutte le tue partite passate e future con data, avversario e risultato.',
        },
        rsvp: {
          title: 'RSVP partita',
          body: 'Conferma se sarai presente alla partita. Con la conferma automatica risulti presente in automatico — intervieni solo quando non puoi venire. Il tuo coach vede queste risposte.',
        },
        result: {
          title: 'Risultati',
          body: 'I risultati e i punteggi dei set vengono aggiornati automaticamente dal sistema lega. Usa il selettore di stagione nelle classifiche per sfogliare le stagioni passate.',
        },
        details: {
          title: 'Dettagli partita',
          body: 'Tocca una partita per vedere tutti i dettagli: luogo, orario di ritrovo, formazione e refertista.',
        },
      },
    },
    gamesCoach: {
      title: 'Partite — Coach',
      description: 'Strumenti coach nella pagina partite',
      steps: {
        dashboard: {
          title: 'Dashboard presenze',
          body: 'Apri la scheda Dashboard per le statistiche di presenza della tua squadra su un intervallo di date.',
        },
        stats: {
          title: 'Statistiche per giocatore',
          body: 'Partite giocate, presenze, assenze e tasso di presenza per giocatore — tocca una riga per il dettaglio partita per partita.',
        },
        manage: {
          title: 'Gestisci una partita',
          body: 'Apri una partita per i dettagli e le azioni coach — annullare o ripristinare una partita notifica la tua squadra. La pianificazione delle partite avviene nell\'app Spielplanung.',
        },
      },
    },
    events: {
      title: 'Eventi',
      description: 'Eventi del club e attività di squadra',
      steps: {
        list: {
          title: 'Lista eventi',
          body: 'Gli eventi del club e le attività di squadra sono mostrati qui.',
        },
        rsvp: {
          title: 'Iscrizione evento',
          body: 'Registra la tua partecipazione a eventi, tornei e attività sociali.',
        },
        details: {
          title: 'Dettagli evento',
          body: 'Luogo, orario, descrizione e lista dei partecipanti iscritti.',
        },
      },
    },
    absences: {
      title: 'Assenze',
      description: 'Gestisci le tue assenze pianificate',
      steps: {
        list: {
          title: 'Lista assenze',
          body: 'Tutte le tue assenze pianificate in un unico posto — visibili ai tuoi coach.',
        },
        create: {
          title: 'Aggiungi assenza',
          body: 'Tocca il pulsante più per aggiungere un periodo di assenza con data inizio, fine e motivo.',
        },
        coachView: {
          title: 'Vista coach',
          body: 'I coach vedono tutte le assenze della squadra sovrapposte al calendario per pianificare in anticipo.',
        },
      },
    },
    scorerPlayer: {
      title: 'Refertista — Giocatore',
      description: 'Le tue assegnazioni come refertista',
      steps: {
        duty: {
          title: 'Turno refertista',
          body: 'Se sei assegnato come refertista per una partita, lo vedrai qui e riceverai una notifica.',
        },
        filters: {
          title: 'Filtri',
          body: 'Restringi i tuoi turni per data, squadra o tipo di turno, oppure cerca una partita specifica.',
        },
        delegate: {
          title: 'Delega',
          body: 'Non puoi venire? Tocca Delega accanto al tuo nome per suggerire un compagno di squadra — riceverà una richiesta che può accettare o rifiutare.',
        },
      },
    },
    scorerAdmin: {
      title: 'Refertista — Admin',
      description: 'Assegna i turni refertista automaticamente',
      steps: {
        overview: {
          title: 'Panoramica stagione',
          body: 'Qui vengono caricate tutte le partite in casa della stagione corrente che richiedono una squadra di turno refertista o Täfeler.',
        },
        run: {
          title: 'Assegnazione automatica',
          body: 'Esegui l\'algoritmo di assegnazione per distribuire i turni equamente tra le squadre. Apri il pannello delle regole dell\'algoritmo per vedere come decide.',
        },
        summary: {
          title: 'Riepilogo squadre',
          body: 'Quanti turni ha ricevuto ogni squadra in questa esecuzione — controlla l\'equilibrio prima di salvare.',
        },
        assign: {
          title: 'Rivedi e correggi',
          body: 'Cambia la squadra di turno di qualsiasi partita tramite il suo menu a tendina, poi salva tutte le assegnazioni.',
        },
      },
    },
    hallenplanCoach: {
      title: 'Piano palestra — Coach',
      description: 'Gestisci gli slot della palestra',
      steps: {
        overview: {
          title: 'Piano palestra',
          body: 'Tutti gli slot di palestra per le tue squadre sono mostrati qui — allenamenti, partite e slot liberi.',
        },
        claim: {
          title: 'Prenota uno slot liberato',
          body: 'Quando una squadra libera uno slot, qui appare un badge — toccalo per vedere e prenotare gli slot disponibili per la tua squadra.',
        },
        release: {
          title: 'Colori degli slot',
          body: 'I colori indicano il tipo di slot: allenamenti, partite, slot liberati e chiusure. Tocca uno slot della tua squadra per gestirlo o liberarlo.',
        },
        virtual: {
          title: 'Voci automatiche',
          body: 'Partite, allenamenti ed eventi del calendario appaiono automaticamente come voci con un badge "Auto" — sono proiettati in tempo reale, non prenotati.',
        },
      },
    },
    profile: {
      title: 'Profilo e impostazioni',
      description: 'Configura il tuo account',
      steps: {
        contact: {
          title: 'I tuoi dati',
          body: 'Mantieni aggiornati i tuoi contatti — i tuoi coach ci fanno affidamento. Modificali tramite il pulsante Modifica profilo.',
        },
        attendance: {
          title: 'Conferma automatica',
          body: 'Scegli se essere confermato automaticamente per nuovi allenamenti, partite ed eventi. Le assenze hanno sempre la precedenza sulla conferma automatica.',
        },
        emails: {
          title: 'Notifiche email',
          body: 'Disattiva i singoli avvisi email — la campanella delle notifiche in-app mostra sempre tutto.',
        },
        privacy: {
          title: 'Privacy',
          body: 'Un badge "Nascosto" significa che i compagni di squadra non possono vedere la tua email. Modifica questo e altro in Modifica profilo.',
        },
      },
    },
    teams: {
      title: 'Squadre',
      description: 'Le tue squadre — e come unirti ad altre',
      steps: {
        list: {
          title: 'Le tue squadre',
          body: 'Tutte le tue squadre in un colpo d\'occhio. Tocca una squadra per vedere la rosa, lo staff e le partite.',
        },
        join: {
          title: 'Unisciti a un\'altra squadra',
          body: 'Richiedi di unirti a un\'altra squadra — scegli lo sport e la squadra, e un coach approva la tua richiesta. Anche lasciare una squadra funziona dallo stesso posto.',
        },
      },
    },
    forms: {
      title: 'Moduli',
      description: 'Compila i moduli del club e della squadra',
      steps: {
        list: {
          title: 'Moduli aperti',
          body: 'I moduli che il tuo club o la tua squadra ti chiedono di compilare sono elencati qui — i moduli aperti appaiono anche nella tua home.',
        },
        fill: {
          title: 'Compila un modulo',
          body: 'Tocca Compila per rispondere. Puoi modificare la tua risposta finché il modulo resta aperto.',
        },
        create: {
          title: 'Crea moduli',
          body: 'Coach, responsabili di squadra e comitato possono creare moduli, vedere le risposte ed esportarle.',
        },
      },
    },
    financeDues: {
      title: 'Le mie finanze',
      description: 'Paga quote e fatture nell\'app',
      steps: {
        iban: {
          title: 'IBAN per i rimborsi',
          body: 'I rimborsi del club vengono versati su questo conto — aggiungi o aggiorna il tuo IBAN qui.',
        },
        list: {
          title: 'Le tue fatture',
          body: 'Quote sociali e fatture del club con importi e stato di pagamento.',
        },
        pay: {
          title: 'Paga una fattura',
          body: 'Tocca una fattura aperta per espanderla, poi scansiona la QR-fattura svizzera con TWINT o la tua app bancaria e tocca "Ho pagato".',
        },
        status: {
          title: 'Stato del pagamento',
          body: 'Dopo aver segnalato un pagamento la fattura mostra "In attesa di conferma" finché il tesoriere non la conferma.',
        },
      },
    },
    expenses: {
      title: 'Spese',
      description: 'Fatti rimborsare le spese del club',
      steps: {
        upload: {
          title: 'Carica una ricevuta',
          body: 'Scegli una foto o un PDF della tua ricevuta — importo, data e fornitore vengono letti automaticamente.',
        },
        iban: {
          title: 'Controlla l\'IBAN',
          body: 'Prima di inviare, controlla l\'IBAN di accredito — è il tuo conto su cui il club effettua il rimborso.',
        },
        submissions: {
          title: 'Le mie richieste',
          body: 'Segui qui le tue richieste: in attesa, pagate o rifiutate. Ricevi una notifica non appena il tesoriere decide.',
        },
      },
    },
    inbox: {
      title: 'Messaggi',
      description: 'Chatta con membri e squadre',
      steps: {
        new: {
          title: 'Avvia una conversazione',
          body: 'Tocca Nuovo messaggio per scrivere a un membro o avviare una chat di gruppo. Il tuo primo messaggio a una persona nuova arriva come richiesta che deve accettare prima che la conversazione si apra.',
        },
        conversations: {
          title: 'Le tue conversazioni',
          body: 'Messaggi diretti, chat di gruppo e richieste in sospeso sono raggruppati qui — toccane uno per aprirlo. Le chat di squadra restano sulla pagina di ciascuna squadra.',
        },
      },
    },
    news: {
      title: 'Notizie',
      description: 'Annunci del club e i tuoi avvisi',
      steps: {
        feed: {
          title: 'Feed notizie',
          body: 'Gli annunci del club e le tue notifiche passate, uniti dal più recente. Gli annunci fissati restano in cima — tocca una riga per leggere l\'annuncio completo o andare al suo argomento.',
        },
        loadMore: {
          title: 'Elementi più vecchi',
          body: 'All\'inizio si caricano solo gli elementi più recenti. Tocca Carica altro per andare più indietro nell\'archivio.',
        },
      },
    },
    fines: {
      title: 'Multe',
      description: 'Le tue multe del club e come saldarle',
      steps: {
        list: {
          title: 'Le tue multe',
          body: 'Ogni multa che ti è stata assegnata, con categoria, importo e stato. Allenatori e comitato vedono qui anche le multe delle loro squadre.',
        },
        outstanding: {
          title: 'Quanto devi',
          body: 'Il tuo totale aperto è in alto. Saldalo con la cassa della squadra o con il tesoriere — la segna come pagata qui una volta ricevuta.',
        },
        filter: {
          title: 'Filtra',
          body: 'Restringi l\'elenco per stato — aperta, pagata o annullata.',
        },
      },
    },
    calendar: {
      title: 'Calendario',
      description: 'Tutte le partite, gli allenamenti e gli eventi in una vista',
      steps: {
        view: {
          title: 'Cambia vista',
          body: 'Passa tra il piano palestra, una griglia mensile e — se giochi — il tuo calendario personale delle partite proposte e confermate.',
        },
        filter: {
          title: 'Filtri',
          body: 'Scegli quali tipi di voce mostrare — partite, allenamenti, eventi, chiusure, assenze e altro — e quali squadre.',
        },
        ical: {
          title: 'Abbonati o esporta',
          body: 'Abbonati dall\'app calendario del telefono o del computer per mantenere tutto sincronizzato, oppure esporta l\'intervallo attuale come file .ics.',
        },
        grid: {
          title: 'Sfoglia le voci',
          body: 'Colori e icone indicano il tipo di voce. Tocca una voce per tutti i dettagli.',
        },
      },
    },
  },
} as const
