export default {
  // Privacy Policy page
  privacyTitle: 'Informativa sulla privacy',
  lastUpdated: 'Ultimo aggiornamento: 4 aprile 2026',

  controllerTitle: '1. Titolare del trattamento',
  controllerText:
    'KSC Wiedikon\nSchrennengasse 7\n8003 Zürich\nEmail: kscw@kscw.ch',

  dataCollectedTitle: '2. Dati raccolti',
  dataAccountTitle: 'Dati dell\'account (alla registrazione)',
  dataAccountText:
    'Al momento della registrazione come membro del club, raccogliamo: nome, indirizzo email, numero di telefono e data di nascita. Le foto del profilo vengono caricate e gestite dai membri stessi. Numero di licenza, posizione e assegnazione alla squadra sono impostati dagli allenatori o dal comitato.',
  dataRosterTitle: 'Dati del roster (pubblici)',
  dataRosterText:
    'Nelle pagine delle squadre accessibili al pubblico vengono visualizzati nomi dei giocatori, numeri di maglia, posizioni e foto. Queste informazioni corrispondono ai dati pubblicati anche da Swiss Volley.',
  dataInternalTitle: 'Dati interni del club',
  dataInternalText:
    'Presenze agli allenamenti, assenze (incluso il motivo), incarichi di segnapunti e risultati delle partite vengono registrati internamente per la gestione del club e sono visibili solo ai membri con accesso o agli allenatori.',
  dataTechnicalTitle: 'Dati tecnici',
  dataTechnicalText:
    'Quando si visita il sito web, informazioni tecniche come indirizzo IP e dati del browser vengono elaborate automaticamente dal nostro provider di hosting (Cloudflare).',

  dataRegisterTitle:
    'Dati anagrafici per amministrazione e federazioni',
  dataRegisterText:
    'Per l’amministrazione del club e l’iscrizione alle federazioni registriamo inoltre indirizzo postale, NAP e località, nazionalità, sesso, numero AVS e — per gli allenatori giovanili — il numero personale G+S. Il numero AVS è necessario per le notifiche alle federazioni e a G+S ed è visibile solo al comitato e all’amministrazione.',
  dataFinanceTitle:
    'Dati di pagamento e fatturazione',
  dataFinanceText:
    'Per fatturare le quote sociali registriamo la categoria di quota, l’indirizzo di fatturazione e le coordinate bancarie (IBAN). Questi dati sono visibili solo al comitato e all’amministrazione finanziaria.',
  dataIdentityTitle:
    'Documenti d’identità (cifratura end-to-end)',
  dataIdentityText:
    'Alcune federazioni richiedono una copia di un documento d’identità per la licenza di gioco. Viene cifrata già nel browser del membro (AES-256-GCM) e raggiunge il nostro server solo come testo cifrato; la chiave è incapsulata separatamente per le persone autorizzate. Né il gestore del server né l’amministrazione possono leggere il file senza tale chiave.',

  legalBasisTitle: '3. Base giuridica',
  legalBasisText:
    'Il trattamento dei dati personali si basa su:',
  legalBasisContract:
    'Esecuzione del contratto (appartenenza al club) — per la gestione dei dati dei membri, degli allenamenti e della pianificazione delle partite.',
  legalBasisInterest:
    'Interesse legittimo — per la pubblicazione dei roster delle squadre, come consuetudine nello sport di club e atteso dai membri.',
  legalBasisConsent:
    'Consenso — I membri caricano la propria foto del profilo e possono modificarla o rimuoverla in qualsiasi momento.',

  thirdPartyTitle: '4. Responsabili del trattamento',
  thirdPartyIntro: 'I seguenti fornitori di servizi sono utilizzati come responsabili del trattamento:',
  thirdPartyCloudflare:
    'Cloudflare, Inc. — Hosting frontend (Cloudflare Pages) | Globale (sede USA) | DPA, Clausole contrattuali standard, Swiss-US Data Privacy Framework',
  thirdPartySwissVolley:
    'API Swiss Volley (api.volleyball.ch) — Recuperiamo dati di partite e classifiche disponibili pubblicamente. Nessun dato personale viene trasmesso a Swiss Volley.',
  thirdPartyGCal:
    'Google Calendar — Recuperiamo un feed di calendario pubblico per visualizzare gli orari della palestra. Nessun dato personale viene trasmesso a Google.',
  thirdPartyBasketplan:
    'Basketplan (basketball.ch) — Recuperiamo dati di partite e classifiche disponibili pubblicamente. Nessun dato personale viene trasmesso a Basketplan.',
  thirdPartyMigadu:
    'Migadu (migadu.com) — Invio email per notifiche e promemoria | Svizzera | DPA',
  thirdPartyHetzner:
    'Hetzner Online GmbH — Hosting backend (Directus) | Germania (datacenter di Norimberga) | DPA, conforme al GDPR',
  thirdPartyClubDesk:
    'ClubDesk (amministrazione del club, Svizzera): i dati anagrafici dei soci, inclusi recapiti, numero AVS e coordinate bancarie, sono sincronizzati con ClubDesk, da cui proviene gran parte di questi dati.',
  thirdPartySentry:
    'Sentry (sentry.io) — Tracciamento errori e monitoraggio prestazioni | UE (de.sentry.io, Germania) | DPA, conforme al GDPR. Nessun dato personale (nome, email) viene trasmesso a Sentry.',
  thirdPartyCloudflareWorkers:
    'Cloudflare Workers — Elaborazione delle notifiche push | Globale (sede USA) | DPA, Clausole contrattuali standard, Swiss-US Data Privacy Framework',

  retentionTitle: '5. Conservazione dei dati',
  retentionText:
    'I tuoi dati personali vengono conservati per tutto il tempo in cui possiedi un account attivo sulla piattaforma. Su richiesta o al termine della tua appartenenza al club, i tuoi dati verranno cancellati entro 30 giorni, salvo che un periodo di conservazione più lungo sia previsto dalla legge. Puoi anche eliminare il tuo account in qualsiasi momento direttamente dalle impostazioni del profilo.',

  storageTitle: '6. Archiviazione dei dati',
  storageServer:
    'I dati sono archiviati su un server di Hetzner Online GmbH in Germania (datacenter di Norimberga) con Directus. Il frontend è servito tramite Cloudflare Pages.',
  storageLocal:
    'Le seguenti preferenze non personali sono memorizzate nel tuo browser: schema colori (chiaro/scuro) e impostazione della lingua. Per gli utenti con accesso, un token di sessione è memorizzato nel browser.',
  storageNoCookies:
    'Il sito web stesso non imposta cookie. Cloudflare può impostare cookie tecnicamente necessari che non richiedono consenso.',

  rightsTitle: '7. I tuoi diritti',
  rightsText:
    'Ai sensi della Legge federale sulla protezione dei dati (LPD), hai i seguenti diritti:',
  rightsAccess: 'Diritto di accesso — Puoi richiedere informazioni sui tuoi dati archiviati.',
  rightsCorrection: 'Diritto di rettifica — Puoi richiedere la correzione di dati inesatti. La maggior parte dei dati può essere aggiornata direttamente nel tuo profilo.',
  rightsDeletion: 'Diritto alla cancellazione — Puoi richiedere la cancellazione dei tuoi dati o eliminare il tuo account autonomamente.',
  rightsPortability: 'Diritto alla portabilità dei dati — Puoi ricevere i tuoi dati in un formato di uso comune.',
  rightsObject: 'Diritto di opposizione — Puoi opporti al trattamento dei tuoi dati in qualsiasi momento.',
  rightsContact:
    'Per richieste relative ai tuoi diritti, contatta: kscw@kscw.ch',
  rightsFDPIC:
    'Hai inoltre il diritto di presentare un reclamo all\'Incaricato federale della protezione dei dati e della trasparenza (IFPDT): www.edoeb.admin.ch',

  photosTitle: '8. Foto',
  photosText:
    'Le foto dei giocatori vengono caricate dai membri stessi tramite il proprio profilo e possono essere modificate o rimosse in qualsiasi momento. Le foto caricate sono visibili nelle pagine pubbliche delle squadre.',

  messagingTitle: '9. Messaggistica',
  messagingIntro:
    'Da aprile 2026 la piattaforma offre un sistema di messaggistica integrato per chat di squadra, messaggi diretti, sondaggi e moderazione. L\'utilizzo è facoltativo e richiede un consenso esplicito.',
  messagingDataTitle: 'Cosa conserviamo',
  messagingDataText:
    'Nel contesto del sistema di messaggistica raccogliamo e conserviamo: messaggi inviati (testo), reazioni (emoji), segnalazioni (inclusa un\'istantanea del messaggio segnalato al momento della segnalazione), appartenenze alle conversazioni, liste di blocco, decisioni sul consenso e abbonamenti push se hai attivato le notifiche.',
  messagingRetentionTitle: 'Per quanto tempo conserviamo i dati',
  messagingRetentionText:
    'I messaggi vengono eliminati automaticamente e definitivamente dopo 12 mesi. I messaggi eliminati dall\'utente vengono rimossi definitivamente dopo ulteriori 30 giorni (durante questo periodo sono già nascosti ma restano consultabili per le segnalazioni di moderazione). Le richieste di messaggio rifiutate vengono rimosse dopo 90 giorni. Le segnalazioni vengono conservate per tutta la durata dell\'account per garantire la tracciabilità delle decisioni di moderazione.',
  messagingAccessTitle: 'Chi ha accesso',
  messagingAccessText:
    'I messaggi possono essere letti esclusivamente da te e dagli altri membri della stessa conversazione. Gli amministratori del club hanno accesso ai messaggi segnalati (inclusa l\'istantanea) per l\'esame e la moderazione. L\'amministrazione del database (attualmente: Luca Canepa) dispone, in qualità di gestore dell\'infrastruttura, di accesso tecnico all\'intero database. I messaggi non sono crittografati end-to-end; vengono archiviati non crittografati su un server Hetzner in Germania, protetti da TLS in transito, autenticazione tramite chiave SSH e un firewall a livello di database.',
  messagingRightsTitle: 'I tuoi diritti e impostazioni',
  messagingRightsText:
    'Puoi abilitare o disabilitare la messaggistica in qualsiasi momento sotto Opzioni → Messaggi (chat di squadra e messaggi diretti separatamente). Dalla stessa pagina puoi esportare i tuoi dati di messaggistica come file JSON (al massimo 1× ogni 24 ore). L\'eliminazione del tuo account comporta la cancellazione a cascata dei tuoi messaggi, reazioni, blocchi, appartenenze alle conversazioni e richieste. Le segnalazioni in cui compari come segnalatore o persona segnalata vengono anonimizzate (riferimenti impostati a NULL), mentre il contenuto dell\'istantanea viene conservato a fini di documentazione.',
  messagingReportsTitle: 'Segnalazioni e moderazione',
  messagingReportsText:
    'I membri possono segnalare messaggi inappropriati. Una segnalazione memorizza un\'istantanea del messaggio segnalato (in modo che modifiche o eliminazioni successive non compromettano la moderazione) e viene sottoposta agli amministratori per l\'esame. Gli amministratori possono eliminare messaggi, contrassegnare le segnalazioni come risolte o — nei casi gravi — bloccare singoli membri dalla messaggistica.',
  messagingPushTitle: 'Notifiche push',
  messagingPushText:
    'Le notifiche push per i nuovi messaggi sono facoltative e disattivate per impostazione predefinita. Sotto Opzioni → Messaggi puoi scegliere se le notifiche appaiono generiche ("Nuovo messaggio") o includono il nome del mittente e una breve anteprima del testo. La consegna è gestita tramite Cloudflare Workers (vedi sezione 4).',

  changesTitle: '10. Modifiche',
  changesText:
    'Ci riserviamo il diritto di aggiornare questa informativa sulla privacy secondo necessità. La versione attuale è disponibile su questa pagina.',

  // Impressum page
  impressumTitle: 'Note legali',
  impressumClubName: 'KSC Wiedikon',
  impressumAddress: 'Schrennengasse 7\n8003 Zürich',
  impressumFullName: 'Kultur- und Sportclub Wiedikon',
  impressumContact: 'Email: kscw@kscw.ch',
  impressumWebsite: 'Sito web: kscw.ch',
  impressumBoard: 'Responsabile: Comitato del KSC Wiedikon',
  impressumHosting: 'Hosting: Cloudflare Pages (frontend), Hetzner Online GmbH, Germania (backend)',
  impressumLinks: 'Responsabilità per i link',
  impressumLinksText:
    'Il nostro sito contiene link a siti web esterni di terze parti sui cui contenuti non abbiamo alcuna influenza. Il rispettivo fornitore è sempre responsabile del contenuto delle pagine collegate. In caso di violazioni legali, rimuoveremo immediatamente tali link.',
  impressumCopyright: 'Diritto d\'autore',
  impressumCopyrightText:
    'I contenuti e le opere creati dal KSC Wiedikon su questo sito web sono soggetti al diritto d\'autore svizzero. La riproduzione, l\'elaborazione o la diffusione al di fuori dei limiti del diritto d\'autore richiede il consenso scritto del club.',
  impressumSocial: 'Social media',
  impressumFacebook: 'Facebook: KSC Wiedikon',
  impressumInstagram: 'Instagram: @ksc_wiedikon',
  impressumDisclaimer: 'Esclusione di responsabilità',
  impressumDisclaimerText:
    'Il KSC Wiedikon non si assume alcuna responsabilità per la correttezza, completezza o attualità delle informazioni fornite. Le richieste di risarcimento danni materiali o immateriali nei confronti del KSC Wiedikon sono generalmente escluse.',

  // Privacy notice bar
  noticeCookies: 'Questo sito non utilizza cookie di tracciamento.',
  noticeLink: 'Scopri di più',
} as const
