// The written in-app guide — section CONTENT only. Metadata (icons, groups,
// audience, routes) lives in src/modules/guide/sections.ts; GuidePage loads
// this file lazily into the `guide` namespace. Generated from the 2026-09-15
// rewrite; edit by hand from here on (sentence case, **bold** = a UI label).
export default {
  "sections": {
    "welcome": {
      "title": "Benvenuto in Wiedisync",
      "summary": "A cosa serve l'app, chi la usa, come si differenziano i ruoli e come è organizzata questa guida.",
      "body": [
        {
          "t": "p",
          "text": "Wiedisync è l'app per i membri del KSC Wiedikon: il posto unico per partite, allenamenti, eventi, presenze, servizi segnapunti, finanze del club e il tuo profilo — sul telefono o in qualsiasi browser."
        },
        {
          "t": "note",
          "text": "Gratuita e strumento ufficiale del club, sviluppata e gestita dal club come alternativa alle app a pagamento per la gestione delle squadre; ti serve per le assenze, la gestione delle partite e soprattutto per i servizi segnapunti."
        },
        {
          "t": "h",
          "text": "Chi la usa"
        },
        {
          "t": "p",
          "text": "Tutti usano la stessa app; quello che vedi dipende dal tuo ruolo, mostrato come badge accanto ai nomi: **Giocatore**, **Coach**, **Resp. squadra** o **Comitato**."
        },
        {
          "t": "ul",
          "items": [
            "Giocatori: le tue attività, dire se vieni, le assenze, i servizi segnapunti, le fatture e il tuo profilo.",
            "Genitori: un solo login per tutta la famiglia; una barra in alto mostra quale account usi e permette di cambiarlo (vedi la sezione Nuclei familiari e account famiglia).",
            "Allenatori e responsabili di squadra: gestiscono la squadra — rosa, allenamenti, eventi, partite, moduli, sondaggi, multe e finanze della squadra. Il gruppo **Squadre e coaching** è scritto per voi.",
            "Capitani: portano il badge **Capitano** nella rosa e possono saldare le fatture della squadra in **Finanze → Finanze della squadra**.",
            "Spielplaner: pianificano le partite in casa del club dalla voce **Pianificazione** nel menu (vedi la sezione Spielplanung).",
            "Comitato e finanze: le finanze del club — quote, fatture, pagamenti e contabilità (vedi la sezione Finanze del club).",
            "Admin: iscrizioni, palestre, assegnazione dei refertisti, comunicazione del club e banca dati dei membri. **Admin VB** e **Admin BB** coprono uno sport ciascuno; gli strumenti **Superadmin** sono per chi gestisce l'app. I poteri admin valgono solo con la **Modalità admin** attiva in **Options**."
          ]
        },
        {
          "t": "h",
          "text": "Come è organizzata questa guida"
        },
        {
          "t": "p",
          "text": "La guida segue quello che fai: **Basi** (installazione, accesso, navigazione, home, notifiche), **Quotidiano** (calendario, attività, assenze, servizio segnapunti, squadre, profilo), **Soldi** (fatture, spese, multe), **Squadre e coaching** e **Admin e pianificazione**. Vedi solo le sezioni che il tuo ruolo può usare."
        },
        {
          "t": "tip",
          "text": "Apri la guida da **Altro → Options → Guida** sul telefono o dall'icona del tocco accademico accanto a **Options** sul desktop; il pulsante ? accanto al titolo di una pagina apre la sezione di quella pagina."
        },
        {
          "t": "h",
          "text": "Dove trovare aiuto"
        },
        {
          "t": "p",
          "text": "Qualcosa non è chiaro o non funziona? **Options → Feedback** invia una segnalazione di bug, un'idea o un feedback generale, con screenshot (vedi la sezione Feedback, stato e novità). Per domande su squadra e affiliazione rivolgiti al tuo allenatore o agli admin del club."
        },
        {
          "t": "h",
          "text": "Wiedisync e kscw.ch"
        },
        {
          "t": "p",
          "text": "kscw.ch è il sito pubblico del club: mostra ogni squadra con la sua rosa ed è dove i nuovi membri si iscrivono; Wiedisync è l'app riservata ai membri che sta dietro. Condividono gli stessi dati, quindi ciò che i visitatori vedono di te — cognome, anno di nascita, foto — segue la privacy del tuo profilo (vedi la sezione Il tuo profilo)."
        }
      ]
    },
    "install": {
      "title": "Installa l'app",
      "summary": "Aggiungi Wiedisync alla schermata Home del telefono e attiva le notifiche push, dispositivo per dispositivo.",
      "body": [
        {
          "t": "p",
          "text": "Wiedisync è una web app: non c'è nulla da scaricare da un app store. Sul telefono puoi aggiungerla alla schermata Home, così si apre a schermo intero come un'app normale. La pagina Home mostra il banner **Aggiungi Wiedisync alla schermata Home** finché non la installi. **Mostrami come** apre i passaggi per il tuo dispositivo, **Ricordamelo più tardi** nasconde il banner fino alla prossima apertura del browser e **Ho capito** lo nasconde definitivamente in questo browser. I passaggi si trovano anche nella guida (**Altro → Options → Guida** sul telefono, l'icona **Guida** nella barra in alto sul computer) sotto **Installa l'app sul telefono**."
        },
        {
          "t": "h",
          "text": "Android"
        },
        {
          "t": "ol",
          "items": [
            "Tocca **Mostrami come** sul banner oppure apri la scheda della guida. Se il browser propone un'installazione diretta, tocca **Installa** e conferma.",
            "Altrimenti apri il menu del browser (⋮ in alto a destra).",
            "Tocca **Installa app** o **Aggiungi alla schermata Home**.",
            "Conferma toccando **Installa**."
          ]
        },
        {
          "t": "h",
          "text": "iPhone e iPad"
        },
        {
          "t": "ol",
          "items": [
            "Apri la pagina in Safari. Gli altri browser su iOS non possono aggiungere alla schermata Home; se ci provi, l'app mostra un avviso.",
            "Tocca il pulsante Condividi in basso in Safari.",
            "Scorri verso il basso e tocca **Aggiungi a Home**.",
            "Tocca **Aggiungi** in alto a destra."
          ]
        },
        {
          "t": "p",
          "text": "Una volta installata, riaprendo i passaggi compare **Wiedisync è già installata su questo dispositivo.** Nell'app installata, **Pianificazione** si apre nel browser abituale. Sul computer non serve installare nulla; Chrome offre lo stesso pulsante **Installa** nella scheda della guida se preferisci una finestra separata."
        },
        {
          "t": "h",
          "text": "Notifiche push"
        },
        {
          "t": "p",
          "text": "Le notifiche push si attivano per dispositivo, quindi ripeti l'operazione su ogni telefono o computer che usi. Apri la campanella (computer) o **Altro → Notifiche** (telefono) e scorri fino in fondo al pannello. Accanto a **Notifiche push**, tocca **Attiva**; il browser chiede il permesso una sola volta. **Disattiva** nello stesso punto le spegne di nuovo."
        },
        {
          "t": "p",
          "text": "Le notifiche push coprono ciò che richiede una reazione rapida: partite per cui sei convocato, allenamenti annullati, promemoria per le attività di domani e per le scadenze di risposta, scadenze mancate, notizie del club, inviti a eventi, nuovi moduli, multe, aggiornamenti sullo stato delle spese, cambiamenti dello stato della licenza, deleghe del servizio segnapunti, assenze che qualcuno ha inserito per te e i messaggi che un allenatore o un responsabile di squadra invia con **Contatta** quando spunta l'opzione push. Toccando una notifica push si apre la pagina corrispondente. Le altre modifiche, ad esempio una partita spostata, compaiono solo nella campanella."
        },
        {
          "t": "note",
          "text": "Se hai toccato Blocca nella richiesta di permesso del browser, il pannello mostra **Le notifiche push sono bloccate nelle impostazioni del browser.** e l'app non può chiedere di nuovo. Consenti le notifiche per il sito nelle impostazioni del browser o del telefono, poi tocca **Attiva**."
        },
        {
          "t": "tip",
          "text": "Se manca la riga **Notifiche push**, il tuo browser non supporta le notifiche push. Brave su Android le blocca, quindi lì la riga è nascosta; usa Chrome o Firefox."
        }
      ]
    },
    "account": {
      "title": "Il tuo account",
      "summary": "Accesso, attivazione di un account su invito, password, approvazione, lingua, modalità scura ed eliminazione dell'account.",
      "body": [
        {
          "t": "p",
          "text": "Premi **Accedi** e inserisci **Email** e **Password**; non si può accedere con Google o Apple. Un link condiviso aperto senza accesso si riapre dopo il login."
        },
        {
          "t": "h",
          "text": "Ottenere un account"
        },
        {
          "t": "p",
          "text": "La registrazione è solo su invito; l'adesione al club si gestisce su kscw.ch. Il tuo allenatore o responsabile di squadra ti invia poi un link di invito per email o te lo mostra come codice QR. Aprilo, scegli la **Lingua**, scegli e conferma una password e premi **Attiva account**: sei connesso."
        },
        {
          "t": "ul",
          "items": [
            "Un link funziona una sola volta e scade dopo 30 giorni; uno vecchio mostra **Invito non valido** o **Invito già utilizzato**: chiedi un nuovo link al tuo allenatore.",
            "Nessun invito? Premi **Registrati**, inserisci l'email che il club ha registrato e premi **Continua**. Un membro senza login riceve un codice di 8 cifre per email, poi completa nome, squadre e password.",
            "Un'email sconosciuta mostra **Registrazione solo su invito**; premi **Prova con un'altra email** o segui il link a kscw.ch.",
            "Se hai richiesto una squadra di cui non fai ancora parte, vedi **In attesa di approvazione** finché allenatore, responsabile di squadra o admin non ti approva; poi premi **Aggiorna stato**."
          ]
        },
        {
          "t": "note",
          "text": "La password deve avere almeno 8 caratteri, con una lettera e un numero o un carattere speciale. Le password troppo comuni vengono rifiutate."
        },
        {
          "t": "h",
          "text": "Password dimenticata"
        },
        {
          "t": "ol",
          "items": [
            "Nella pagina di accesso premi **Password dimenticata?**.",
            "Inserisci la tua email e premi **Invia il link**. Il link è valido per un'ora e apre il modulo **Nuova password**; premi **Salva password**.",
            "Non hai mai avuto una password? Premi **Non hai mai impostato una password? Usa invece un codice** e inserisci il codice di 8 cifre che ricevi per email."
          ]
        },
        {
          "t": "note",
          "text": "Un reset via email o codice elimina la chiave dei tuoi documenti d'identità e dovrai ricaricare il documento. Se conosci la password, usa invece **Cambia password** in **Modifica profilo**, che conserva la chiave (vedi la sezione Il tuo profilo)."
        },
        {
          "t": "h",
          "text": "Lingua e modalità scura"
        },
        {
          "t": "p",
          "text": "Entrambe si trovano in **Options** (icona a ingranaggio in alto a destra su desktop; **Altro → Options** sul telefono). La **Modalità scura** viene ricordata per ogni dispositivo; l'app si avvia in modalità scura. **Language** (Deutsch, English, Français, Italiano, CH-DE) segue il tuo browser finché non ne scegli una dopo l'accesso: la scelta viene salvata nel tuo profilo per tutti i tuoi dispositivi. Il resto di quel menu è descritto nella sezione Orientarsi nell'app."
        },
        {
          "t": "h",
          "text": "Uscire ed eliminare l'account"
        },
        {
          "t": "p",
          "text": "**Esci** si trova nel menu dell'avatar su desktop e accanto al tuo nome in **Altro** sul telefono; rimuove anche la chiave dei documenti d'identità da quel dispositivo. Per eliminare l'account, apri **Il mio profilo**, scorri a **Zona pericolosa**, premi **Elimina account**, digita il tuo indirizzo email e premi **Elimina account definitivamente**. Non si può annullare. Un genitore non può farlo dall'account di un figlio."
        }
      ]
    },
    "navigation": {
      "title": "Orientarsi nell'app",
      "summary": "Dove si trova ogni pagina su computer e telefono, e a cosa servono il menu Options, il selettore sport e i pulsanti ?.",
      "body": [
        {
          "t": "p",
          "text": "Su computer le pagine stanno nei menu a tendina della barra in alto. Sul telefono le più usate sono schede in basso, le altre dietro **Altro**. Le pagine che non puoi usare non vengono elencate."
        },
        {
          "t": "h",
          "text": "Su computer: la barra in alto"
        },
        {
          "t": "ul",
          "items": [
            "**Home** (anche tramite il logo).",
            "**Attività** → **Calendario**, **Partite e risultati**, **Tabellone in diretta**, **Allenamenti**, **Eventi**.",
            "**Strumenti membri** → **Squadra** (**Squadre** se fai parte di più squadre o sei in modalità admin), **Assenze**, **Servizio segnapunti**, **Notizie**, più **Moduli** ed **Esportazione J+S** se alleni o sei responsabile di una squadra.",
            "**Finanze** → **Finanze personali**, **Finanze della squadra** e **Finanze del club**, a seconda del ruolo.",
            "**Pianificazione** (Spielplaner, allenatori e responsabili di squadra) apre l'app di pianificazione; **Admin** (solo admin) termina con **Tutti gli strumenti admin**.",
            "Icone a destra: campanella (notifiche), tocco accademico (**Guida**), ingranaggio (**Options**), avatar (**Il mio profilo**, **Esci**)."
          ]
        },
        {
          "t": "h",
          "text": "Sul telefono: schede in basso e Altro"
        },
        {
          "t": "p",
          "text": "La barra in basso mostra **Home**, **Calendario**, **Partite**, **Allenamenti** e **Altro**. **Altro** contiene **Notifiche**, **Eventi**, **Strumenti membri**, **Finanze**, **Pianificazione**, **Admin**, la riga del tuo profilo, **Esci**, la sezione **Options** e i link **Privacy** e **Note legali**. Un punto rosso su **Altro** indica notifiche non lette; la riga **Notifiche** mostra quante sono."
        },
        {
          "t": "h",
          "text": "Il menu Options"
        },
        {
          "t": "ul",
          "items": [
            "**Modalità scura** – predefinita; ricordata su questo dispositivo.",
            "**Language** – Deutsch, English, Français, Italiano o CH-DE. Dopo l'accesso la scelta viene salvata nel profilo e ti segue sugli altri dispositivi.",
            "**Modalità admin** – solo per admin e membri del comitato, vedi sotto.",
            "**Feedback**, **Stato** e **Novità** (con la versione attuale). Sul telefono qui trovi anche **Guida**."
          ]
        },
        {
          "t": "h",
          "text": "Selettore sport e pulsanti ?"
        },
        {
          "t": "p",
          "text": "Se le tue squadre coprono pallavolo e pallacanestro, un selettore sport compare su **Home** (le icone a palla accanto al logo; il logo mostra tutti gli sport) e su **Partite e risultati** (Volleyball, Basketball, **Tutti gli sport**, anche in modalità admin). Chi ha un solo sport non vede il selettore. La scelta viene ricordata per membro su questo dispositivo."
        },
        {
          "t": "p",
          "text": "Accanto al titolo di molte pagine un pulsante **?** apre questa guida alla sezione di quella pagina. La guida completa sta sotto **Options → Guida** sul telefono e dietro l'icona del tocco accademico su computer."
        },
        {
          "t": "h",
          "text": "Se sei admin o membro del comitato"
        },
        {
          "t": "p",
          "text": "La **Modalità admin** in **Options** amplia ciò che vedi, non le pagine elencate. Attiva, un banner dorato **Modalità admin** compare sopra ogni pagina tranne l'app di pianificazione, le liste mostrano tutte le squadre del club e i poteri admin sulle pagine delle squadre sono attivi; disattivata, vedi le tue squadre come qualsiasi membro. È disattivata di default e ricordata per dispositivo; le pagine sotto **Admin** si aprono in entrambe le modalità. I membri del comitato senza ruolo admin trovano l'interruttore solo sul telefono, sotto **Altro → Options**: dà la stessa vista a livello di club, in sola lettura."
        }
      ]
    },
    "home": {
      "title": "Home",
      "summary": "Cosa mostra ogni blocco della pagina iniziale e cosa puoi fare da lì.",
      "body": [
        {
          "t": "p",
          "text": "**Home** è la prima pagina dopo l'accesso: barra in alto (desktop) o schede in basso (telefono). Le schede compaiono solo se hanno contenuto. Se giochi a pallavolo e pallacanestro, un selettore dello sport in alto filtra partite, risultati e allenamenti; la pagina Partite lo segue."
        },
        {
          "t": "h",
          "text": "I blocchi principali"
        },
        {
          "t": "ul",
          "items": [
            "**Prossimi 7 giorni**: una striscia con partite, allenamenti, eventi, chiusure delle palestre, i tuoi servizi segnapunti e i compleanni dei compagni di squadra.",
            "**Novità**: le tre voci più recenti, prima gli annunci fissati in alto. Toccando una notifica la segni come letta e apri l'attività. Una fattura aperta ha una riga propria sopra. **Mostra tutto** apre la pagina Notizie.",
            "**Sondaggi attivi**: vota nei sondaggi aperti delle tue squadre.",
            "**Moduli da compilare**: i moduli che ti aspettano, con una scadenza **Chiusura**. **Compila** apre il modulo, **Modifica** cambia le tue risposte.",
            "**Le tue fatture** e **Multe aperte**: solo finché c'è qualcosa di aperto; **Vedi tutte** apre l'elenco completo.",
            "**Classifiche** (solo desktop): le classifiche dei campionati delle tue squadre, con un menu per la stagione; una riga apre le classifiche nella pagina Partite. Finché Swiss Volley non pubblica i dati compare **I dati saranno comunicati più avanti da Swiss Volley**."
          ]
        },
        {
          "t": "h",
          "text": "I miei appuntamenti o Per categoria"
        },
        {
          "t": "p",
          "text": "**I miei appuntamenti** è un unico elenco per data con partite, allenamenti, eventi e servizi segnapunti: 10 righe, **Mostra di più** ne aggiunge 10. **Per categoria** li divide in **Prossimi allenamenti**, **Eventi**, **Ultimi risultati** e **Prossime partite**; il chip **Le mie squadre** passa risultati e partite dalle tue squadre a tutto il club. Tocca una riga per aprirla e rispondere. La striscia a sinistra è la tua risposta: verde sì, giallo forse, rosso no, arancione lista d'attesa, grigio assente."
        },
        {
          "t": "note",
          "text": "I servizi segnapunti compaiono sempre nei tuoi appuntamenti e qui non si possono rifiutare; per cederne uno vedi la sezione Servizio segnapunti."
        },
        {
          "t": "h",
          "text": "Schede che richiedono la tua attenzione"
        },
        {
          "t": "ul",
          "items": [
            "**Richiesta di servizio** (sopra **Novità**): qualcuno vuole cederti un servizio segnapunti. **Accetta** o **Rifiuta**.",
            "**Sei di turno come …** (il tuo ruolo, ad esempio Segnapunti): visibile da 7 giorni prima della partita fino a 3 ore dopo l'inizio; da 60 minuti prima a 30 dopo l'inizio, **Emergenza: contatta i responsabili** mostra allenatore e responsabile della squadra che gioca e avvisa il club.",
            "**Aggiungi il tuo IBAN** / **Conferma il tuo IBAN**: visibile finché il club non ha un IBAN confermato da te. **Aggiungi IBAN** o **Conferma in Finanze** apre **Fatture e rimborsi**; **Più tardi** nasconde la scheda su questo dispositivo."
          ]
        },
        {
          "t": "h",
          "text": "Se sei allenatore o responsabile di squadra"
        },
        {
          "t": "p",
          "text": "**Spese arbitrali non registrate** elenca le partite in casa di pallavolo delle tue squadre degli ultimi 14 giorni senza registrazione di chi ha pagato gli arbitri. **Registra ora** apre **Spese arbitrali** nella partita; **Più tardi** nasconde quella partita su questo dispositivo. Sparisce una volta registrata (vedi la sezione Finanze della squadra)."
        }
      ]
    },
    "notifications": {
      "title": "Notifiche e notizie",
      "summary": "La campanella, cosa significa ogni notifica, push o e-mail, il feed delle notizie e come disattivare le e-mail.",
      "body": [
        {
          "t": "p",
          "text": "La campanella nella barra superiore del desktop mostra in rosso le notifiche non lette; sul telefono apri **Altro** → **Notifiche** (un punto rosso su **Altro** segnala le non lette). Il pannello elenca le ultime 30 notifiche in tempo reale. Tocca una notifica per segnarla come letta e aprire la pagina collegata. Usa **Segna tutto come letto**, **Elimina lette** o l'icona del cestino su una riga."
        },
        {
          "t": "h",
          "text": "Cosa significano le notifiche"
        },
        {
          "t": "ul",
          "items": [
            "**Attività** — un'attività è stata creata, spostata, annullata o ripristinata, oppure sei stato convocato.",
            "**In programma** — promemoria il giorno prima di un'attività. **Scadenza** — promemoria il giorno prima della scadenza di risposta, se non hai risposto.",
            "**Scadenza mancata** — non hai risposto in tempo e risulti assente, con una multa se le regole della tua squadra lo prevedono (vedi la sezione Multe).",
            "**Risultato** — c'è un risultato per la tua partita.",
            "**Servizio segnapunti** — ti è stato proposto un servizio, o la tua richiesta ha avuto risposta.",
            "**Spesa** — la tua spesa è stata pagata o respinta. **Multa** — una multa per te o per la tua squadra è stata emessa, pagata o annullata.",
            "**Notizie del club** apre Notizie, **Invito a evento** l'evento, **Licenza** il profilo, i moduli Moduli; una **Richiesta di adesione** (allenatori e responsabili di squadra) apre la pagina della squadra."
          ]
        },
        {
          "t": "note",
          "text": "Le notifiche si eliminano da sole: quelle di un'attività il giorno dopo che si è svolta, le altre dopo 30 giorni."
        },
        {
          "t": "h",
          "text": "Push o e-mail"
        },
        {
          "t": "p",
          "text": "Ogni notifica compare nella campanella; la maggior parte arriva anche come push, attivato per dispositivo con **Notifiche push** → **Attiva** nel pannello (vedi la sezione Installa l'app). Solo alcune arrivano anche per e-mail: notizie del club e inviti agli eventi se chi li invia lo ha scelto, le decisioni sulle spese, le richieste di adesione (allenatori e responsabili di squadra) e le nuove iscrizioni (admin)."
        },
        {
          "t": "h",
          "text": "Il feed delle notizie"
        },
        {
          "t": "p",
          "text": "Vai su **Strumenti membri** → **Notizie** (telefono: **Altro** → **Strumenti membri** → **Notizie**). Prima le notizie del club in evidenza, poi le altre notizie e le tue notifiche, dalla più recente; **Carica altri** ne aggiunge 20. Vedi solo i post rivolti a te (tutti, il tuo sport, le tue squadre o i tuoi ruoli); i post scaduti scompaiono."
        },
        {
          "t": "h",
          "text": "Preferenze per le notifiche e-mail"
        },
        {
          "t": "p",
          "text": "Apri **Il mio profilo** e cerca **Notifiche e-mail**. Tutti hanno **Notizie del club** e **Inviti agli eventi**; allenatori e responsabili di squadra anche **Richieste di adesione alla squadra** e **Moduli inviati**; gli admin **Nuove iscrizioni**. Sono tutte attive di default. Disattivandone una silenzi solo quell'e-mail; la campanella la mostra comunque. I moduli non inviano e-mail: **Moduli inviati** silenzia invece il push per le risposte ai moduli pubblici."
        },
        {
          "t": "tip",
          "text": "Per non ricevere più le e-mail del club, disattiva **Notizie del club**; copre anche le e-mail di gruppo dalla posta del club. Reset della password, inviti, e-mail sulle spese e messaggi **Contatta** di un allenatore arrivano sempre."
        }
      ]
    },
    "calendar": {
      "title": "Calendario",
      "summary": "Partite, allenamenti, eventi, turni e compleanni delle tue squadre in un'unica vista, con filtri ed esportazione del calendario.",
      "body": [
        {
          "t": "p",
          "text": "Il calendario raccoglie partite, allenamenti, eventi, chiusure della palestra, assenze, i tuoi turni di segnapunti e i compleanni delle tue squadre. Aprilo da **Attività → Calendario** (desktop) o dalla scheda **Calendario** (telefono). Tocca una voce per i dettagli; per allenamenti ed eventi rispondi lì con **Sì**, **Forse** o **No**, e la tua assenza offre **Modifica**. Il selettore in alto cambia la vista:"
        },
        {
          "t": "ul",
          "items": [
            "**Palestra**: il piano settimanale di occupazione della palestra. Allenatori e responsabili di squadra prenotano qui le fasce libere (vedi la sezione Piano palestra e ore libere).",
            "**Calendario**: la griglia mensile; sul telefono una lista di giorni da espandere. Spostati con le frecce o **Oggi**. **Filtro**, **Abbonati** ed **Esporta iCal** compaiono solo in questa vista (icone sul telefono).",
            "**Partite**: le partite proposte e confermate per squadra, mostrate solo se una delle tue squadre ha un calendario partite."
          ]
        },
        {
          "t": "h",
          "text": "Filtro"
        },
        {
          "t": "p",
          "text": "**Filtro** elenca le **Categorie**: **Partite** (**Partite in casa**, **Partite fuori casa**, **I miei turni**), **Attività** (**Allenamenti**, **Eventi**), **Palestra** (**Halle HW**, **Chiusure**) e **Altro** (**Assenze**, **Compleanni**). Sono tutte attive di default. Il selettore **Squadra** propone solo le tue squadre; admin e membri del comitato in modalità admin possono scegliere qualsiasi squadra e partono con tutte. Le indisponibilità settimanali e le assenze non bloccanti restano nascoste finché non attivi **Mostra indisponibilità e assenze non bloccanti**; più assenze nello stesso giorno si raggruppano in **2 assenti**. **I miei turni** mostra sempre i tuoi turni, qualunque squadra sia selezionata."
        },
        {
          "t": "h",
          "text": "Cosa significano i colori"
        },
        {
          "t": "ul",
          "items": [
            "Blu scuro: partite in casa. Giallo: partite fuori casa. Indaco: i tuoi turni di segnapunti.",
            "Verde: allenamenti. Viola: eventi. Ciano: prenotazioni della palestra. Rosa: compleanni. Nero: assenze.",
            "Rosso: chiusure della palestra; l'intera giornata è colorata.",
            "Barrato: annullato; un allenamento saltato per un giorno di partita mostra **Annullato — giorno di partita** nei dettagli."
          ]
        },
        {
          "t": "h",
          "text": "Compleanni"
        },
        {
          "t": "p",
          "text": "Vedi solo i compleanni dei membri delle squadre selezionate, mai di tutto il club. Un membro compare solo se ha scelto **Mostra data completa** sotto **Visibilità data di nascita** nel profilo; **Solo anno** e **Nascondi** lo escludono. Tocca un compleanno per vedere **Compie** e la nuova età. Un compleanno del 29 febbraio compare il 28 negli anni non bisestili."
        },
        {
          "t": "h",
          "text": "Abbonati o esporta"
        },
        {
          "t": "ol",
          "items": [
            "Premi **Abbonati**, spunta **Allenamenti**, **Partite** e/o **Eventi** e, se vuoi, imposta **Filtra per squadra** (vuoto = tutte le squadre).",
            "Premi **Genera link di abbonamento**; il link viene copiato. **Copia** lo ripete, oppure usa **Oppure apri direttamente nella tua app calendario**.",
            "Incollalo nella tua app calendario (Google Calendar: Altri calendari → Da URL; Apple Calendario: Archivio → Nuovo abbonamento calendario). Si aggiorna da solo e include sempre i tuoi turni.",
            "**Esporta iCal** scarica invece come file ciò che vedi sullo schermo; è disattivato finché la vista è vuota."
          ]
        },
        {
          "t": "note",
          "text": "Il link di abbonamento è personale (contiene un token che aggiunge i tuoi turni): tienilo privato. Un file esportato è un'istantanea e non si aggiorna mai."
        }
      ]
    },
    "games": {
      "title": "Partite e risultati",
      "summary": "Calendario partite, risultati, classifiche e tabellone in diretta, e come dire se giochi.",
      "body": [
        {
          "t": "p",
          "text": "Apri **Attività → Partite e risultati** su desktop o la scheda **Partite** sul telefono. Chiunque può consultare; per rispondere serve l'accesso. Se pratichi entrambi gli sport, passa da uno all'altro con **Pallavolo** / **Pallacanestro** / **Tutti gli sport**; i chip filtrano per squadra."
        },
        {
          "t": "h",
          "text": "Le schede"
        },
        {
          "t": "ul",
          "items": [
            "**Prossime**: le tue prossime partite come schede, divise in **Campionato** e **Coppa**, con **Ritrovo** e barre delle risposte (verde sì, giallo forse, rosso no).",
            "**Risultati**: partite concluse con i set. Risultati e classifiche arrivano dalle federazioni ogni mattina.",
            "**Classifiche**: scegli una **Stagione**, tocca una riga per le partite di quella squadra e, nella pallavolo, la cella **V** o **S** per la suddivisione tra 3:0/3:1 e 3:2. Finché una stagione non è pubblicata vedi **I dati saranno comunicati più avanti da Swiss Volley**.",
            "**Tabellone**: statistiche delle squadre di tutto il club, **Assoluto** o **Per partita**."
          ]
        },
        {
          "t": "h",
          "text": "Dire se giochi"
        },
        {
          "t": "p",
          "text": "Su una scheda tocca **Sì**, **Forse** o **No** e, se vuoi, **Aggiungi una nota...**; nel dettaglio della partita gli stessi pulsanti stanno sotto **Partecipi?**."
        },
        {
          "t": "ul",
          "items": [
            "Il tuo allenatore può impostare una scadenza **Rispondi entro**; se non hai risposto, ricevi un promemoria il giorno prima della scadenza. Dopo, la risposta è bloccata (**Scadenza superata**). Con una regola di multa per iscrizione tardiva, chi non risponde risulta assente e viene multato (vedi la sezione Multe).",
            "Un'assenza ti rifiuta automaticamente (**Assente**, o **Non disponibile** per un'indisponibilità settimanale); toccando una risposta la sovrascrivi.",
            "I giocatori ospiti non rispondono per le partite della squadra che li ospita. Se un allenatore ti convoca, ricevi una notifica, la partita compare in Home e nel calendario e puoi rispondere.",
            "Con **Iscrizione automatica** per le partite nel tuo profilo, le partite nuove e senza risposta partono come **Sì**; alcune squadre confermano in anticipo tutti gli effettivi (**Conferma automaticamente le partite**)."
          ]
        },
        {
          "t": "tip",
          "text": "**Vedi formazione** elenca chi ha risposto; le schede mostrano **Allenatore presente** se un allenatore ha confermato e **ATTENZIONE: Squadra incompleta** sotto il minimo."
        },
        {
          "t": "h",
          "text": "Dettaglio partita, condivisione e punteggi in diretta"
        },
        {
          "t": "p",
          "text": "Tocca una scheda per aprirla: **Info partita**, **Sede** con link alla mappa, **Arbitri**, punteggi dei set una volta giocata, e **Segnapunti** o **Ufficiali** con chi è di turno (vedi la sezione Servizio segnapunti). **Condividi link** copia un link o apre la condivisione del telefono; i destinatari devono accedere e vedono **Questo link non è più disponibile per te** se non possono vedere la partita."
        },
        {
          "t": "p",
          "text": "Durante una partita refertata in palestra, un banner rosso **In diretta** compare in cima alla pagina Partite; **Guarda** la segue punto per punto (su desktop anche sotto **Attività → Tabellone in diretta**), senza accesso."
        },
        {
          "t": "h",
          "text": "Se sei allenatore o responsabile di squadra"
        },
        {
          "t": "p",
          "text": "Hai anche la scheda **Dashboard coach** e puoi modificare le risposte, convocare giocatori, impostare scadenza e ritrovo, annullare una partita, contattare la squadra e registrare le **Spese arbitrali** delle partite in casa di pallavolo — vedi la sezione Gestire allenamenti, partite ed eventi."
        }
      ]
    },
    "trainings": {
      "title": "Allenamenti",
      "summary": "Gli allenamenti della tua squadra: rispondere Sì, Forse o No, le scadenze e cosa cambia l'app da sola.",
      "body": [
        {
          "t": "p",
          "text": "Apri **Attività → Allenamenti** sul desktop o la scheda **Allenamenti** sul telefono. Ogni scheda mostra data, ora, palestra, allenatore e note, più i badge **Prova** (aperto ai nuovi arrivati), **Accorciato** (dopo si gioca una partita in casa nella stessa palestra) e **Annullato**. Il filtro squadra cambia squadra; **Mostra allenamenti precedenti** mostra le date passate."
        },
        {
          "t": "h",
          "text": "Rispondere"
        },
        {
          "t": "ul",
          "items": [
            "Tocca **Sì**, **Forse** o **No**. Dopo aver risposto compare un campo nota; Invio o il segno di spunta la salva.",
            "**Rispondi entro** indica la scadenza. Dopo vedi **Scadenza superata** in rosso e la tua risposta è bloccata.",
            "Alcuni allenamenti richiedono un motivo per **Forse** o **No**: se apri l'allenamento dalla Home o da un link condiviso, la risposta non viene salvata senza motivo (**Indica un motivo**).",
            "I livelli ospite esclusi vedono **Il tuo livello di ospite è escluso da questo allenamento** al posto dei pulsanti.",
            "L'icona con le persone apre **Partecipazione**: chi ha risposto cosa."
          ]
        },
        {
          "t": "h",
          "text": "Cosa succede in automatico"
        },
        {
          "t": "ul",
          "items": [
            "**Iscrizione automatica**: in **Il mio profilo** attiva **Iscrizione automatica** per **Allenamenti**. Gli allenamenti nuovi e senza risposta partono allora come **Sì**; le risposte già date non vengono mai modificate.",
            "Un'assenza ti rifiuta automaticamente; la scheda mostra **Assente** (o **Non disponibile** per un'indisponibilità settimanale). Toccando una risposta la sovrascrivi (vedi la sezione Assenze).",
            "Ricevi un promemoria il giorno prima della scadenza se non hai risposto, e di nuovo il giorno prima dell'allenamento.",
            "Con una regola di multa per iscrizione tardiva, superare la scadenza ti segna assente e può costarti una multa (vedi la sezione Multe).",
            "Con **Rifiuta automaticamente i \"Forse\"** attivo per la tua squadra, **Forse** diventa **No** dopo la scadenza."
          ]
        },
        {
          "t": "h",
          "text": "Annullamenti e partite"
        },
        {
          "t": "ul",
          "items": [
            "Un allenamento annullato resta in elenco, attenuato, con il motivo in rosso; la squadra viene avvisata.",
            "Con **Cancellazione automatica** impostata, un allenamento viene annullato quando alla scadenza ci sono meno giocatori confermati del minimo.",
            "Nel giorno in cui la tua squadra ha una partita, in casa o in trasferta, il suo allenamento viene annullato automaticamente (**Annullato — giorno di partita** nel calendario).",
            "Se dopo un'altra squadra gioca in casa nella tua palestra (da 45 minuti prima dell'inizio), il tuo allenamento termina prima (**Termina prima — dopo si gioca una partita in casa in palestra**) o viene annullato se la partita lo copre tutto.",
            "Se giochi in due squadre e una ha una partita, per l'allenamento dell'altra quel giorno vieni impostato su **No** (nota `Game <team>`); una tua risposta non viene mai sovrascritta.",
            "Se la partita viene spostata o annullata, l'allenamento e i rifiuti automatici vengono ripristinati."
          ]
        },
        {
          "t": "note",
          "text": "Gli annullamenti per giorno di partita con più di 14 giorni di anticipo avvengono senza avviso; controlla il calendario prima di una settimana di partita."
        },
        {
          "t": "h",
          "text": "Se sei allenatore o responsabile di squadra"
        },
        {
          "t": "p",
          "text": "Creare, modificare e annullare allenamenti e la tabella presenze della **Dashboard allenatore** sono descritti nella sezione Gestire allenamenti, partite ed eventi."
        }
      ]
    },
    "events": {
      "title": "Eventi",
      "summary": "Eventi del club e della squadra: chi è invitato, risposte per giorno, scadenze, giocatori ospiti e persone senza account.",
      "body": [
        {
          "t": "p",
          "text": "Gli eventi sono tutto ciò che non è una partita o un allenamento: tornei, serate sociali, riunioni, weekend di allenamento. Apri **Attività → Eventi** sul desktop o **Altro → Eventi** sul telefono. **Passati** mostra gli eventi già svolti; con più squadre compare un selettore della squadra."
        },
        {
          "t": "h",
          "text": "Chi vede un evento"
        },
        {
          "t": "ul",
          "items": [
            "Gli eventi di tutto il club non hanno squadre, ruoli o persone associate e li vedono tutti i membri.",
            "Gli eventi di squadra mostrano le squadre invitate come chip; li vedono i loro giocatori e lo staff.",
            "Il badge **Evento mirato** indica che sono stati invitati ruoli specifici o persone precise.",
            "I tuoi servizi segnapunti compaiono come schede ambra **Di turno** (vedi la sezione Servizio segnapunti)."
          ]
        },
        {
          "t": "h",
          "text": "Rispondere"
        },
        {
          "t": "p",
          "text": "Tocca **Sì**, **Forse** o **No** sulla scheda o nel dettaglio dell'evento. La striscia colorata a sinistra è la tua risposta, le barre contano le risposte e **Vedi lista** mostra chi ha risposto. **Forse** può essere disattivato per un evento. Dopo aver risposto puoi lasciare un commento sotto **Aggiungi una nota...**; per alcuni eventi serve un motivo se rifiuti o rispondi **Forse**."
        },
        {
          "t": "ul",
          "items": [
            "**Rispondi entro** mostra la scadenza; dopo, la risposta è bloccata e compare in rosso **Scadenza superata**.",
            "Un'assenza che copre l'evento ti fa rifiutare automaticamente e mostra **Assente**; tocca una risposta per sovrascriverla.",
            "**Iscrizione automatica** → **Eventi** in **Il mio profilo** fa sì che i nuovi eventi partano per te come confermati.",
            "Per gli eventi di squadra ricevi una notifica di promemoria il giorno prima dell'evento.",
            "Alcuni eventi chiedono tre **Preferenze di ruolo** nel dettaglio dell'evento quando confermi; tutte e tre sono obbligatorie."
          ]
        },
        {
          "t": "h",
          "text": "Eventi su più giorni"
        },
        {
          "t": "p",
          "text": "Per un evento su più giorni, **Sì**, **Forse** o **No** sulla scheda risponde per tutti i giorni insieme. **Per giorno** sulla scheda, o **Partecipazione per fascia oraria** nel dettaglio, permette di confermare o rifiutare ogni giorno singolarmente. Le risposte miste compaiono come conteggio, ad esempio 2/3 confermati."
        },
        {
          "t": "h",
          "text": "Giocatori ospiti e persone senza account"
        },
        {
          "t": "ul",
          "items": [
            "Se è stato invitato solo il roster principale, i giocatori ospiti (G1–G3) vedono l'evento ma non possono rispondere; la scheda dice **I giocatori/trici ospiti non sono invitati a questo evento**. Un invito personale ha la precedenza.",
            "Se l'evento ha un modulo per persone esterne, il dettaglio dell'evento mostra **Link di iscrizione per gli ospiti** (**Copia** / **Apri**). Queste iscrizioni non sono nella lista; gli admin le vedono in **Tutte le iscrizioni**.",
            "Se apri un link di iscrizione pubblico da connesso, premi **Apri l'evento** e rispondi nell'app, così conti nella lista."
          ]
        },
        {
          "t": "h",
          "text": "Se sei allenatore o responsabile di squadra"
        },
        {
          "t": "p",
          "text": "Creare, modificare e annullare eventi e il link di iscrizione pubblico: vedi la sezione Gestire allenamenti, partite ed eventi. Nella lista puoi cambiare le risposte dei tuoi giocatori; nel dettaglio dell'evento il contatore **Ospiti** accanto alla tua risposta aggiunge le persone in più che porti con te."
        }
      ]
    },
    "absences": {
      "title": "Assenze",
      "summary": "Segnala al club quando sei via, così attività e pianificazione delle partite ne tengono conto.",
      "body": [
        {
          "t": "p",
          "text": "Apri **Strumenti membri → Assenze** (desktop) oppure **Altro → Strumenti membri → Assenze** (telefono). La pagina ha due viste, **Assenze** e **Settimanali**, più un selettore **Le mie** / **Squadra** se fai parte di una squadra. **Squadra** mostra le assenze dei compagni; per gli strumenti dell'allenatore lì, vedi la sezione Assenze e blocchi della squadra."
        },
        {
          "t": "h",
          "text": "Aggiungere un'assenza"
        },
        {
          "t": "ol",
          "items": [
            "Tocca **Nuova assenza**.",
            "Imposta **Da** e **A**, oppure spunta **Indefinito** se non c'è ancora una data di fine.",
            "Scegli un **Motivo** (**Infortunio**, **Vacanza**, **Lavoro**, **Personale** o **Altro**) e aggiungi eventuali **Dettagli (facoltativo)**.",
            "Sotto **Riguarda**, lascia **Tutto** oppure scegli solo **Allenamenti**, **Partite** o **Eventi**.",
            "Lascia attivo **Blocca la pianificazione delle partite**, a meno che tu non giocheresti comunque (vedi sotto), poi tocca **Salva**."
          ]
        },
        {
          "t": "p",
          "text": "Usa **Modifica** ed **Elimina** su una riga. Le assenze passate stanno sotto **Mostra assenze passate**. Per inserirne molte, tocca **Importare**: **Scarica modello**, compila date (dd.mm.yyyy), motivo e cosa riguarda ogni assenza, carica il file, controlla l'**Anteprima** e conferma con **Importa**. Le assenze importate bloccano la pianificazione delle partite."
        },
        {
          "t": "h",
          "text": "Indisponibilità settimanale"
        },
        {
          "t": "p",
          "text": "Per un impegno ricorrente, passa a **Settimanali** e tocca **Nuova settimanale**. Scegli i **Giorni della settimana**, cosa **Riguarda**, una data **Da**, facoltativamente una data **A** (di default è **Indefinito**) e una **Nota (facoltativo)**. Le indisponibilità settimanali non influiscono mai sulla pianificazione delle partite."
        },
        {
          "t": "h",
          "text": "Cosa succede automaticamente"
        },
        {
          "t": "ul",
          "items": [
            "La tua risposta a ogni attività futura coperta dall'assenza diventa rifiutato, con il tuo motivo come nota, e l'attività mostra **Assente** (o **Non disponibile** per una settimanale). Le attività passate non vengono toccate.",
            "Puoi comunque cambiare la tua risposta a un'attività coperta. Una risposta manuale resta valida anche se l'assenza viene modificata o eliminata in seguito.",
            "Se elimini un'assenza, i rifiuti che aveva creato scompaiono e le risposte che aveva sovrascritto tornano a confermato.",
            "Le attività coperte da un'assenza contano come giustificate nelle tue statistiche di presenza.",
            "I tuoi compagni di squadra, l'allenatore e il/la responsabile della squadra possono vedere le tue assenze, compresi motivo e dettagli. Nel calendario compaiono sotto il filtro **Assenze** (vedi la sezione Calendario)."
          ]
        },
        {
          "t": "h",
          "text": "Assenze e pianificazione delle partite"
        },
        {
          "t": "p",
          "text": "Con **Blocca la pianificazione delle partite** attivo, lo Spielplaner vede le tue date come non disponibili quando piazza le partite della tua squadra: le date con assenti vengono evitate, e una data con tre o più assenti non viene mai usata. Contano solo le assenze singole che riguardano **Partite** o **Tutto**; le indisponibilità settimanali e le assenze dei giocatori ospiti no. Disattivalo per un infortunio lungo o un congedo di maternità, altrimenti la tua squadra non potrà essere pianificata per mesi."
        },
        {
          "t": "note",
          "text": "Se un allenatore, un/una responsabile della squadra o un admin aggiunge o modifica un'assenza per te, ricevi una notifica e la riga mostra chi l'ha modificata e quando. Qualsiasi nota che ha lasciato è visibile a te."
        }
      ]
    },
    "scorer": {
      "title": "Servizio segnapunti",
      "summary": "I tuoi servizi come segnapunti, tabellone e arbitro alle partite in casa: iscrizione, delega, promemoria ed emergenze.",
      "body": [
        {
          "t": "p",
          "text": "Ogni partita in casa ha bisogno di ufficiali: un **Segnapunti**, un **Tabellone** (o un unico **Segnapunti/Tabellone**) e a volte un **Arbitro**; nella pallacanestro **Segnapunti (OTR1)**, **Cronometrista (OTR1)** e **Ufficiale 24\" (OTR2)**. Apri **Strumenti membri → Servizio segnapunti** (desktop) o **Altro → Strumenti membri → Servizio segnapunti** (telefono)."
        },
        {
          "t": "h",
          "text": "Cosa vedi"
        },
        {
          "t": "ul",
          "items": [
            "**Partite** elenca le prossime partite in casa in cui la tua squadra ha un servizio o sei assegnato.",
            "Una partita è **Confermato** quando ogni servizio ha una persona, altrimenti **Aperto**; nello stesso giorno le partite aperte vengono prima.",
            "**Tutte** mostra le partite delle tue squadre, **I miei servizi** solo quelle a cui sei assegnato. **Filtri** restringe per **Data**, **Squadra che gioca**, **Squadra di turno**, **Tipo di servizio** o **Servizio non assegnato**; **Mostra partite precedenti** aggiunge le partite passate della stagione.",
            "**Panoramica** conta i servizi e i posti aperti **Per squadra di turno** o **Per partita**."
          ]
        },
        {
          "t": "h",
          "text": "Assumere un servizio"
        },
        {
          "t": "ol",
          "items": [
            "Tocca **Mi iscrivo** su un servizio aperto della tua squadra. Compare solo con la licenza richiesta: licenza segnapunti per il **Segnapunti** nella pallavolo, OTR1 per i servizi di pallacanestro (OTR2 o OTN per **Ufficiale 24\" (OTR2)**); **Segnapunti/Tabellone**, **Tabellone** e **Arbitro** non ne richiedono.",
            "Controlla ruolo, partita, data e regola di arrivo in **Conferma assegnazione**, poi tocca **Conferma**. Un'assenza in quella data mostra un avviso ma non ti blocca."
          ]
        },
        {
          "t": "note",
          "text": "Un servizio assunto è definitivo: non puoi lasciarlo, solo delegarlo. Sii in palestra 30 minuti prima come segnapunti, segnapunti/tabellone o arbitro, 15 minuti come tabellone o per ogni servizio di pallacanestro. Ritardo o assenza costano una multa di CHF 50.00."
        },
        {
          "t": "h",
          "text": "Delegare un servizio"
        },
        {
          "t": "p",
          "text": "Tocca **Delega** accanto al tuo nome, scegli un membro da **La tua squadra** o **Altri membri** e conferma con **Delega**. Non cambia nulla finché la persona non tocca **Accetta** nel banner **Richiesta di servizio** della sua pagina Servizio segnapunti; tu vedi la richiesta in attesa e ricevi una notifica con la risposta. Chi riceve la delega deve avere la licenza del servizio. Le richieste per partite già giocate scadono da sole."
        },
        {
          "t": "h",
          "text": "Promemoria ed emergenze"
        },
        {
          "t": "ul",
          "items": [
            "Da una settimana prima della partita, la home mostra un banner giallo con il tuo servizio.",
            "Da 60 minuti prima dell'inizio, **Emergenza: contatta i responsabili** mostra l'allenatore e il responsabile della squadra che gioca e avvisa il club.",
            "**Aggiungi al calendario** sulla scheda di una partita scarica il servizio; un link personale **Abbonati** dalla pagina Calendario include sempre i tuoi servizi (vedi la sezione Calendario).",
            "Come segnapunti assegnato apri **Formazione** da 40 minuti prima della partita per la lista della squadra di casa."
          ]
        },
        {
          "t": "h",
          "text": "Se sei admin"
        },
        {
          "t": "p",
          "text": "Come admin dello sport in modalità admin vedi tutte le partite in casa e imposti **Seleziona squadra** e **Seleziona persona** su ogni servizio fino all'inizio della partita. La pianificazione della stagione avviene in **Admin → Operazioni di gara → Assegnazione refertisti** (vedi la sezione Assegnare i servizi segnapunti)."
        }
      ]
    },
    "teams": {
      "title": "Squadre",
      "summary": "Le schede delle tue squadre, il roster e i profili dei giocatori, e come entrare in una squadra o lasciarla.",
      "body": [
        {
          "t": "p",
          "text": "Apri **Strumenti membri → Squadra** su desktop (**Squadre** se fai parte di più roster) oppure **Altro → Strumenti membri → Squadre** sul telefono. La pagina **Squadre e membri** mostra la stagione in corso (**Stagione 2026/27**); le stagioni cambiano il 1° giugno."
        },
        {
          "t": "h",
          "text": "Schede delle squadre"
        },
        {
          "t": "ul",
          "items": [
            "Una scheda per ogni squadra in cui giochi, alleni o sei responsabile, raggruppate per sport.",
            "Ogni scheda mostra lega, stagione, numero di giocatori e ospiti sopra la foto della squadra.",
            "Tocca una scheda per aprirla."
          ]
        },
        {
          "t": "h",
          "text": "La pagina della squadra"
        },
        {
          "t": "ul",
          "items": [
            "**Staff** elenca gli allenatori e i responsabili della squadra.",
            "**Roster attuale** è una tabella con **#**, **Posizione** e **Ruolo** (Coach, Capitano, Resp. squadra); tocca un'intestazione per ordinare.",
            "**Ospiti** elenca i giocatori con livello ospite G1–G3: G1 ha la priorità più alta quando gli allenamenti sono pieni, G3 la più bassa.",
            "Sotto il roster: il calendario della squadra (partite, allenamenti, eventi, chiusure della palestra), le date delle partite ancora in trattativa, i sondaggi se attivati e gli **Sponsor**."
          ]
        },
        {
          "t": "h",
          "text": "Profilo del giocatore"
        },
        {
          "t": "p",
          "text": "Tocca un nome in un roster per aprire il profilo del giocatore: foto, ruoli, posizioni, squadre, **Statistiche** della stagione (**Allenamenti**, **Partite**, **Tasso di presenza**) e **Assenze attuali**. La presenza conta le risposte confermate dal 1° giugno a oggi, escluse le attività coperte da un'assenza. Email, telefono ed età sono visibili solo agli allenatori e responsabili delle squadre del giocatore (o a un admin dello sport in modalità admin), e solo se non nascosti nel profilo (vedi la sezione Il tuo profilo)."
        },
        {
          "t": "h",
          "text": "Entrare in una squadra e lasciarla"
        },
        {
          "t": "ol",
          "items": [
            "Nella pagina Squadre tocca **Gestisci le squadre** (un pulsante più sul telefono) oppure **Aggiungi squadra** nel tuo profilo; senza squadre il pulsante si chiama **Unisciti a una nuova squadra**.",
            "Sotto **Unisciti a una squadra**, scegli lo sport se richiesto, seleziona una squadra e tocca **Invia richiesta**. Le squadre di cui fai già parte, già richieste o dell'altro genere non vengono proposte.",
            "Ogni allenatore e responsabile di quella squadra riceve una notifica (app ed email) e può approvare o rifiutare. Fino ad allora il tuo profilo mostra **In attesa di approvazione**; la X accanto ritira la richiesta.",
            "Per lasciare la squadra, tocca **Lascia la squadra** nella stessa finestra (o la X sul chip nel tuo profilo) e conferma."
          ]
        },
        {
          "t": "note",
          "text": "Lasciare la squadra ti rimuove subito dal roster; per rientrare serve di nuovo l'approvazione di un allenatore."
        },
        {
          "t": "h",
          "text": "Se sei allenatore o responsabile della squadra"
        },
        {
          "t": "p",
          "text": "Su uno schermo largo la pagina della tua squadra mostra anche le colonne **Email**, **Telefono** e **Data di nascita** (la privacy resta valida). Un riquadro ambra **2 richiesta/e in attesa** offre **Approva** e **Rifiuta**; per una richiesta di adesione scegli prima **Si unisce come:** **Giocatore/trice** oppure **Ospite** L1–L3. **Modifica squadra** apre l'editor del roster. Rifiutare la richiesta di un account nuovo disattiva l'iscrizione e l'accesso all'app di quella persona. Il resto è nella sezione Editor del roster."
        }
      ]
    },
    "profile": {
      "title": "Il tuo profilo",
      "summary": "I tuoi dati di contatto, la foto, le impostazioni di privacy, l'iscrizione automatica, le e-mail, l'IBAN, i documenti e lo stato della licenza.",
      "body": [
        {
          "t": "p",
          "text": "Apri **Il mio profilo** dal tuo avatar (desktop) o da **Altro** → il tuo nome (telefono). Mostra squadre, contatti, licenze, assenze e multe; **Modifica profilo** apre il modulo."
        },
        {
          "t": "h",
          "text": "Modificare i tuoi dati"
        },
        {
          "t": "ul",
          "items": [
            "**Cambia foto** (JPEG, PNG, WebP o GIF, max 5 MB; le foto vengono ridotte da sole). **Visibilità sul sito web** accanto mostra la foto nella rosa su kscw.ch.",
            "**Soprannome** sostituisce il nome in tutta l'app.",
            "**Numero** (0–99) deve essere libero nelle squadre attive.",
            "**Dati personali (ClubDesk)** contiene indirizzo, nazionalità, **Formazione da allenatore**, **Numero AVS** e **IBAN**. Inserisci l'IBAN per i rimborsi; così sparisce anche il promemoria in Home.",
            "I campi **Gestito dall'amministrazione** e il numero di licenza li modifica solo il club.",
            "**Cambia password** conserva la chiave dei documenti d'identità; **Invia link di reset** la perde (vedi la sezione Documenti d'identità)."
          ]
        },
        {
          "t": "note",
          "text": "Nome, lingua, telefono, data di nascita, indirizzo, NPA, località e nazionalità sono obbligatori; **Benvenuto al KSC Wiedikon** blocca l'app finché non sono compilati. Le modifiche a nome, e-mail, telefono, data di nascita, indirizzo o nazionalità vanno al registro del club (**Aggiornamento dati inviato all'amministrazione**)."
        },
        {
          "t": "h",
          "text": "Privacy"
        },
        {
          "t": "ul",
          "items": [
            "**Nascondi numero di telefono** / **Nascondi indirizzo e-mail**: gli altri membri non li vedono mai; nascosti anche ad allenatori e responsabili di squadra (gli admin del club li vedono comunque).",
            "**Visibilità data di nascita**: **Mostra data completa**, **Solo anno** o **Nascondi**; solo **Mostra data completa** mette il tuo compleanno nel calendario.",
            "**Mostra solo il nome sul sito**: su kscw.ch il cognome diventa un'iniziale (Anna M.) e l'anno di nascita è nascosto."
          ]
        },
        {
          "t": "h",
          "text": "Iscrizione automatica e notifiche e-mail"
        },
        {
          "t": "p",
          "text": "Gli interruttori **Iscrizione automatica** (**Allenamenti**, **Partite**, **Eventi**) ti confermano da soli a ogni attività nuova e futura di quel tipo. Risposte già date e giorni di assenza non vengono mai toccati; puoi sempre declinare singolarmente. Sotto **Notifiche e-mail**, **Notizie del club** e **Inviti agli eventi** sono attivi per tutti; disattivarne uno ferma solo l'e-mail, la campanella lo mostra comunque. Allenatori, responsabili di squadra e admin hanno righe in più per i loro incarichi."
        },
        {
          "t": "h",
          "text": "Documenti e stato della licenza"
        },
        {
          "t": "p",
          "text": "**I miei documenti** elenca i file caricati durante l'iscrizione (solo se ce ne sono); tocca un file per l'anteprima. **Stato della licenza** passa da **Nessuna licenza** → **Da ordinare** → **Ordinata** → **Finalizzata** → **Licenziata**. I primi quattro li imposta il club; **Licenziata** viene confermato dalla federazione. Ricevi una notifica quando il club lo cambia o diventa **Licenziata**; il 1° giugno torna in silenzio a **Nessuna licenza**."
        },
        {
          "t": "h",
          "text": "Il controllo annuale del profilo"
        },
        {
          "t": "p",
          "text": "Prima di ordinare le licenze della prossima stagione, il club può chiederti di controllare i dati. **Controlla i tuoi dati** si apre allora con il profilo completo e non si può chiudere. Controlla i campi indicati nel banner, correggi gli errori e premi **È tutto corretto**. Chi ha meno di 16 anni dovrebbe farlo con un genitore. Non ricompare fino al controllo successivo."
        }
      ]
    },
    "household": {
      "title": "Nuclei familiari e account famiglia",
      "summary": "Un solo login per più figli: cambiare membro, agire per un figlio e cosa resta bloccato.",
      "body": [
        {
          "t": "p",
          "text": "Un nucleo familiare permette a un login adulto di agire per più membri — in genere un genitore che risponde alle convocazioni, registra assenze e compila moduli per i figli. Ogni figlio mantiene scheda membro, posto nel roster, quote e licenza; solo il login è condiviso. I nuclei familiari li impostano gli admin del club e possono contenere solo membri ordinari — non allenatori, responsabili di squadra, Spielplaner o admin."
        },
        {
          "t": "h",
          "text": "Cambiare membro"
        },
        {
          "t": "ol",
          "items": [
            "Tocca la barra colorata in alto nell’app: mostra il nome della persona per cui stai agendo. La barra compare solo per i login che gestiscono almeno un altro membro.",
            "In **Per chi lo stai facendo?** scegli **Io** o uno dei tuoi figli. Ogni figlio è elencato con il nome, le sue squadre e la sua foto o un’iniziale colorata.",
            "Da quel momento tutta l’app funziona come quel figlio: attività, profilo, assenze e moduli, e tutto ciò che salvi vale per lui. Tocca di nuovo la barra e scegli **Io** per tornare a te."
          ]
        },
        {
          "t": "p",
          "text": "Mentre agisci per un figlio, la barra prende il colore di quel figlio e i pulsanti di risposta su allenamenti, partite ed eventi portano il suo nome — per una figlia di nome Mila dicono **Mila viene**, **Mila non può** e **Forse, Mila** — così vedi sempre per chi stai rispondendo."
        },
        {
          "t": "note",
          "text": "Agire per un figlio è reale, non un’anteprima: ciò che inserisci vale per il figlio e viene registrato a suo nome, e il registro di audit del club annota che l’hai fatto tu. Tutte le schede aperte seguono il cambio, e ogni volta che apri l’app parti come te stesso — l’ultimo figlio usato non viene mai ripristinato automaticamente."
        },
        {
          "t": "h",
          "text": "Cosa è bloccato mentre agisci per un figlio"
        },
        {
          "t": "p",
          "text": "Queste azioni appartengono a un login reale o alla sola persona interessata e vengono rifiutate mentre usi l’account di un figlio:"
        },
        {
          "t": "ul",
          "items": [
            "Cambiare o impostare una password ed eliminare l’account",
            "Votare nei sondaggi (vedi la sezione Sondaggi)",
            "Delegare un servizio segnapunti (vedi la sezione Servizio segnapunti)",
            "Creare o rinnovare un link di abbonamento al calendario — **Abbonati** nella pagina del calendario",
            "Aprire i documenti d’identità: un membro gestito non ha mai effettuato l’accesso, quindi per lui non esiste alcuna chiave"
          ]
        },
        {
          "t": "tip",
          "text": "Se l’app perde traccia di chi stai rappresentando, mostra **Qualcosa non è più sincronizzato — ricarico per sicurezza** e si ricarica da sola."
        },
        {
          "t": "h",
          "text": "Come un figlio ottiene il proprio login"
        },
        {
          "t": "p",
          "text": "Un figlio gestito non ha password e non può accedere, ma riceve comunque le email del club. Un membro che ha già un login non può diventare membro gestito. Quando un figlio è pronto per un account proprio, chiedi a un admin: serve un indirizzo email tutto suo, perché ogni account ne richiede uno proprio. Arrivato l’invito, il figlio sceglie una password (vedi la sezione Il tuo account)."
        }
      ]
    },
    "forms": {
      "title": "Compilare i moduli",
      "summary": "Dove compaiono i moduli, come rispondere entro la scadenza e quando puoi modificare una risposta.",
      "body": [
        {
          "t": "p",
          "text": "Allenatori, responsabili di squadra e comitato usano i moduli per raccogliere risposte dai membri, ad esempio per un ordine di abbigliamento o un sondaggio. Quando un modulo viene aperto per te, compare sulla tua home page e ricevi una notifica. Come crearne uno è descritto nella sezione Creare moduli."
        },
        {
          "t": "h",
          "text": "Dove compaiono i moduli"
        },
        {
          "t": "ul",
          "items": [
            "Sulla home page, nella scheda blu **Moduli da compilare**, visibile solo finché un modulo è aperto per te.",
            "Nella pagina **Moduli** sotto **Aperti per te**. I giocatori non hanno una voce di menu dedicata; ti ci porta la voce nella campanella **Nuovo modulo:** con il titolo del modulo, oppure la notifica push intitolata **Nuovo modulo**.",
            "Allenatori, responsabili di squadra, comitato e admin la trovano sotto **Strumenti membri → Moduli** (desktop) o **Altro → Strumenti membri → Moduli** (telefono)."
          ]
        },
        {
          "t": "p",
          "text": "Un modulo è aperto per te quando riguarda tutto il club o una squadra in cui giochi. Se alleni soltanto una squadra, ricevi le sue notifiche ma il modulo non compare nel tuo elenco. Ogni voce mostra il titolo e, se c'è una scadenza, **Chiusura** seguito da data e ora (30.09.2026 23:59). Vieni avvisato una volta per modulo quando viene aperto, nella campanella e, se le notifiche push sono attive, sul telefono. Non viene inviata nessuna email."
        },
        {
          "t": "h",
          "text": "Rispondere a un modulo"
        },
        {
          "t": "ol",
          "items": [
            "Tocca **Compila**. Le domande contrassegnate con * sono obbligatorie.",
            "Rispondi alle domande. Per una domanda con file tocca **Scegli un file**; la croce rossa accanto al nome del file lo rimuove, così puoi sceglierne un altro.",
            "Premi **Invia**. Vedrai il testo di ringraziamento dell'autore oppure **Grazie — la tua risposta è stata registrata.**, poi premi **Fatto**."
          ]
        },
        {
          "t": "note",
          "text": "La scadenza è vincolante. Dopo l'ora indicata accanto a **Chiusura**, o quando l'autore chiude il modulo, l'invio fallisce con **Questo modulo è chiuso.** Una domanda obbligatoria lasciata vuota mostra **Rispondi a:** seguito dal suo nome."
        },
        {
          "t": "h",
          "text": "Modificare una risposta"
        },
        {
          "t": "p",
          "text": "In un modulo normale rispondi una sola volta. In seguito il pulsante mostra **Modifica** invece di **Compila**: cambia ciò che ti serve e premi **Salva**. Vedrai **La tua risposta è stata aggiornata.** oppure il testo di ringraziamento. Funziona finché il modulo non viene chiuso."
        },
        {
          "t": "ul",
          "items": [
            "I moduli anonimi mostrano **Questo modulo è anonimo — le tue risposte non sono collegate al tuo nome.** Nessuno può sapere quale risposta è la tua, quindi non può essere modificata, e il modulo continua a mostrare **Compila** anche dopo che hai risposto. Non compilarlo due volte.",
            "Se l'autore consente più risposte per persona, il modulo resta in elenco con **Compila** e la schermata di ringraziamento offre **Invia un'altra risposta**. Le risposte precedenti non possono essere modificate."
          ]
        },
        {
          "t": "h",
          "text": "Promemoria"
        },
        {
          "t": "p",
          "text": "Se non hai ancora risposto, l'autore può inviarti un promemoria: **Promemoria — si prega di compilare:** più il titolo del modulo nella campanella, e una notifica push intitolata **Promemoria**. Entrambi aprono la pagina **Moduli**. Una volta che hai risposto, non ricevi più promemoria."
        }
      ]
    },
    "polls": {
      "title": "Sondaggi",
      "summary": "Vota nei sondaggi di squadra e — come allenatore o responsabile di squadra — creali, chiudili e leggi i risultati.",
      "body": [
        {
          "t": "p",
          "text": "I sondaggi sono brevi consultazioni di squadra: una domanda, poche opzioni. Li trovi nella pagina della tua squadra sotto **Sondaggi** — **Strumenti membri → Squadre** su desktop (**Squadra** se fai parte di una sola), **Altro → Strumenti membri → Squadre** sul telefono, poi scegli la tua squadra. I sondaggi aperti delle tue squadre compaiono anche nella pagina iniziale come **Sondaggi attivi**. La sezione è visibile solo per le squadre con i sondaggi attivati."
        },
        {
          "t": "h",
          "text": "Votare"
        },
        {
          "t": "ol",
          "items": [
            "Tocca un'opzione. Un sondaggio a **Scelta singola** accetta una sola scelta, un sondaggio a **Scelta multipla** più di una.",
            "Premi **Vota**. La tua risposta viene contrassegnata come **Votato**.",
            "Per correggerla, premi **Modifica voto**, cambia le tue scelte e premi di nuovo **Modifica voto** — oppure **Annulla** per mantenere la risposta precedente."
          ]
        },
        {
          "t": "note",
          "text": "Un sondaggio può avere una **Scadenza** (dd.mm.yyyy). Puoi votare per tutto quel giorno. Dal giorno successivo mostra **Votazione chiusa**, sparisce dalla scheda nella pagina iniziale e non accetta più voti, anche se il suo badge resta **Aperto** nella pagina della squadra finché un responsabile non lo chiude."
        },
        {
          "t": "h",
          "text": "Cosa vedi"
        },
        {
          "t": "ul",
          "items": [
            "Con **Risultati visibili a tutti**, le barre dei risultati compaiono dopo che hai votato, oppure quando il sondaggio è chiuso o ha superato la scadenza.",
            "Senza questa opzione vedi, dopo aver votato, solo la tua risposta contrassegnata e l'avviso **I risultati sono visibili solo ai responsabili della squadra**.",
            "Con **Voto anonimo**, nessuno — nemmeno il tuo allenatore — può vedere chi ha scelto cosa; esistono solo i totali.",
            "I sondaggi chiusi si trovano nell'elenco richiudibile **Sondaggi chiusi** in fondo alla sezione."
          ]
        },
        {
          "t": "h",
          "text": "Se sei allenatore o responsabile di squadra"
        },
        {
          "t": "p",
          "text": "Tu (o un admin in modalità admin) gestisci i sondaggi della tua squadra. Nella pagina della squadra premi **Crea sondaggio** e compila:"
        },
        {
          "t": "ul",
          "items": [
            "**Domanda** e almeno due **Opzioni** (**Aggiungi opzione**, **Rimuovi**). Il pulsante **Crea sondaggio** resta disattivato finché non ci sono entrambe.",
            "**Modalità di voto**: **Scelta singola** o **Scelta multipla**.",
            "**Scadenza**, oppure lasciala vuota per **Nessuna scadenza**.",
            "**Voto anonimo** (disattivato per impostazione predefinita) nasconde chi ha votato — anche a te.",
            "**Risultati visibili a tutti** (attivato per impostazione predefinita); disattivalo per riservare i totali ai responsabili."
          ]
        },
        {
          "t": "p",
          "text": "Vedi sempre il conteggio in tempo reale, anche prima di aver votato. Nei sondaggi non anonimi ogni opzione elenca i suoi votanti sotto **Votato da**. L'icona del lucchetto (**Chiudi sondaggio**) ferma la votazione e sposta il sondaggio in **Sondaggi chiusi**; l'icona del cestino (**Elimina sondaggio**) lo rimuove con tutti i voti. Entrambe funzionano nella pagina della squadra e nella scheda della pagina iniziale."
        },
        {
          "t": "note",
          "text": "Chiudere ed eliminare sono azioni definitive: non è possibile riaprire e i voti eliminati vanno persi. L'app ti chiede di confermare entrambe; se in seguito ti servono altre risposte, crea un nuovo sondaggio."
        },
        {
          "t": "tip",
          "text": "I sondaggi si attivano per squadra nell'editor del roster sotto **Impostazioni squadra → Funzionalità → Sondaggi (votazioni e decisioni di squadra)** — vedi la sezione Editor del roster."
        }
      ]
    },
    "feedback": {
      "title": "Feedback, stato e novità",
      "summary": "Segnalare bug e idee, controllare lo stato dell'app, leggere le note di rilascio e le pagine legali e del caffè.",
      "body": [
        {
          "t": "p",
          "text": "Tutto questo si trova sotto **Options**: l'icona dell'ingranaggio in alto a destra su desktop, oppure **Altro → Options** sul telefono. Sul telefono il link del caffè si trova nel pannello **Altro** accanto al tuo profilo, e le pagine legali sono in fondo allo stesso pannello."
        },
        {
          "t": "h",
          "text": "Feedback e segnalazioni di bug"
        },
        {
          "t": "p",
          "text": "**Options → Feedback** apre **Feedback & Bug**. Tocca **Nuovo feedback**, scegli **Bug**, **Funzionalità** o **Feedback**, aggiungi un breve **Titolo** e una **Descrizione** di cosa è successo e cosa ti aspettavi, e allega fino a cinque screenshot sotto **Screenshot** (PNG, JPG o WebP, max 5 MB ciascuno). Poi **Invia**."
        },
        {
          "t": "ul",
          "items": [
            "Le segnalazioni di tipo **Bug** e **Funzionalità** aprono automaticamente un issue su GitHub; il semplice **Feedback** no.",
            "**Tracker dei ticket** sotto il modulo elenca i ticket con stato **Aperto**, con quelli **Risolto** ripiegati sotto, così puoi verificare se un problema è già noto.",
            "Se hai effettuato l'accesso, **Le mie segnalazioni** in fondo elenca ciò che hai inviato con il relativo stato: **Nuovo**, **Issue GitHub** o **Chiuso**.",
            "Uno screenshot della schermata esatta più la data e la squadra interessata bastano di solito per far correggere un bug in fretta."
          ]
        },
        {
          "t": "h",
          "text": "Pagina di stato"
        },
        {
          "t": "p",
          "text": "**Options → Stato** (accesso richiesto) mostra se l'app e i suoi flussi di dati funzionano: **Server dell'app**, **Sync Swiss Volley**, **Sync Basketplan** e **Sync piano palestra**, ciascuno con l'indicazione di quanto tempo fa è stato eseguito l'ultima volta. Il banner riporta **Tutti i sistemi sono operativi**, **Una sincronizzazione è in ritardo** oppure **Un servizio è offline**; **Correzioni recenti** elenca i problemi risolti di recente. Guarda qui per prima cosa se i risultati o le fasce palestra sembrano non aggiornati."
        },
        {
          "t": "h",
          "text": "Novità"
        },
        {
          "t": "p",
          "text": "**Options → Novità** apre il **Registro delle modifiche**. La versione in uso (per esempio `v2.12.0`) è mostrata in alto e accanto alla voce di menu. Ogni rilascio è datato e suddiviso in brevi sezioni con titolo, con le modifiche elencate sotto. Le note di rilascio sono sempre in inglese, qualunque sia la lingua impostata nell'app."
        },
        {
          "t": "h",
          "text": "Privacy, note legali e il link del caffè"
        },
        {
          "t": "p",
          "text": "**Privacy** e **Note legali** in fondo al pannello **Altro** aprono l'**Informativa sulla privacy** (quali dati il club conserva, perché, e chi può vederli) e le **Note legali** con l'indirizzo del club e l'email di contatto. L'informativa sulla privacy è quella che hai accettato creando il tuo account."
        },
        {
          "t": "p",
          "text": "**Offrimi un caffè** (menu dell'avatar su desktop, pannello **Altro** sul telefono, e in fondo a **Novità**) apre **Offri un caffè allo sviluppatore**: un ringraziamento personale alla persona che sviluppa Wiedisync, pagato con TWINT. Tocca **Copia il numero** e incollalo nell'app TWINT."
        },
        {
          "t": "note",
          "text": "Non è una donazione al club: non è deducibile dalle tasse e non ha alcun effetto sulla tua quota associativa. Nulla viene pagato all'interno dell'app. Il link compare solo per i membri di almeno 18 anni con una data di nascita nel profilo."
        }
      ]
    },
    "dues": {
      "title": "Fatture e rimborsi",
      "summary": "Le tue fatture del club, come pagarle con la QR-fattura e dove trovi rimborsi e spese arbitrali.",
      "body": [
        {
          "t": "p",
          "text": "Apri **Finanze → Finanze personali → Fatture e rimborsi** sul desktop o **Altro → Finanze → Finanze personali → Fatture e rimborsi** sul telefono. La scheda **Le tue fatture** in Home rimanda qui finché c'è una fattura da pagare. Le fatture di una squadra che guidi sono nella sezione Finanze della squadra; le multe nella sezione Multe."
        },
        {
          "t": "h",
          "text": "Le tue fatture"
        },
        {
          "t": "p",
          "text": "**Saldo aperto** mostra quanto devi ancora. Ogni fattura riporta **Oggetto**, **Data**, **Scadenza**, **Importo**, **Aperto** e **Stato**: **Aperta**, **Parzialmente pagata**, **In attesa di conferma**, **Pagata** o **Annullata**; le fatture copiate da ClubDesk mantengono lo stato in tedesco. Con un'affiliazione gratuita vedi **Nulla da pagare — la tua affiliazione è gratuita.** oppure una fattura di CHF 0.00 che ne spiega il motivo."
        },
        {
          "t": "p",
          "text": "L'importo dipende dalla **Categoria di quota** sotto **Gestito dall'amministrazione** in **Il mio profilo**; per cambiarla rivolgiti al cassiere. La quota include la licenza della federazione; la fattura indica quella parte a sé senza aggiungerla al totale. Chi è tenuto al servizio segnapunti senza licenza da segnapunti paga CHF 100.00 in più, i membri che sono solo giocatori ospiti (effettivi in nessuna squadra) pagano CHF 110.00 in meno, e a membri onorari, comitato e allenatori di una squadra attiva viene fatturato CHF 0.00. I responsabili di squadra pagano la quota normale."
        },
        {
          "t": "h",
          "text": "Pagare una fattura"
        },
        {
          "t": "ol",
          "items": [
            "Tocca una fattura aperta: compare una QR-fattura svizzera con l'importo aperto già inserito.",
            "Scansionala con TWINT o l'app bancaria e paga.",
            "Tocca **Segna come pagata**: la fattura passa a **In attesa di conferma** e sparisce dal saldo aperto."
          ]
        },
        {
          "t": "note",
          "text": "**Segna come pagata** è la tua segnalazione, non il pagamento. Il club imposta **Pagata** quando il denaro arriva; il pulsante funziona solo finché la fattura è ancora **Aperta**."
        },
        {
          "t": "h",
          "text": "IBAN per rimborsi"
        },
        {
          "t": "p",
          "text": "La scheda **IBAN per rimborsi** contiene il conto su cui il club ti rimborsa. Tocca **Aggiungi IBAN** (o **Modifica**) e poi **Salva**; gli IBAN non validi vengono rifiutati. Se il club ha già il tuo IBAN da ClubDesk, rispondi **Sì, è corretto** o **Modifica**. Lo vedono solo finanze e admin. Fino ad allora la Home mostra **Aggiungi il tuo IBAN** o **Conferma il tuo IBAN**; **Più tardi** nasconde quella scheda."
        },
        {
          "t": "tip",
          "text": "Per i rimborsi servono un IBAN svizzero o del Liechtenstein più CAP e località nel profilo; altrimenti il rimborso viene saltato e le finanze ne ricevono il motivo."
        },
        {
          "t": "h",
          "text": "Rimborsi e spese arbitrali"
        },
        {
          "t": "ul",
          "items": [
            "**Rimborsi per te** elenca i pagamenti che il club ti invia: **Annunciato** non ancora trasferito, **Pagato** trasferito; **Scarica PDF** salva il documento. I rimborsi spese compaiono qui quando le finanze li segnano pagati (vedi la sezione Rimborso spese).",
            "**Spese arbitrali che hai pagato** elenca le tasse arbitrali che hai anticipato alle partite in casa di pallavolo, registrate dallo staff della squadra sotto **Spese arbitrali** nella partita. **Fine stagione** attende la tornata di fine stagione, **Rimborsato** con una data è pagato; **Da rimborsare** è il totale della stagione."
          ]
        }
      ]
    },
    "expenses": {
      "title": "Rimborso spese",
      "summary": "Carica una ricevuta per qualcosa che hai pagato per il club e seguila finché le finanze non ti rimborsano.",
      "body": [
        {
          "t": "p",
          "text": "Hai pagato di tasca tua palloni, una quota di torneo o qualcos'altro per il club? Carica la ricevuta e le finanze ti rimborsano. La pagina è **Carica fattura**, sotto **Finanze → Finanze personali → Carica fattura** (desktop) o **Altro → Finanze → Finanze personali → Carica fattura** (telefono)."
        },
        {
          "t": "h",
          "text": "Caricare una ricevuta"
        },
        {
          "t": "ol",
          "items": [
            "Completa la verifica di sicurezza accanto all'area di caricamento; fino ad allora il caricamento resta disattivato.",
            "Tocca **Scegli un file o trascinalo qui** e seleziona la ricevuta: PDF, JPG o PNG, al massimo 8 MB.",
            "Attendi mentre l'app scansiona il documento. Sotto **Controlla i dettagli** precompila **Importo**, **Valuta**, **Data**, **Fornitore**, **Descrizione** e **Riferimento**. Correggi ciò che non va; se la scansione fallisce, compila tu i campi. **Usa un altro file** ricomincia da capo.",
            "Controlla **Rimborsa su questo conto**, aggiungi una **Nota per le finanze** se utile e spunta **Già pagato?** se hai già pagato la fattura di tasca tua.",
            "Tocca **Invia alle finanze**. Le finanze ricevono un'e-mail con la tua ricevuta allegata e tu ne ricevi una copia."
          ]
        },
        {
          "t": "note",
          "text": "Per inviare servono **Importo** e un IBAN valido. Puoi scansionare al massimo 5 ricevute e inviare al massimo 5 richieste all'ora. Inviare due volte lo stesso file non crea una seconda richiesta."
        },
        {
          "t": "h",
          "text": "Il tuo IBAN"
        },
        {
          "t": "p",
          "text": "**Rimborsa su questo conto** è precompilato con l'IBAN del tuo profilo; puoi modificarlo per questa singola spesa. Per aggiornarlo per tutti i rimborsi futuri, usa la scheda **IBAN per rimborsi** descritta nella sezione Fatture e rimborsi, che elenca anche cosa serve per un rimborso."
        },
        {
          "t": "h",
          "text": "Le mie richieste"
        },
        {
          "t": "ul",
          "items": [
            "**In sospeso**: inviata, le finanze non hanno ancora deciso.",
            "**Pagata**: le finanze hanno trasferito il denaro. La richiesta compare anche sotto **Rimborsi per te** in **Fatture e rimborsi**, dove puoi scaricare il documento di pagamento in PDF.",
            "**Respinta**: le finanze hanno rifiutato la richiesta."
          ]
        },
        {
          "t": "p",
          "text": "La tabella **Le mie richieste** in fondo alla pagina elenca ogni richiesta con data, importo, fornitore e **Stato**; un'eventuale nota delle finanze compare sotto lo stato. **Ricevuta** apre il file che hai caricato. Quando una richiesta passa a **Pagata** o **Respinta** ricevi una notifica nell'app, un messaggio push e un'e-mail nella tua lingua, con la nota delle finanze inclusa."
        },
        {
          "t": "h",
          "text": "Chi conferma la tua spesa"
        },
        {
          "t": "p",
          "text": "La tua richiesta viene inoltrata alla TK della tua sezione, al VB admin o al BB admin. La TK conferma che la spesa è a budget e comunica alle finanze se la sezione ti ha già rimborsato. Questo non cambia ciò che vedi: solo le finanze spostano una richiesta da **In sospeso** a **Pagata** o **Respinta**. La coda si trova sotto **Finanze → Finanze del club → Conferma spese** (vedi la sezione Finanze del club)."
        }
      ]
    },
    "fines": {
      "title": "Multe",
      "summary": "Le tue multe, come nascono in automatico, pagamento e annullamento, e la vista delle multe della squadra.",
      "body": [
        {
          "t": "p",
          "text": "Le multe sono le piccole penali di una squadra per iscrizioni tardive, mancate presenze e simili. Le tue stanno sotto **Finanze → Finanze personali → Le mie multe** (sul telefono prima **Altro**); anche la scheda **Multe aperte** in Home porta lì."
        },
        {
          "t": "h",
          "text": "Le tue multe"
        },
        {
          "t": "ul",
          "items": [
            "**Le mie multe** elenca ogni multa con **Squadra**, **Categoria**, **Importo**, **Stato**, **Emessa** e **Motivo** (gli ultimi due solo su schermi più larghi).",
            "L'elenco parte da **Aperta**; scegli **Pagata**, **Annullata** o **Tutte** per vedere lo storico.",
            "**Aperto** in alto somma solo le tue multe personali aperte."
          ]
        },
        {
          "t": "h",
          "text": "Come nasce una multa"
        },
        {
          "t": "ul",
          "items": [
            "**Iscrizione tardiva** — non avevi risposto entro la scadenza, oppure un allenatore ha dovuto confermarti dopo.",
            "**Mancata presenza** — eri iscritto ma non ti sei presentato.",
            "**Ritardo di pagamento** e **Altro** — emesse a mano per qualsiasi altro caso.",
            "Ogni squadra definisce la propria scala: l'importo sale a ogni ripetizione nella stessa categoria (ad esempio CHF 10.00, poi CHF 20.00) e si azzera dopo una finestra da **Mese di calendario** ad **A vita**."
          ]
        },
        {
          "t": "note",
          "text": "Se la tua squadra ha attivato le multe per iscrizione tardiva, chi non risponde a un allenamento o a una partita entro la scadenza risulta assente e viene multato la mattina dopo. Rispondi prima della scadenza, anche con un no. Se un allenatore ti conferma dopo la scadenza, gli viene chiesto se multarti."
        },
        {
          "t": "h",
          "text": "Pagamento, annullamenti e notifiche"
        },
        {
          "t": "ul",
          "items": [
            "L'app non incassa denaro. Salda la multa con il tuo allenatore o responsabile di squadra; sarà lui a premere **Segna come pagata**.",
            "Un allenatore può fare **Annulla** su una multa aperta, sempre con un motivo. Importo, categoria e motivo non si modificano dopo: una multa sbagliata viene annullata ed emessa di nuovo.",
            "Una voce nella campanella e una notifica push ti avvisano quando una multa viene emessa (**Nuova multa**), pagata (**Multa pagata**) o annullata (**Multa annullata**); una multa automatica per iscrizione tardiva arriva come unica push **Allenamento: scadenza mancata** o **Partita: scadenza mancata**. Dopo 14 giorni ricevi una push di promemoria **Multa(e) aperta(e)** al giorno."
          ]
        },
        {
          "t": "h",
          "text": "Multe a tutta la squadra"
        },
        {
          "t": "p",
          "text": "Un allenatore può multare anche tutta la squadra: compare **Tutta la squadra** al posto di un nome, la multa è dovuta dalla cassa di squadra e non conta mai nel tuo **Aperto**. La trovi nella scheda **Squadra** (**Finanze → Finanze della squadra → Multe della squadra**) e nella scheda della home."
        },
        {
          "t": "h",
          "text": "Se sei allenatore o responsabile di squadra"
        },
        {
          "t": "p",
          "text": "**Multe della squadra** mostra tutte le multe delle tue squadre. **Emetti multa** chiede prima **Chi riceve la multa?** (**Un membro** o **Tutta la squadra**), poi la squadra e il membro; l'importo si compila dalla tua scala (modificabile). Una multa di squadra richiede un importo manuale e avvisa tutti i membri della squadra. Scale e controllo automatico: vedi la sezione Regole delle multe. Il riquadro **Multe della cassa di squadra aperte**: vedi la sezione Finanze della squadra."
        }
      ]
    },
    "roster": {
      "title": "Editor del roster",
      "summary": "Gestire il roster della tua squadra: giocatori, numeri, posizioni, livelli ospite, inviti e richieste di adesione.",
      "body": [
        {
          "t": "p",
          "text": "Apri **Strumenti membri → Squadre** (**Squadra** se sei in una sola; telefono: **Altro → Strumenti membri → Squadre**), scegli la squadra e tocca **Modifica squadra**. In cima a **Modifica roster** imposti la **Foto della squadra** con **Carica foto** o **Rimuovi foto** (JPG o PNG, max 10 MB). Sulla pagina della squadra, tocca la foto, scegli **Modifica ritaglio** e poi **Salva**."
        },
        {
          "t": "h",
          "text": "Giocatori nel roster"
        },
        {
          "t": "ul",
          "items": [
            "**Aggiungi giocatore**: digita almeno due lettere in **Cerca per nome...** e tocca il membro; vengono proposti solo i membri attivi del club.",
            "Rimuovere: tocca la X rossa, poi **Rimuovi** nella finestra **Rimuovi giocatore**.",
            "Numero: tocca il valore **#**, digita il numero e premi Invio.",
            "**Posizione**: spunta una o più posizioni. **Solo staff** è per staff che non gioca e non riceve numero.",
            "**K** segna il capitano; toccando **K** sul capitano attuale lo togli.",
            "**O** fa scorrere il livello ospite: **O** → **G1** → **G2** → **G3** → e ricomincia; si salva subito."
          ]
        },
        {
          "t": "note",
          "text": "I livelli ospite 1–3 danno la priorità quando gli allenamenti sono pieni: 1 la più alta, 3 la più bassa. Gli ospiti sono elencati sotto **Ospiti** sulla pagina della squadra e restano esclusi quando le partite si confermano automaticamente."
        },
        {
          "t": "h",
          "text": "Far entrare le persone nell'app"
        },
        {
          "t": "ul",
          "items": [
            "Un'icona a busta (**Invia invito WiediSync**) compare accanto ai giocatori con e-mail ma senza login. Toccala: l'invito parte per e-mail e si apre un codice QR con **Copia link**; funziona una sola volta, per 30 giorni.",
            "**Aggiungi utente esterno** serve per chi non è ancora nel club. Scegli **Si unisce come:** **Giocatore/trice** o **Ospite** L1–L3, tocca **Genera codice QR** e mostra il codice oppure **Copia link**. Il link vale una sola volta per 7 giorni; al massimo 20 inviti aperti per squadra.",
            "La persona inserisce nome ed e-mail, conferma il codice ricevuto per e-mail e imposta una password. Entra subito nel roster come **Temporaneo**; se il login non viene attivato entro 30 giorni la voce sparisce da sola (promemoria e-mail 10 giorni prima)."
          ]
        },
        {
          "t": "h",
          "text": "Richieste di adesione"
        },
        {
          "t": "p",
          "text": "Quando un membro chiede di unirsi alla tua squadra, ogni allenatore e responsabile di squadra riceve una notifica **Richiesta di adesione** e un'e-mail. Un riquadro ambra sulla pagina della squadra la elenca: scegli **Si unisce come:** **Giocatore/trice** o **Ospite** L1–L3, poi **Approva** o **Rifiuta**. Le iscrizioni di nuovi membri che hanno scelto la tua squadra compaiono nello stesso riquadro con solo **Approva** e **Rifiuta**."
        },
        {
          "t": "note",
          "text": "**Rifiuta** su un'iscrizione termina l'affiliazione al club e l'accesso all'app della persona, senza conferma. Rifiutare la richiesta di adesione di un membro esistente chiude solo quella richiesta."
        },
        {
          "t": "h",
          "text": "Se sei admin"
        },
        {
          "t": "p",
          "text": "Solo gli admin in modalità admin modificano lo staff: **Gestisci lo staff** accanto a **Staff** sulla pagina della squadra aggiunge o rimuove membri sotto **Allenatori** e **Responsabili di squadra**, concedendo o revocando anche il loro accesso da responsabile nell'app."
        }
      ]
    },
    "coaching": {
      "title": "Gestire allenamenti, partite ed eventi",
      "summary": "Come allenatori e responsabili di squadra creano, modificano e annullano attività, convocano giocatori e leggono le presenze.",
      "body": [
        {
          "t": "p",
          "text": "Gestisci le attività sulle stesse pagine dei tuoi giocatori (vedi le sezioni Allenamenti, Partite e risultati ed Eventi). I comandi in più compaiono solo per le squadre che guidi."
        },
        {
          "t": "h",
          "text": "Allenamenti"
        },
        {
          "t": "ul",
          "items": [
            "**Nuovo allenamento** → **Allenamento singolo**: **Fascia auto** prende orario e palestra dalla fascia della squadra; **Manuale** li lascia a te. I predefiniti della squadra precompilano **Min. partecipanti**, **Cancellazione automatica**, **Nota obbligatoria in caso di assenza** e **Rispondi entro**.",
            "**Nuovo allenamento** → **Allenamenti ricorrenti**: scegli una fascia palestra o un giorno della settimana, un intervallo di date o **A tempo indeterminato**, poi **Anteprima date** e **Genera**; le date passate, chiuse o occupate vengono saltate.",
            "Modificando un allenamento di una fascia palestra, l'app chiede l'ambito: **Solo questo allenamento**, **Tutti gli allenamenti dello stesso giorno della settimana** o **Tutti gli allenamenti ricorrenti**. Le modifiche si copiano sugli allenamenti futuri; le date no.",
            "**Annulla allenamento** avvisa la squadra e libera la fascia, **Ripristina** lo riattiva."
          ]
        },
        {
          "t": "note",
          "text": "L'app accorcia o annulla l'allenamento di un'altra squadra quando una partita in casa ha bisogno della palestra, e annulla l'allenamento nel giorno di partita della squadra. Un allenamento ripristinato a mano non viene ritoccato."
        },
        {
          "t": "h",
          "text": "Eventi"
        },
        {
          "t": "ul",
          "items": [
            "**Nuovo evento**: titolo, tipo, date o **Tutto il giorno**, **Ritrovo**, luogo e risposte (**Rispondi entro**, **Consenti risposte \"Forse\"**, **Max partecipanti**).",
            "Lascia **Squadre** vuoto per un evento di tutto il club; **Invita giocatori/trici ospiti** disattivato esclude gli ospiti.",
            "Eventi su più giorni: **Modalità di partecipazione** → **Per giorno** o **Per fascia oraria** fa rispondere per giorno o fascia.",
            "**Link di iscrizione pubblico**, per chi è senza account, compare se hai creato tu l'evento o in **Modalità admin**: **Crea link**, **Sostituisci link** (il vecchio smette di funzionare) o **Disattiva** (le iscrizioni restano). Solo gli admin vedono **Tutte le iscrizioni**."
          ]
        },
        {
          "t": "h",
          "text": "Partite"
        },
        {
          "t": "ul",
          "items": [
            "I risultati arrivano di notte dalle federazioni, non da te.",
            "**Imposta scadenza** fissa la scadenza di risposta. **Ritrovo** è salvato come minuti prima dell'inizio e resta valido se la partita viene spostata.",
            "**Giocatori/trici convocati**: **Convoca giocatori/trici** da un'altra squadra dello stesso sport, **Apri a un’intera squadra** o singolarmente; vengono avvisati e rispondono. **Ha una partita quel giorno** segnala una sovrapposizione.",
            "**Spese arbitrali** (partite in casa di pallavolo): registra chi ha pagato gli arbitri e quanto; la Home mostra **Registra ora** per 14 giorni (vedi la sezione Finanze della squadra)."
          ]
        },
        {
          "t": "h",
          "text": "Presenze e capienza"
        },
        {
          "t": "p",
          "text": "La scheda **Dashboard allenatore** in Allenamenti e **Dashboard coach** in Partite e risultati mostra per giocatore **Presente**, **Assente**, **Tasso** (verde dall'80 %, arancione dal 50 %) e **Tendenza** per un intervallo **Da**/**A**. Confermato conta come presente; rifiutato, assenza o nessuna risposta a un'attività passata come assente (diversamente da **Statistiche** nel profilo del giocatore, che esclude le attività coperte da un'assenza). **Solo campionato** toglie le partite di coppa."
        },
        {
          "t": "tip",
          "text": "In **Vedi lista** cambi la risposta di qualsiasi giocatore o la azzeri con **Cancella**; con **Max partecipanti** la lista mostra i posti rimasti o **Completo**."
        }
      ]
    },
    "matchsheet": {
      "title": "Referto di gara",
      "summary": "Numeri, capitano e libero per partita, modifiche d'emergenza alla lista e documenti d'identità al tavolo.",
      "body": [
        {
          "t": "p",
          "text": "Il referto di gara è impostato come quello cartaceo: **Nascita**, **N.** e **Nome**, il numero del capitano cerchiato, i liberi ripetuti sotto **Libero**, gli allenatori sotto **Ufficiali**. Apri una partita imminente da **Attività → Partite e risultati** (desktop) o dalla scheda **Partite** (telefono) e tocca **Referto di gara**: si apre a tutto schermo e si ingrandisce con le dita per il segnapunti."
        },
        {
          "t": "p",
          "text": "Il pulsante compare per l'allenatore o il responsabile della squadra che gioca, in casa e in trasferta, da sei ore prima dell'inizio a tre ore dopo. Il segnapunti designato (non il tabellone) vede una versione di sola lettura da 40 minuti prima di una partita in casa. Fuori da questa finestra vedi solo **Il referto di gara si apre poco prima della partita e si chiude 3 ore dopo.**"
        },
        {
          "t": "h",
          "text": "Da dove vengono i giocatori"
        },
        {
          "t": "ul",
          "items": [
            "**Dall'Einsatzliste registrata in Volleymanager.** Questa lista decide chi gioca. La colonna **✓** confronta ogni giocatore con la sua risposta: verde confermato, ambra forse o nessuna risposta, croce rossa declinato.",
            "**Dalle presenze confermate — nessuna Einsatzliste disponibile.** La soluzione di riserva per il basket e per le liste non registrate (senza colonna **✓**).",
            "Un segnale di avvertimento indica che Volleymanager segnala quel giocatore come non qualificato."
          ]
        },
        {
          "t": "h",
          "text": "Modificare il referto"
        },
        {
          "t": "ol",
          "items": [
            "Tocca **Modifica**.",
            "Inserisci il numero di maglia (1–99) nella colonna **N.**.",
            "Tocca **C** per segnare il capitano (uno per referto) e **L** per segnare un libero.",
            "Tocca **Salva**; la didascalia mostra poi **Adattato da** e il tuo nome. **Fatto** esce senza salvare."
          ]
        },
        {
          "t": "note",
          "text": "Salvato solo per questa partita: rosa, capitano della squadra e Volleymanager non vengono toccati. Il referto è sempre ordinato per numero, i giocatori senza numero in fondo."
        },
        {
          "t": "p",
          "text": "Modifiche d'emergenza: durante la modifica, **Aggiungi dalla squadra · solo in caso di emergenza** elenca il resto della rosa. **+** aggiunge un giocatore, **✕** ne cancella uno (barrato) e **↺** lo rimette. Ogni aggiunta o rimozione fa comparire il banner rosso **La lista dei giocatori differisce dall'Einsatzliste**: l'app non la trasmette, quindi devi inserire la stessa modifica a mano in Volleymanager. **Ripristina l'Einsatzliste** (visibile dopo aver salvato) rimuove ogni adattamento per questa partita, numeri compresi."
        },
        {
          "t": "h",
          "text": "Mostra i documenti d'identità"
        },
        {
          "t": "p",
          "text": "Allenatori e responsabili di squadra (non gli admin) hanno anche **Mostra i documenti d'identità**: i documenti d'identità dei giocatori, decifrati sul tuo dispositivo con la tua chiave personale (vedi la sezione Documenti d'identità). Tocca **Sblocca** una volta per dispositivo, poi **Scarica per offline** finché hai campo. Funziona da 45 minuti prima dell'inizio fino all'inizio: scorri i giocatori nell'ordine del referto; le scansioni PDF si aprono in un visualizzatore; ognuna ha una filigrana. All'inizio della partita i documenti vengono rimossi dal telefono e ogni apertura viene registrata."
        },
        {
          "t": "h",
          "text": "Se sei il capitano"
        },
        {
          "t": "p",
          "text": "Il tuo numero è quello cerchiato; l'allenatore assegna la **C** per ogni partita. Non puoi aprire il referto da solo: chiedi all'allenatore, al responsabile di squadra o al segnapunti."
        }
      ]
    },
    "broadcast": {
      "title": "Contatta: raggiungi tutti su un'attività",
      "summary": "Invia un'email o una push alle persone di una partita, un allenamento o un evento, filtrate per stato RSVP.",
      "body": [
        {
          "t": "p",
          "text": "**Contatta** invia un solo messaggio a tutte le persone collegate a un'attività. Apri una partita, un allenamento o un evento da **Home**, dal **Calendario** o da **Attività → Partite e risultati**, **Allenamenti** o **Eventi** (telefono: le schede in basso o **Altro → Eventi**). Il pulsante **Contatta** sta accanto a **Condividi link** nel dettaglio. Sulle partite appare solo finché la partita è programmata."
        },
        {
          "t": "h",
          "text": "Chi può inviare"
        },
        {
          "t": "ul",
          "items": [
            "Allenatori e responsabili di squadra: solo le partite e gli allenamenti della propria squadra, non gli eventi.",
            "Admin pallavolo e admin basket: le partite e gli allenamenti del loro sport.",
            "Admin: ogni attività. Membri del comitato: gli eventi; per partite e allenamenti serve uno dei ruoli sopra.",
            "Capitani e giocatori non vedono mai il pulsante."
          ]
        },
        {
          "t": "h",
          "text": "Inviare un messaggio"
        },
        {
          "t": "ol",
          "items": [
            "Sotto **Canale**, spunta **Email** (attivo di default) e/o **Push** (disattivo di default). Ne serve almeno uno.",
            "Sotto **Destinatari**, spunta gli stati RSVP che vuoi: **Confermato**, **Forse**, **Rifiutato**, **Lista d’attesa** e **Nessuna risposta**. **Confermato** e **Forse** sono già spuntati.",
            "Su un evento, spunta **Includi iscrizioni esterne** per inviare l'email anche a chi si è iscritto tramite il link pubblico.",
            "Controlla l'anteprima (**Destinatari: 12 (10 membri · 2 esterni)** e alcuni nomi d'esempio). Se dice **Nessuno corrisponde a questi filtri.**, cambia le spunte: il messaggio non arriverebbe a nessuno.",
            "Scrivi un **Oggetto** (mostrato solo quando **Email** è attivo, da 3 a 200 caratteri) e un **Messaggio** (fino a 2000 caratteri).",
            "Premi **Invia**, poi conferma **Inviare il broadcast?**. Compare una conferma **Broadcast inviato: 12 destinatari**."
          ]
        },
        {
          "t": "h",
          "text": "Chi lo riceve"
        },
        {
          "t": "ul",
          "items": [
            "**Nessuna risposta** significa tutte le persone del roster idoneo che non hanno risposto affatto: per le partite il roster principale senza i giocatori ospiti, per gli allenamenti il roster dopo le regole ospiti dell'allenamento, per gli eventi le squadre e i membri invitati.",
            "I membri disattivati non vengono mai contattati. Le email vanno a ogni membro selezionato con un indirizzo email; le push solo ai membri che hanno attivato le notifiche push su un dispositivo. Le iscrizioni esterne ricevono solo l'email.",
            "Ogni persona riceve la propria email nella propria lingua, con il tuo nome, i dettagli dell'attività, il tuo messaggio e un pulsante **Apri in Wiedisync**. Nessuno vede gli indirizzi degli altri.",
            "Una push mostra il tuo oggetto come titolo e i primi 200 caratteri del tuo messaggio. Toccandola si apre l'attività."
          ]
        },
        {
          "t": "note",
          "text": "Le email broadcast vengono sempre inviate: non seguono gli interruttori **Notifiche e-mail** nel profilo di un membro. L'invio non può essere annullato, quindi leggi l'anteprima prima di confermare."
        },
        {
          "t": "note",
          "text": "Limiti: al massimo 3 messaggi per attività all'ora, almeno 20 minuti tra due messaggi sulla stessa attività (chiunque li invii) e al massimo 10 messaggi per mittente all'ora. Oltre questi limiti vedi un messaggio come **Attendi 14 minuto/i e riprova.**"
        },
        {
          "t": "tip",
          "text": "Se spunti solo **Push**, il campo **Oggetto** non c'è; la push usa invece il titolo dell'attività."
        }
      ]
    },
    "teamfinance": {
      "title": "Finanze della squadra",
      "summary": "Fatture della squadra, registrazioni della cassa di squadra e spese arbitrali, e come funziona il rimborso a fine stagione.",
      "body": [
        {
          "t": "p",
          "text": "Apri **Finanze → Finanze della squadra → Finanze della squadra** su desktop; sul telefono sotto **Altro → Finanze**. La voce compare se fai parte di una squadra attiva come giocatore, allenatore, responsabile di squadra o capitano. Scegli **Squadra** e **Stagione** (questa o la precedente)."
        },
        {
          "t": "h",
          "text": "Cosa mostra la pagina"
        },
        {
          "t": "ul",
          "items": [
            "**Saldo**: **Entrate** meno **Uscite** delle registrazioni della cassa di squadra.",
            "**Fatture della squadra aperte**: quanto la squadra deve ancora sulle fatture a lei intestate.",
            "**Spese arbitrali questa stagione**: spese pagate alle partite in casa di pallavolo. Mostrate per informazione, mai incluse nel saldo.",
            "**Multe della cassa di squadra aperte**: multe aperte emesse a tutta la squadra. **Mostra le multe della squadra** apre la vista (vedi la sezione Multe)."
          ]
        },
        {
          "t": "h",
          "text": "Fatture della squadra"
        },
        {
          "t": "p",
          "text": "Le finanze possono intestare una fattura alla squadra invece che a una persona, ad esempio una multa della federazione. Compare sotto **Fatture della squadra** e, se guidi la squadra, come **Fatture della squadra aperte: CHF 120.00** nella scheda **Le tue fatture** in Home. Come allenatore, responsabile di squadra o capitano tocchi la fattura aperta per la QR-fattura, paghi con TWINT o l'app bancaria, poi tocchi **Segna come pagata**. La fattura passa a **In attesa di conferma** e solo le finanze la segnano **Pagata** quando il denaro arriva. La rosa vede le fatture della squadra in sola lettura."
        },
        {
          "t": "h",
          "text": "Registrazioni e spese arbitrali"
        },
        {
          "t": "p",
          "text": "**Registrazioni** elenca i movimenti della cassa di squadra nella stagione. Le righe **Sponsoring**, **Altre entrate** e **Uscita** le registrano le finanze; non puoi aggiungerle qui. Le righe **Spese arbitrali** vengono dalle partite: dopo una partita in casa di pallavolo, un allenatore o responsabile di squadra apre la partita in **Attività → Partite e risultati** (scheda **Partite** sul telefono) e compila **Spese arbitrali** con **Pagato da** (un membro della rosa o **Altra persona** con un nome), **Importo (CHF)** e **Note**, poi **Salva**. I capitani non registrano spese. Ogni riga mostra chi ha pagato e uno stato."
        },
        {
          "t": "h",
          "text": "Rimborso a fine stagione"
        },
        {
          "t": "p",
          "text": "Il club rimborsa le spese arbitrali una volta per stagione, con un unico versamento per membro eseguito dalle finanze. Fino ad allora una spesa mostra **Fine stagione**; **Registrato** è inserita con CHF 0.00; **Annunciato** il versamento esiste ma il denaro non è ancora partito; **Rimborsato 15.06.2026** è saldata. Dopo l'esecuzione la registrazione della partita è bloccata: **Rimborsato dal club — non più modificabile.** Chi ha pagato vede le stesse spese sotto **Spese arbitrali che hai pagato** in **Fatture e rimborsi**."
        },
        {
          "t": "tip",
          "text": "Un versamento viene saltato se chi ha pagato non ha nel profilo un IBAN svizzero o del Liechtenstein, oppure NPA e località. Chiedi di controllare il profilo prima di fine stagione."
        },
        {
          "t": "note",
          "text": "Se la pagina mostra **Per questa stagione non esiste ancora un esercizio — registrazioni e fatture appariranno quando le finanze lo apriranno.** non è andato perso nulla: le finanze non hanno ancora aperto la stagione."
        }
      ]
    },
    "finerules": {
      "title": "Regole delle multe",
      "summary": "Imposta scaglioni e finestre di reset della squadra, multe automatiche per iscrizione tardiva, annullamenti e il PDF.",
      "body": [
        {
          "t": "p",
          "text": "Apri **Strumenti membri → Squadre** (**Squadra** se sei in una sola; telefono: **Altro → Strumenti membri → Squadre**), apri la squadra, tocca **Modifica squadra** e cerca **Multe** in fondo a **Impostazioni squadra**. Lo vedono solo allenatori e responsabili della squadra (o gli admin in modalità admin)."
        },
        {
          "t": "h",
          "text": "Categorie e scale"
        },
        {
          "t": "p",
          "text": "Ogni categoria (**Iscrizione tardiva**, **Mancata presenza**, **Ritardo di pagamento**, **Altro**) ha un interruttore **Attivato**, una **Finestra di reset** e degli **Scaglioni di escalation**."
        },
        {
          "t": "ul",
          "items": [
            "**Aggiungi scaglione**, imposta **N. infrazione** e **Importo**. Attiva **E tutte le successive** sull'ultimo scaglione per coprire ogni infrazione successiva. Gli importi vengono salvati quando esci dal campo; **Anteprima** mostra la scala.",
            "La **Finestra di reset** decide quando il conteggio riparte: **Mese di calendario**, **30 giorni mobili**, **90 giorni mobili**, **Stagione (set–ago)** o **A vita**.",
            "Il numero dell'infrazione conta le multe precedenti del membro in quella categoria e squadra nella finestra; le multe annullate non contano mai."
          ]
        },
        {
          "t": "note",
          "text": "**Stagione (set–ago)** in realtà si azzera il 1º giugno, quando l'app passa alla nuova stagione."
        },
        {
          "t": "p",
          "text": "Per **Iscrizione tardiva** e **Mancata presenza**, attiva **Per tipo di attività**: **Allenamenti**, **Partite** ed **Eventi** hanno ciascuno il proprio **Attivato**, la propria finestra e i propri scaglioni, e contano le proprie infrazioni. Le scale partono come copie di quella generale; un tipo disattivato non viene multato. Disattivare **Per tipo di attività** elimina gli scaglioni per tipo dopo una conferma."
        },
        {
          "t": "h",
          "text": "Multe automatiche per iscrizione tardiva"
        },
        {
          "t": "note",
          "text": "Attivare una regola **Iscrizione tardiva** (generale, oppure la variante **Allenamenti** o **Partite**) avvia un controllo notturno: ogni mattina, chi non ha risposto entro una scadenza passata viene registrato come assente, multato secondo la tua scala e avvisato. Gli eventi non vengono mai controllati."
        },
        {
          "t": "ul",
          "items": [
            "Vengono controllati solo gli allenamenti e le partite futuri con una scadenza negli ultimi tre giorni.",
            "Lo staff, i giocatori convocati da altre squadre e chi non poteva rispondere non vengono mai multati; gli allenamenti annullati per mancanza di partecipanti vengono saltati.",
            "Una regola senza scaglioni registra il giocatore come assente ma non emette nessuna multa.",
            "Se confermi un giocatore nella rosa dopo la scadenza, si apre la finestra **Emetti multa** già compilata con **Iscrizione tardiva**; **Annulla** salta la multa, la risposta resta salvata."
          ]
        },
        {
          "t": "h",
          "text": "Annullare e correggere"
        },
        {
          "t": "p",
          "text": "Importo, categoria e motivo di una multa emessa non si possono modificare. Per correggerla, apri **Finanze → Finanze della squadra → Multe della squadra**, clicca **Annulla** e indica un **Motivo dell’annullamento** (obbligatorio). Il membro viene avvisato, la multa non conta più sulla scala e puoi emetterne una nuova. Le multe a tutta la squadra saltano la scala, quindi l'importo lo inserisci tu."
        },
        {
          "t": "tip",
          "text": "**Scarica il riepilogo (PDF)** nel pannello **Multe** crea un foglio per la squadra: totali per membro (aperte, pagate, annullate), tutte le multe in ordine di data e le regole che ne hanno determinato l'importo. È sempre in inglese. La vista dei membri è descritta nella sezione Multe."
        }
      ]
    },
    "formsauthoring": {
      "title": "Creare moduli",
      "summary": "Crea moduli per la tua squadra o il club, pubblicali, sollecita chi non ha risposto e leggi le risposte.",
      "body": [
        {
          "t": "p",
          "text": "I moduli stanno in **Strumenti membri → Moduli** su desktop e **Altro → Strumenti membri → Moduli** sul telefono; la voce la vedono solo allenatori, responsabili di squadra, comitato e admin. Premi **Nuovo modulo** nella tabella **Gestisci moduli**."
        },
        {
          "t": "h",
          "text": "Creare un modulo"
        },
        {
          "t": "ol",
          "items": [
            "Inserisci un **Titolo** e, se vuoi, una **Descrizione**.",
            "Premi **Aggiungi campo** per ogni domanda, scegli un tipo (**Testo breve**, **Scelta singola**, **Valutazione (1–5)**, **Caricamento file** e altri) e spunta **Obbligatorio** se serve una risposta. Le opzioni di scelta vanno una per riga.",
            "Riordina con **Sposta su** / **Sposta giù**; **Traduci** aggiunge etichette per lingua.",
            "In **Squadre** seleziona le squadre che guidi; solo i loro membri vedono il modulo. I membri del comitato e gli admin in **Modalità admin** scelgono prima i **Destinatari** (**Tutto il club** o **Squadre specifiche**).",
            "Imposta **Chiusura** per una scadenza: dopo quella data e ora non si può più rispondere.",
            "Facoltativo: **Anonimo** (le risposte non sono associate a nessun membro), **Consenti invii multipli**, **Messaggio di ringraziamento**.",
            "**Anteprima** mostra il modulo come lo vedranno i membri; poi **Salva**."
          ]
        },
        {
          "t": "h",
          "text": "Pubblicare e chiudere"
        },
        {
          "t": "p",
          "text": "Un nuovo modulo è una **Bozza**, invisibile ai membri. Imposta lo **Stato** su **Aperto** (o premi l'icona del lucchetto, **Apri**, in **Gestisci moduli**) per pubblicarlo: giocatori, allenatori e responsabili delle squadre selezionate ricevono una notifica a campanella e push **Nuovo modulo**, una sola volta; le modifiche successive non ne inviano altre. **Chiudi** interrompe gli invii in anticipo; la data di chiusura lo fa da sola."
        },
        {
          "t": "note",
          "text": "Eliminare un modulo (icona del cestino) elimina anche tutte le sue risposte e non può essere annullato. Chiudilo invece, per fermare le nuove risposte."
        },
        {
          "t": "h",
          "text": "Risposte e promemoria"
        },
        {
          "t": "p",
          "text": "L'icona del grafico a barre apre **Risposte**: una riga per invio, una colonna per domanda, più l'esportazione in CSV, Excel, JSON e PDF. Se il modulo non è anonimo o pubblico vedi anche quanti dei membri destinatari hanno risposto, chi manca ancora e **Invia promemoria a chi non ha risposto**, che invia un promemoria a campanella e push (nessuna e-mail; al massimo una volta ogni 10 minuti per modulo). Ogni nuova risposta ti avvisa con **Nuova risposta**."
        },
        {
          "t": "h",
          "text": "Moduli per tutto il club e pubblici"
        },
        {
          "t": "p",
          "text": "I destinatari **Tutto il club** e l'interruttore **Modulo pubblico** richiedono la **Modalità admin** (membri del comitato e admin). Un modulo pubblico ha un **Indirizzo web** e un **Link pubblico** che chiunque può compilare senza accedere. I moduli pubblici e anonimi non hanno né il monitoraggio delle risposte né i promemoria."
        },
        {
          "t": "h",
          "text": "Moduli di iscrizione agli eventi"
        },
        {
          "t": "p",
          "text": "I membri rispondono agli eventi nell'app, non tramite un modulo (vedi la sezione Eventi). Per chi non ha un account, usa il **Link di iscrizione pubblico** dell'evento (vedi la sezione Gestire allenamenti, partite ed eventi). In **Modalità admin** le iscrizioni degli ospiti compaiono in **Tutte le iscrizioni** con **Esporta CSV**, e quando modifichi un evento puoi collegare un **Modulo di iscrizione pubblico**."
        }
      ]
    },
    "hallbooking": {
      "title": "Piano palestra e ore libere",
      "summary": "Come leggere la griglia palestra, i tipi di fascia e le chiusure, e come richiedere o rilasciare ore libere per la tua squadra.",
      "body": [
        {
          "t": "p",
          "text": "Apri **Attività → Calendario** (desktop) o la scheda **Calendario** (telefono) e passa alla vista **Palestra**. Sul desktop vedi la settimana, sul telefono un giorno; **Oggi** ti riporta a oggi. Filtra per sport (**VB** preselezionato, **BB** o **Tutti**) o per palestra (chip sotto la griglia). Sul telefono, **Riepilogo** mostra tutta la settimana."
        },
        {
          "t": "h",
          "text": "Leggere la griglia"
        },
        {
          "t": "ul",
          "items": [
            "I blocchi indicano il loro tipo: **Allenamento**, **Partita** o **Evento**. Una partita in casa blocca la palestra da 45 minuti prima dell'inizio; un allenamento annullato è barrato.",
            "Un blocco verde **Disponibile** è tempo libero in palestra: la fascia di una squadra in un giorno in cui gioca in trasferta, un allenamento annullato, una fascia liberata dagli admin per qualsiasi squadra o una fascia settimanale senza allenamento in quella settimana (fino a 12 settimane in anticipo).",
            "Un blocco **Richiesta** (bordo tratteggiato) è una fascia presa da una squadra; toccalo per vedere **Richiesta da** e **Richiesta il**.",
            "Una sovrapposizione tratteggiata **Chiuso** indica il motivo: le fasce della palestra spariscono, gli allenamenti vengono annullati e lì non si prenota nessuna partita in casa (vedi la sezione Amministrazione del piano palestra)."
          ]
        },
        {
          "t": "h",
          "text": "Richiedere ore libere in palestra"
        },
        {
          "t": "ol",
          "items": [
            "Tocca un blocco verde **Disponibile**, o il pulsante verde **fascia/e disponibile/i** e scegli un orario da **Fasce disponibili**.",
            "**Richiedi fascia palestra** mostra palestra, data, orari, il **Motivo** (**Allenamento annullato**, **Partita in trasferta** o **Disponibile**) e, sotto **Originariamente**, la squadra che normalmente ha la fascia.",
            "Scegli la tua squadra sotto **Per la squadra**, aggiungi eventuali **Note** e tocca **Richiedi**. Il blocco diventa **Richiesta** per tutto il club."
          ]
        },
        {
          "t": "note",
          "text": "Le date passate non si possono richiedere (**Non è possibile richiedere fasce passate.**) e ogni fascia accetta una sola richiesta per data: se qualcuno è stato più veloce vedi **Questa fascia è già stata richiesta.** Se la squadra originaria ripristina l'allenamento annullato, la tua richiesta viene rilasciata da sola. Richieste e rilasci vengono registrati con il tuo nome."
        },
        {
          "t": "tip",
          "text": "Quando crei un allenamento in quella data, il modulo dell'allenamento ti propone l'orario come **Fascia richiesta** (vedi la sezione Gestire allenamenti, partite ed eventi)."
        },
        {
          "t": "h",
          "text": "Rilasciare una richiesta"
        },
        {
          "t": "p",
          "text": "Tocca il blocco **Richiesta**, poi **Rilascia** in **Dettagli richiesta** e conferma: il blocco torna **Disponibile**. Può rilasciarla solo un allenatore o responsabile della squadra richiedente (o un admin di quello sport in modalità admin)."
        },
        {
          "t": "h",
          "text": "Trovare una palestra comunale libera"
        },
        {
          "t": "p",
          "text": "**Trova palestre** elenca le palestre della città di Zurigo con una fascia ricorrente libera per tutta la stagione invernale, aggiornate ogni notte dal sistema di prenotazione della città. Filtra per **Giorno della settimana**, **Dalle**, **Durata min.**, **Distretto**, **Tipo di palestra** e **Libera ogni settimana (escluse vacanze scolastiche)**. **Calendario** apre il piano di occupazione della città, **Richiedi** la pagina di prenotazione, **Esporta in Excel** scarica l'elenco."
        },
        {
          "t": "tip",
          "text": "Allenatori, responsabili di squadra e membri del comitato non hanno una voce di menu: apri direttamente `/admin/hallenfinder`. Gli admin la trovano sotto **Admin → Pianificazione & palestre → Trova palestre**."
        }
      ]
    },
    "teamabsences": {
      "title": "Assenze e blocchi della squadra",
      "summary": "Vedi chi della tua squadra è assente, registra assenze per i giocatori e blocca date perché non venga pianificata nessuna partita.",
      "body": [
        {
          "t": "p",
          "text": "Come allenatore o responsabile della squadra vedi le assenze della squadra in un unico posto. Apri **Strumenti membri → Assenze** (desktop) o **Altro → Strumenti membri → Assenze** (telefono) e sposta l'interruttore inferiore da **Le mie** a **Squadra**. L'interruttore superiore sceglie tra **Assenze** (una tantum) e **Settimanali**."
        },
        {
          "t": "h",
          "text": "La vista squadra"
        },
        {
          "t": "ul",
          "items": [
            "Imposta il periodo con **Da** e **A**, restringi il filtro squadra e usa **Filtra per membro** per nascondere singoli giocatori.",
            "Passa dalla lista al calendario mensile e viceversa con le due icone a destra.",
            "**Nascondi indisponibilità** nasconde gli schemi settimanali. **Nascondi assenze non bloccanti** nasconde le assenze con l'interruttore **Blocca la pianificazione delle partite** disattivato; queste portano il badge **Non bloccante**.",
            "Nel calendario, i giorni coperti da un blocco squadra sono evidenziati in rosso, come i giorni in cui la palestra è chiusa."
          ]
        },
        {
          "t": "h",
          "text": "Registrare un'assenza per un giocatore"
        },
        {
          "t": "ol",
          "items": [
            "Nell'ambito **Squadra** clicca **Assenza per un membro**, oppure **Settimanale per un membro** nella vista **Settimanali**.",
            "Scegli il **Membro** (membri delle squadre mostrate nel filtro squadra), le date, il **Motivo**, cosa **Riguarda** e se **Blocca la pianificazione delle partite**.",
            "Scrivi perché la stai registrando in **Dettagli (facoltativo)**; il giocatore può leggere la nota."
          ]
        },
        {
          "t": "p",
          "text": "Il giocatore riceve una notifica e la riga risulta modificata dallo staff, con il tuo nome e la data. Come per ogni assenza, le risposte del giocatore per le attività coperte vengono rifiutate da sole; vedi la sezione Assenze."
        },
        {
          "t": "h",
          "text": "Blocchi squadra"
        },
        {
          "t": "p",
          "text": "Un blocco squadra è un blocco rigido per la pianificazione delle partite: in quelle date non viene piazzata nessuna partita per la squadra, in casa o in trasferta, anche se mancano solo pochi giocatori. Nell'ambito **Squadra**, nella vista **Assenze**, il pannello **Blocchi squadra** elenca i blocchi attuali e futuri. Clicca **Aggiungi blocco**, scegli la **Squadra**, **Da** e **A**, aggiungi un **Motivo (facoltativo)** e salva. Per rimuoverne uno, clicca l'icona del cestino (**Elimina**) accanto e conferma; i blocchi passati spariscono dalla lista da soli."
        },
        {
          "t": "note",
          "text": "Puoi bloccare solo le squadre di cui sei allenatore o responsabile. Gli Spielplaner per tutto il club e gli admin in modalità admin possono bloccare anche altre squadre. Un blocco per tutto il club è un'impostazione separata; vedi la sezione Spielplanung."
        },
        {
          "t": "h",
          "text": "Come le assenze arrivano alla Pianificazione"
        },
        {
          "t": "ul",
          "items": [
            "Contano solo le assenze una tantum con **Blocca la pianificazione delle partite** attivo che riguardano **Partite** o **Tutto**. Le indisponibilità settimanali e le assenze dei giocatori ospiti vengono ignorate.",
            "Le prime due proposte di data inviate a un avversario non devono avere nessun giocatore assente. La terza proposta tollera una o due assenze e viene rifiutata a partire da tre.",
            "Un blocco squadra esclude completamente una data, qualunque sia il numero di assenze."
          ]
        },
        {
          "t": "tip",
          "text": "I giocatori infortunati o assenti a lungo dovrebbero disattivare **Blocca la pianificazione delle partite** sulla loro assenza, oppure lo fai tu al posto loro, così il resto della squadra può comunque essere pianificato."
        }
      ]
    },
    "jsexport": {
      "title": "Esportazione J+S",
      "summary": "Scarica i file CSV Jugend+Sport delle attività e delle presenze della tua squadra, pronti per la NDS.",
      "body": [
        {
          "t": "p",
          "text": "**Esportazione J+S** crea i due file CSV richiesti da Jugend+Sport, attività e presenze, per squadra e stagione, pronti per la Nationale Datenbank Sport (NDS). La apri da **Strumenti membri → Esportazione J+S** sul desktop o **Altro → Strumenti membri → Esportazione J+S** sul telefono. La vedono allenatori, responsabili di squadra, comitato e admin; elenca le squadre che guidi (tutte le squadre attive in modalità admin)."
        },
        {
          "t": "h",
          "text": "Cosa contengono i due file"
        },
        {
          "t": "ul",
          "items": [
            "**Attività**: ogni allenamento non annullato (Training), ogni partita non annullata con avversario e orario di inizio (Wettkampf) e ogni evento di squadra non annullato con **Rilevante per J+S** attivo, con il **Tipo di attività J+S** scelto nel modulo dell'evento (Training, Wettkampf, Trainingstag o Lagertag).",
            "**Presenze**: una riga per attività e persona. I giocatori in rosa contano come Teilnehmer/in, allenatori e responsabili di squadra come Leiter/in; gli ospiti non sono inclusi. Chi ha rifiutato un'attività o ha un'assenza su quella data viene escluso."
          ]
        },
        {
          "t": "h",
          "text": "Stagione e periodo"
        },
        {
          "t": "ul",
          "items": [
            "La **Stagione** va dal 1 settembre al 31 agosto, l'anno J+S. Di default è la stagione che contiene oggi, quindi nella pausa estiva quella appena conclusa.",
            "**Da** e **A** coprono di default l'intera stagione. Restringili per scegliere quali attività ed eventi includere; la rosa resta quella della stagione selezionata."
          ]
        },
        {
          "t": "h",
          "text": "Scaricare i file"
        },
        {
          "t": "ol",
          "items": [
            "Scegli la **Stagione** e, se necessario, **Da** e **A**.",
            "Nella riga della squadra, clicca **Attività** per il file delle attività.",
            "Clicca **Presenze** per il file delle presenze."
          ]
        },
        {
          "t": "note",
          "text": "Nella NDS importa prima il file delle attività, poi quello delle presenze. L'importazione delle attività sostituisce tutte le attività e presenze già registrate in quel corso."
        },
        {
          "t": "h",
          "text": "Avvisi dopo un download"
        },
        {
          "t": "ul",
          "items": [
            "**Alcune persone non hanno un numero J+S e sono state saltate**: i nomi sono elencati sotto **Monitori** e **Giocatori** e restano fuori dal file delle presenze finché il loro numero J+S non è registrato.",
            "**Ad alcuni allenamenti manca il luogo o l'ora — J+S richiede entrambi e altrimenti rifiuta il file**: le date sono elencate sotto **Nessun luogo** e **Nessun orario**. Aggiungi la palestra e l'orario di inizio (vedi la sezione Gestire allenamenti, partite ed eventi), poi scarica di nuovo.",
            "**Nessun partecipante per questa stagione — l'export contiene solo monitori. Controlla la stagione selezionata.**: la rosa di quella stagione è vuota. Il file viene comunque scaricato: controlla la stagione prima di importarlo."
          ]
        },
        {
          "t": "p",
          "text": "I file sono separati da punto e virgola, UTF-8, date dd.mm.yyyy e orari HH:MM. Le regole J+S si applicano da sole: le partite non riportano ora, durata né luogo, ogni allenamento vale 90 minuti (J+S accetta solo 60, 75 o 90), un Trainingstag 240 o 300."
        },
        {
          "t": "tip",
          "text": "I numeri J+S li custodisce il club. Se qualcuno viene saltato, chiedi a un admin di registrare il suo numero J+S, poi scarica di nuovo entrambi i file."
        }
      ]
    },
    "documents": {
      "title": "Documenti d'identità",
      "summary": "Foto del documento cifrate per il giorno della partita: come caricarle, chi può aprirle e come ripristinare l'accesso.",
      "body": [
        {
          "t": "p",
          "text": "Un giocatore può archiviare una foto della propria carta d'identità o del passaporto, così che l'allenatore possa mostrarla a un arbitro prima di una partita. Viene cifrata sul dispositivo del giocatore prima del caricamento; solo il giocatore e gli allenatori e responsabili di squadra attuali delle sue squadre possono aprirla — non il club, non gli admin, non il server. Gestisci il tuo sotto **Il mio profilo** → **Modifica profilo** → **Documento d'identità** (telefono: **Altro**, poi la riga del tuo profilo)."
        },
        {
          "t": "h",
          "text": "La tua chiave di cifratura"
        },
        {
          "t": "p",
          "text": "La tua chiave viene creata in silenzio all'accesso. Un dispositivo che non l'ha mai avuta ti chiede la password una volta (**Crea la chiave** o **Sblocca**) e conserva la chiave finché non esci o premi **Dimentica la mia chiave su questo dispositivo**. Uscire cancella anche i documenti scaricati per una partita."
        },
        {
          "t": "note",
          "text": "Usa **Cambia password** sotto **Modifica profilo** — mantiene la tua chiave. Un link o un codice di reset la perde: i documenti condivisi con te non si aprono più e il tuo deve essere caricato di nuovo."
        },
        {
          "t": "h",
          "text": "Caricare un documento"
        },
        {
          "t": "ol",
          "items": [
            "Sblocca la tua chiave, premi **Carica documento** e scegli una foto o un PDF (max 8 MB).",
            "Per una foto, spostala, ingrandiscila e ruotala in **Regola il documento**, poi premi **Usa questa foto**.",
            "La sezione mostra poi la data di caricamento con **Mostra documento**, **Sostituisci** ed **Elimina**."
          ]
        },
        {
          "t": "h",
          "text": "Chi può aprire un documento"
        },
        {
          "t": "p",
          "text": "L'accesso viene fissato al momento del caricamento ai lettori che hanno già una chiave; chi crea una chiave in seguito non ha nulla finché l'accesso non viene ripristinato. Sotto **Strumenti membri** → **Squadre**, apri la squadra: la colonna **ID** mostra chi ha un documento e da quando. **Accesso ai documenti**, accanto a **Roster attuale**, apre **Chi può aprire questi documenti** — uno stato per membro dello staff e documento:"
        },
        {
          "t": "ul",
          "items": [
            "**Può aprire** — niente da fare.",
            "**Non si aprirà** — la sua chiave è cambiata dopo il caricamento.",
            "**Ancora nessuna chiave** — mai concesso; risolvibile dalla pagina della squadra.",
            "**Nessuna chiave d'identità creata** — deve prima creare una chiave; nessuno può risolverlo al posto suo.",
            "**Ex staff, ha ancora accesso** — conserva la chiave finché il giocatore non sostituisce o elimina il documento."
          ]
        },
        {
          "t": "h",
          "text": "Ripristinare l'accesso"
        },
        {
          "t": "p",
          "text": "Un banner sopra il roster indica i colleghi che non possono aprire i documenti. Premi **Ripristina l'accesso**: il tuo dispositivo trasmette la chiave per ogni documento che puoi aprire tu stesso. Non viene ricaricato nulla; nessuno al di fuori dello staff attuale dei giocatori ottiene l'accesso. La tua chiave deve essere sbloccata su questo dispositivo; altrimenti il banner dice **Sblocca la tua chiave d'identità nel profilo per ripristinare l'accesso**. Anche i giocatori possono colmare la lacuna da soli con **Concedi l'accesso** nel loro profilo."
        },
        {
          "t": "tip",
          "text": "Il giorno della partita, apri la partita e usa **Mostra i documenti d'identità** (da 45 minuti prima dell'inizio; vedi la sezione Referto di gara). Controlla **Accesso ai documenti** il giorno prima, non in palestra."
        }
      ]
    },
    "spielplanung": {
      "title": "Spielplanung",
      "summary": "Pianificare le partite della stagione con i club avversari: fasce, inviti, conferme, Volleymanager e la posta.",
      "body": [
        {
          "t": "p",
          "text": "La pianificazione delle partite è un'app separata: **Admin → Pianificazione & palestre → Pianificazione** su desktop (gli Spielplaner non admin vedono un pulsante **Pianificazione**) o **Altro → Pianificazione** sul telefono; il login Wiedisync resta valido. Admin pallavolo e Spielplaner di tutto il club trovano **Pannello**, **Posta**, **Impostazioni** e **Calendario partite manuali**; gli altri solo **Calendario partite manuali** (sola lettura per allenatori e responsabili di squadra)."
        },
        {
          "t": "h",
          "text": "Impostare una stagione"
        },
        {
          "t": "ol",
          "items": [
            "In **Impostazioni**, **Crea nuova stagione**, collega la stagione SVRZ e imposta la **Data di subentro del feed**.",
            "Definisci i **Sabati di gioco**, scegli le fonti delle fasce sotto **Configurazione squadra**, poi **Genera fasce di gioco**.",
            "Imposta **Distanza tra partite (giorni)** e **Collegamenti squadre** (solo admin pallavolo; squadre con giocatori o allenatori in comune), poi **Apri per prenotazione**.",
            "**Chiudi prenotazione** blocca i nuovi avversari, le prenotazioni restano. **Archivia stagione** si annulla con **Ripristina stagione**."
          ]
        },
        {
          "t": "h",
          "text": "Invitare gli avversari"
        },
        {
          "t": "p",
          "text": "Sotto **Gestisci inviti**, **Importa da SVRZ** recupera avversari e contatti; **Invia inviti** mostra ogni e-mail prima dell'invio. I link scadono il 30 giugno di fine stagione. L'avversario sceglie fino a tre fasce in casa e propone fino a tre date in trasferta; solo la prima scelta è riservata."
        },
        {
          "t": "h",
          "text": "Confermare le partite"
        },
        {
          "t": "p",
          "text": "Nel **Pannello**, espandi una squadra e apri le **Prenotazioni casa** o le **Proposte trasferta** di un avversario. **Conferma proposta** prenota la fascia, avvisa l'avversario per e-mail, ottimizza le palestre del sabato e trasmette la partita in casa a Volleymanager. **Inserisci manualmente una partita concordata** registra un accordo telefonico senza e-mail. **Avvisa gli allenatori** invia il calendario per e-mail e chiede conferma se restano accoppiamenti aperti."
        },
        {
          "t": "note",
          "text": "**Elimina partita** libera la fascia ma lascia la partita in Volleymanager: rimuovila lì a mano. Le partite diverse da Volleymanager vengono segnalate dopo la sincronizzazione notturna: **Reinvia a VM** o **Sincronizza con VM**."
        },
        {
          "t": "p",
          "text": "**Posta** è la casella condivisa spielplanung@volleyball.kscw.ch: **Controlla la posta** la sincronizza, le e-mail si abbinano da sole agli avversari, **Appartiene a** le assegna a mano; ogni conferma viene copiata qui."
        },
        {
          "t": "h",
          "text": "Basketball (ProBasket)"
        },
        {
          "t": "p",
          "text": "Sotto **Basketball**, il **Pianificatore** prepara la Spielplansitzung di ProBasket: **Inserisci partita** in una fascia KWI libera o **Aggiungi partita in trasferta**, poi **Esporta la squadra selezionata** o **Esporta le squadre automatiche** (Lions D1 e Herren 1). In **Impostazioni**, proponi le partite in casa sotto **Partite proposte agli avversari** e invia a ogni club un link sotto **Club avversari**; le date spuntate sono disponibilità, non prenotazioni."
        },
        {
          "t": "note",
          "text": "Le date sono bloccate da **Date bloccate (tutto il club)** in **Impostazioni** (solo superadmin), dai blocchi di squadra sotto **Assenze della squadra** (vedi la sezione Assenze e blocchi della squadra) e dalle chiusure delle palestre. Nel **Calendario partite manuali**, un giorno bloccato per il club (partite in casa), la stessa squadra due volte lo stesso giorno o una sovrapposizione di palestra bloccano il salvataggio; la stessa squadra entro due giorni dà solo un avviso."
        }
      ]
    },
    "hallenplanadmin": {
      "title": "Amministrazione del piano palestra",
      "summary": "Palestre, fasce settimanali, chiusure, la sincronizzazione con il calendario della gestione palestre e come le fasce diventano allenamenti.",
      "body": [
        {
          "t": "p",
          "text": "Gli admin gestiscono la griglia delle palestre che i membri vedono nel calendario. Apri **Admin → Pianificazione & palestre → Fasce palestra** (desktop) oppure **Altro → Admin → Pianificazione & palestre → Fasce palestra** (telefono) e attiva la **Modalità admin**: i pulsanti **Chiusure** e **Palestre** e la modifica delle fasce di qualsiasi squadra la richiedono."
        },
        {
          "t": "h",
          "text": "Palestre"
        },
        {
          "t": "p",
          "text": "**Gestisci palestre** elenca i luoghi a cui puntano fasce, allenamenti e partite in casa; una palestra deve esistere qui prima di assegnarvi una fascia. **Aggiungi palestra** chiede **Nome**, **Indirizzo**, **Campi**, un **Link mappa** e **Omologata** (approvata per le partite di campionato). Eliminando una palestra vedi in anteprima cosa sparisce con essa; l'operazione non si può annullare."
        },
        {
          "t": "h",
          "text": "Le fasce e gli allenamenti che generano"
        },
        {
          "t": "ol",
          "items": [
            "Clicca una cella vuota della griglia per **Nuova fascia** o una fascia esistente per **Modifica fascia**.",
            "Scegli **Palestra** (**KWI A+B** crea una fascia in ognuna delle due), **Squadra**, **Giorno della settimana**, **Tipo**, **Ora di inizio** e **Ora di fine**.",
            "Una fascia **Ricorrente** si ripete ogni settimana tra **Valido da** e **Valido fino a**, oppure **A tempo indeterminato**.",
            "Spunta **Slot di allenamento libero** per lasciare la fascia senza squadra, richiedibile da qualsiasi allenatore. **Sovrapposizione rilevata:** segnala altre fasce nella stessa palestra."
          ]
        },
        {
          "t": "note",
          "text": "Una fascia di tipo **Allenamento** è un modello: salvandola si creano gli allenamenti veri e propri, fino a **Valido fino a** oppure circa 12 settimane in avanti per una a tempo indeterminato, integrata ogni notte. Modificare la fascia sposta o accorcia i suoi allenamenti futuri; eliminarla elimina anche gli allenamenti con le iscrizioni. Gli allenamenti passati non vengono mai toccati."
        },
        {
          "t": "h",
          "text": "Chiusure"
        },
        {
          "t": "p",
          "text": "**Gestisci chiusure palestra** elenca i giorni in cui una palestra è chiusa. Una chiusura nasconde la palestra nel piano palestra, appare nel calendario e nel feed iCal, blocca le partite in casa lì e annulla gli allenamenti di quei giorni; se la elimini, gli allenamenti tornano attivi. **Aggiungi nuova chiusura** chiede una o più **Palestre** (preimpostazioni **KWI** e **Tutte le palestre**), **Da** e **A**, un **Motivo** e una **Fonte**."
        },
        {
          "t": "note",
          "text": "Usa **Admin** o **Custode** come fonte per una chiusura inserita a mano. **Google Calendar** e **Vacanze scolastiche** appartengono alle sincronizzazioni automatiche, che alla prossima esecuzione eliminano le righe manuali con queste fonti."
        },
        {
          "t": "h",
          "text": "Google Calendar ed eventi palestra"
        },
        {
          "t": "p",
          "text": "Ogni notte l'app si sincronizza con il calendario Google della gestione palestre KWI. Ogni loro voce diventa una chiusura delle palestre KWI (fonte **Google Calendar**) e compare sulla griglia come evento palestra; le nostre partite in casa al KWI vengono scritte nel loro calendario. Sotto **Calendario della gestione palestre**, segna una voce che non è una vera chiusura con **Nessuna chiusura** e gli allenamenti annullati tornano attivi; **Chiudi le palestre** conferma una chiusura reale. **Pubblica** invia una tua chiusura al loro calendario come prenotazione del KSCW; **Già presente** significa che la coprono già loro."
        },
        {
          "t": "tip",
          "text": "Le vacanze scolastiche della città di Zurigo vengono importate automaticamente come chiusure di tutte le palestre."
        }
      ]
    },
    "scorerassign": {
      "title": "Assegnare i servizi segnapunti",
      "summary": "Assegna automaticamente le squadre di servizio alle partite in casa, correggile a mano e controlla chi si è iscritto.",
      "body": [
        {
          "t": "p",
          "text": "Apri **Admin → Operazioni di gara → Assegnazione refertisti** (desktop) o **Altro → Admin → Operazioni di gara → Assegnazione refertisti** (telefono); serve l'accesso admin pallavolo o pallacanestro. La pagina copre la **Stagione** in corso: in **Assegnazione** pianifichi, **Panoramica** mostra ciò che è salvato sulle partite."
        },
        {
          "t": "h",
          "text": "Eseguire l'assegnazione automatica"
        },
        {
          "t": "ol",
          "items": [
            "Tocca **Esegui algoritmo**: compare una bozza con una riga per partita in casa e una colonna **Note** con conflitti e posti liberi.",
            "Correggi le righe con **Seleziona squadra** e **Seleziona persona** per ogni incarico. Le righe rosse non hanno squadra; le partite di coppa sono **Di picchetto** e non ricevono nessuno, salvo tua scelta.",
            "Tocca **Distribuisci** per scrivere squadre di servizio e persone sulle partite. Solo allora sono ufficiali e visibili in **Servizio segnapunti**."
          ]
        },
        {
          "t": "ul",
          "items": [
            "Nella pallavolo gli incarichi dipendono dal livello della squadra che gioca (Segnapunti/Tabellone combinato, segnapunti separato con licenza più tabellone, oppure solo arbitro per HU20); nella pallacanestro c'è una squadra di servizio per partita.",
            "Le regole rigide escludono una squadra (partita propria alla stessa ora, un servizio lo stesso giorno, nessun membro con la licenza); le regole flessibili danno punti alle altre partendo da 100. **Regole dell'algoritmo** mostra i valori.",
            "Le partite già assegnate mostrano **Assegnazione esistente mantenuta** e restano invariate finché non le modifichi."
          ]
        },
        {
          "t": "note",
          "text": "La bozza vive solo nel tuo browser (**Bozza salvata**); nessun altro la vede finché non distribuisci. **Ricalcola** la ricostruisce dalle partite salvate e scarta le modifiche non salvate. Distribuire una nuova squadra di servizio rimuove una persona iscritta che non ne fa parte."
        },
        {
          "t": "h",
          "text": "Riepilogo squadre e crediti"
        },
        {
          "t": "p",
          "text": "**Riepilogo squadre** mostra per squadra le **Partite**, i servizi per ruolo e il **Totale**. **Arbitri** conta le licenze da arbitro come servizi già svolti (massimo 2). Un **Credito** esonera una squadra da alcuni servizi; si salva subito, ma va rieseguito l'algoritmo perché conti."
        },
        {
          "t": "tip",
          "text": "**Scarica Excel** esporta la bozza e il riepilogo squadre. Modifica le colonne delle squadre e con **Carica corretto** le riapplichi, abbinate tramite **N. partita**."
        },
        {
          "t": "h",
          "text": "Dopo la distribuzione: controlli e modifiche manuali"
        },
        {
          "t": "p",
          "text": "La scheda **Panoramica** elenca ogni posto di servizio salvato con **Iscritto** e **Stato**; filtra con **Mostra solo i posti liberi** o **Includi le partite passate**. Per cambiare un incarico in seguito, apri **Strumenti membri → Servizio segnapunti** con la **Modalità admin** attiva: ogni scheda di partita in casa offre **Seleziona squadra** e **Seleziona persona**, e **Confermato da** mostra chi l'ha preso e quando. Sono elencati solo i membri attivi idonei, e la modifica si blocca all'inizio della partita."
        },
        {
          "t": "h",
          "text": "La formazione del segnapunti e l'Einsatzliste"
        },
        {
          "t": "p",
          "text": "Poco prima dell'inizio, il segnapunti assegnato vede un pulsante **Formazione**: il referto di gara salvato dall'allenatore, altrimenti l'Einsatzliste depositata in Volleymanager, altrimenti i giocatori confermati. Le squadre di pallavolo possono depositarla automaticamente circa un'ora prima dell'inizio: **Invia automaticamente l'Einsatzliste** sotto **Impostazioni partita predefinite** nell'editor della formazione, modificabile per singola partita con **Einsatzliste automatica**. Vedi le sezioni Referto di gara ed Editor del roster."
        }
      ]
    },
    "registrations": {
      "title": "Iscrizioni",
      "summary": "Come esaminare le nuove iscrizioni al club: controllo dati, documenti, approvazione, inviti e collegamento a ClubDesk.",
      "body": [
        {
          "t": "p",
          "text": "Le nuove iscrizioni arrivano dal modulo del sito kscw.ch. Apri **Admin → Membri & comunicazione → Iscrizioni** (telefono: **Altro → Admin → Membri & comunicazione → Iscrizioni**). Ricevi anche un'e-mail per ogni iscrizione; la disattivi con **Nuove iscrizioni** sotto **Notifiche e-mail** nel profilo. L'elenco è raggruppato in **Volleyball**, **Basketball** e **Passivo**; il filtro di stato mostra **In sospeso** di default, oppure **Approvata**, **Rifiutata** e **Tutti gli stati**. Gli admin di sport vedono solo il proprio sport, gli admin globali tutto."
        },
        {
          "t": "h",
          "text": "Esaminare un'iscrizione"
        },
        {
          "t": "ol",
          "items": [
            "Tocca **Mostra dettagli**, correggi gli errori, poi **Salva**.",
            "Guarda il badge dei duplicati: **Già membro**, **Ex membro** o **Possibile duplicato**. **Controlla e unisci** confronta i due record campo per campo; **Unisci N campo/i** collega l'iscrizione a quel membro senza approvarla.",
            "Controlla **Squadra**: all'approvazione la persona entra nel roster di ogni squadra attiva indicata lì (una squadra corrispondente appare come chip). Il ruolo di allenatore o responsabile non viene mai assegnato da solo: usa poi l'editor del roster.",
            "**Approva** o **Rifiuta**. Per rifiutare serve un **Motivo**, che la persona riceve via e-mail."
          ]
        },
        {
          "t": "note",
          "text": "Approvare una riga segnalata senza prima unirla crea un secondo record membro. Unisci, poi approva o rifiuta."
        },
        {
          "t": "h",
          "text": "Cosa fa l'approvazione"
        },
        {
          "t": "p",
          "text": "L'approvazione crea o collega il record membro, invia alla persona un'e-mail con un link monouso per creare l'account (allenatori e responsabili della squadra in copia) e avvisa gli admin dello sport. Il contatto ClubDesk nasce al prossimo **Sync up**: non crearlo a mano. **Reinvia invito** su una riga approvata manda un nuovo invito."
        },
        {
          "t": "h",
          "text": "Documenti per la pallacanestro"
        },
        {
          "t": "p",
          "text": "Le iscrizioni di pallacanestro devono avere i documenti prima che **Approva** funzioni: sempre **Documento d'identità (fronte)**, **Documento d'identità (retro)** e **Domanda di licenza**; secondo **Situazione licenza**, nazionalità ed età anche **Lettera di svincolo (Freibrief)**, **Self declaration**, **National team decl.** e **Consenso dei genitori (U18)**. **Certificato scolastico (facoltativo)** non è mai obbligatorio. Pallavolo e passivi non hanno blocchi sui documenti."
        },
        {
          "t": "ul",
          "items": [
            "**Carica** o **Sostituisci** tu stesso un file: JPG, PNG, WebP o PDF, max 10 MB.",
            "**Richiedi documenti** invia alla persona un'e-mail con un link per ricaricarli (anche su righe approvate; lo stato non cambia). Spunta più righe e usa **Richiedi documenti** nella barra di selezione per un invio multiplo. Il testo si modifica sotto **Admin → E-mail del club → Modelli e-mail**; la scheda **Inviate** archivia ogni e-mail inviata da un modello.",
            "**Approva comunque**: indica un motivo, poi **Esonera e approva**. L'esonero riporta il tuo nome e viene mostrato come **Documenti esonerati**."
          ]
        },
        {
          "t": "h",
          "text": "Dopo l'approvazione"
        },
        {
          "t": "ul",
          "items": [
            "**Stato della licenza**: imposta **Nessuna licenza**, **Da ordinare**, **Ordinata**, **Finalizzata** o **Licenziata**; il membro viene avvisato. **Licenziata** arriva di norma dalla sincronizzazione Swiss Volley / Basketplan.",
            "**Sync ClubDesk** (solo admin globali): **In ClubDesk**, **Trovato in ClubDesk ma non ancora collegato** (usa **Collega**) o **Non in ClubDesk** (usa **Sincronizza verso ClubDesk**).",
            "**CSV per ClubDesk** scarica le righe spuntate nel formato colonne di ClubDesk."
          ]
        }
      ]
    },
    "announcements": {
      "title": "Comunicazione del club",
      "summary": "Pubblicare notizie del club, scrivere a gruppi di membri con campi personalizzati e la posta condivisa del club.",
      "body": [
        {
          "t": "p",
          "text": "Le notizie del club raggiungono i membri nell'app (Notizie, campanella) e, se vuoi, via push o e-mail. **Scrivere a un gruppo** invia e-mail di massa personalizzate dalla posta del club."
        },
        {
          "t": "h",
          "text": "Notizie del club"
        },
        {
          "t": "p",
          "text": "Apri **Admin → Membri & comunicazione → Annunci** (telefono: **Altro → Admin → Membri & comunicazione → Annunci**), poi **Nuovo post**."
        },
        {
          "t": "ul",
          "items": [
            "Scrivi **Titolo** e testo per ogni scheda di lingua. Il tedesco è obbligatorio; i membri leggono nella lingua della loro app, altrimenti in tedesco.",
            "Aggiungi un'**Immagine di copertina** (PNG, JPEG o WebP, max 5 MB) e un **Link (opzionale)** che inizia con https:// o /.",
            "**Destinatari**: **Tutti i membri** (ogni membro attivo dell'app), **Uno sport**, **Squadre specifiche** (giocatori, allenatori, responsabili, capitani) o **Ruoli e funzioni**. Gli admin di sport scelgono solo il proprio sport o le sue squadre.",
            "**Fissa in alto nella scheda Notizie** tiene il post in cima; dopo la **Data di scadenza (opzionale)** sparisce dal feed.",
            "Spunta **Pubblica (visibile subito)** per metterlo online; solo allora puoi spuntare **Invia notifica push** e **Invia email**, con **Layout e-mail** (**Standard** o **Newsletter**) e un **Indirizzo di risposta** (vuoto significa no-reply)."
          ]
        },
        {
          "t": "note",
          "text": "La pubblicazione invia una sola volta: ogni destinatario riceve una voce nella campanella, push ed e-mail solo se spuntate. Le modifiche non reinviano; l'eliminazione è irreversibile. L'e-mail salta chi ha disattivato **Notizie del club** sotto **Notifiche e-mail** nel profilo e gli indirizzi con rimbalzo."
        },
        {
          "t": "h",
          "text": "Posta del club"
        },
        {
          "t": "p",
          "text": "**Admin → E-mail del club → Posta del club** è la casella condivisa, riservata ad admin e superutente. Leggi **In arrivo** e **Inviati**, **Controlla la posta** e usa **Nuova e-mail**, **Rispondi**, **Rispondi a tutti** o **Inoltra**; la **Firma** del club si aggiunge da sola. Un'e-mail normale (**A** più **Cc**) è una copia condivisa con al massimo 50 indirizzi; per elenchi più grandi serve **Scrivere a un gruppo**."
        },
        {
          "t": "h",
          "text": "Scrivere a un gruppo"
        },
        {
          "t": "ol",
          "items": [
            "Premi **Scrivere a un gruppo** e scegli i gruppi sotto **Adesione**, **Sezioni**, **Giocatori**, **Ruoli e funzioni**, **Squadre** o **Ex membri**, se vuoi limitati per **Stagione**. **Mostra le persone singolarmente** apre un gruppo per togliere persone; **Incolla un elenco di indirizzi** ne aggiunge.",
            "L'anteprima mostra quanti ricevono l'e-mail e quanti vengono saltati (nessun indirizzo, disattivazione, indirizzo condiviso, rimbalzo).",
            "Scrivi oggetto e messaggio. `{{vorname}}` e `{{nachname}}` (o `{{first_name}}`, `{{last_name}}`) diventano il nome di ogni destinatario; funzionano anche `{{name}}`, `{{email}}`, `{{beitragskategorie}}`, `{{mitgliederbeitrag}}` e `{{team}}`. I campi sconosciuti vengono barrati e inviati così.",
            "Premi **Vedi il messaggio** per vederlo come tre destinatari reali, poi **Invia a** e conferma."
          ]
        },
        {
          "t": "note",
          "text": "Ogni destinatario riceve la propria copia, nessuno vede gli altri indirizzi e l'invio non si annulla. **Cc** e **Ccn** ricevono una copia condivisa (max 50 indirizzi). **Membri** significa tutto il registro del club, non solo chi usa l'app. I membri si disiscrivono con **Notizie del club** nel profilo; le e-mail di gruppo hanno anche un'intestazione di disiscrizione, gestita a mano."
        }
      ]
    },
    "clubfinance": {
      "title": "Finanze del club",
      "summary": "Tornate quote, fatture, solleciti, contabilità, budget, membri, spese e pagamenti per finanze e comitato.",
      "body": [
        {
          "t": "p",
          "text": "**Finanze del club**, sotto **Finanze → Finanze del club** (sul telefono prima **Altro**), è per il ruolo finanze e il comitato. Scegli prima l'**Esercizio**."
        },
        {
          "t": "h",
          "text": "Fatturazione"
        },
        {
          "t": "ul",
          "items": [
            "**Tornata quote**: imposta le **Tariffe delle quote** per categoria, spunta le categorie, scegli una **Scadenza**, **Anteprima**, poi **Emetti … fatture**. Ogni membro riceve una fattura QR; allenatori, comitato e onorari una di CHF 0.00 con l'esenzione. Le tornate passate offrono **Scarica le fatture**, **E-mail** e **Annulla tornata**.",
            "**Fatture**: le fatture della stagione, native e copiate da ClubDesk. **Nuova fattura** fattura a un membro, una squadra o un contatto esterno. Per riga: **Conferma** un pagamento, **Pagamenti** (parziali, note di credito, rimborsi, stralci), **Annulla** o **Collega a un membro**. **Riconciliazione bancaria (camt)** conferma le fatture da un export bancario.",
            "**Solleciti**: fatture Wiedisync scadute. Invia i solleciti 1–3 in ordine, se vuoi con **Spese di sollecito (CHF)** e un'e-mail; **Mai sollecitare** esclude un membro. Niente è automatico."
          ]
        },
        {
          "t": "note",
          "text": "L'emissione non invia mai e-mail: usa **E-mail** sulla tornata. L'invio parte in modalità test: tutto va al destinatario di test finché non clicchi **Disattiva (passa al live)** e digiti il numero di membri. **Annulla tornata** annulla le fatture ancora aperte; quelle pagate restano."
        },
        {
          "t": "h",
          "text": "Contabilità e rapporti"
        },
        {
          "t": "ul",
          "items": [
            "**Panoramica**, **Conto economico**, **Bilancio** e **Conti** rispecchiano la contabilità ClubDesk, aggiornata ogni notte alle 04:00 o con **Sincronizza ora**; **Esporta** produce PDF, Excel o PowerPoint.",
            "**Budget**: budget e consuntivo per conto; si salva da solo.",
            "**Contabilità**: la partita doppia di Wiedisync — **Giornale**, **Conti**, **Bilancio di verifica**, **Chiusura d'esercizio**, **Registrazione automatica**. Associa i conti di controllo, poi attiva **Crea le registrazioni automaticamente**."
          ]
        },
        {
          "t": "h",
          "text": "Anagrafiche"
        },
        {
          "t": "ul",
          "items": [
            "**Membri**: IBAN, categoria, contatti e fatture per membro; **Fatturare a un altro contatto** per minorenni o aziende, **Allega PDF**, oppure **Mostra QR di pagamento** e **Salva e scarica** per rimborsare a mano. Modifica solo il ruolo finanze (o un admin in modalità admin).",
            "**Squadre**: sponsoring, entrate e uscite per squadra con **Aggiungi voce**, più il **Rimborso arbitri** di fine stagione: **Anteprima**, poi **Crea pagamenti**, uno per membro. Senza IBAN svizzero o del Liechtenstein, o senza NPA e località: saltato ed elencato.",
            "**Spese**: ricevute caricate dai membri. Imposta **Pagata** o **Respinta**: il membro viene avvisato in app, push ed e-mail con la tua **Nota al membro**; **Pagata** crea anche il pagamento. La **Nota interna** resta nascosta."
          ]
        },
        {
          "t": "p",
          "text": "**Conferma spese** (**Finanze → Finanze del club**) permette ad admin di sezione e finanze di confermare che un rimborso è a budget e spuntare **La sezione ha già rimborsato il membro**; non cambia lo stato del membro. **Spese arbitrali** (**Admin → Operazioni di gara**) elenca le tasse arbitrali per squadra di pallavolo e stagione, con **Export CSV**."
        },
        {
          "t": "note",
          "text": "Un esercizio chiuso rifiuta ogni modifica (conferme, annullamenti, voci di squadra, tornata arbitri): correggi in uno aperto. Ogni modifica viene registrata a tuo nome. Lato membri: vedi le sezioni Fatture e rimborsi e Finanze della squadra."
        }
      ]
    },
    "explorer": {
      "title": "Banca dati e workspace SQL",
      "summary": "Consulta, filtra e modifica i dati dei membri nella Banca dati ed esegui query nel Workspace SQL.",
      "body": [
        {
          "t": "p",
          "text": "**Banca dati** è la vista admin di ogni membro, squadra, evento, allenamento e partita. La apri da **Admin → Dati & analisi → Banca dati** (desktop) o **Altro → Admin → Dati & analisi → Banca dati** (telefono). Gli admin di sport vedono il proprio sport; gli admin del club tutto."
        },
        {
          "t": "h",
          "text": "Trovare le persone"
        },
        {
          "t": "ul",
          "items": [
            "**Cerca in tutto…** cerca in tutte le categorie insieme.",
            "**Filtri** restringe i membri per sport, genere, posizioni, licenze, ruoli, stato di affiliazione, quote pagate e altro. Di default compaiono solo i membri con **Iscrizione KSCW attiva**; cambia quel filtro per vedere ex membri o passivi.",
            "**Dato** seleziona uno o più campi: il dettaglio mostra solo quelli, la tabella li aggiunge come colonne; **Mostra tutti i campi** annulla la selezione.",
            "Passa da **Albero** a **Tabella** con il selettore **Vista**. La tabella offre **Colonne**, **Raggruppa per** ed **Esporta** in **Excel (.xlsx)** o **PDF**, sempre con intestazioni in inglese."
          ]
        },
        {
          "t": "h",
          "text": "Modificare i membri"
        },
        {
          "t": "p",
          "text": "Apri un membro dall’albero o con **Apri i dettagli** nella tabella. **Tutti i campi** elenca ogni colonna per argomento; le colonne vuote e tecniche restano nascoste finché non premi **Mostra i campi vuoti** o **Mostra i campi tecnici**. Premi **Modifica**, cambia ciò che serve e **Salva**. Ogni salvataggio scrive solo i campi modificati e finisce nell’audit log. Ruoli e diritti Spielplaner li cambia solo un admin del club. Un campo **Sovrascritto dalla sincronizzazione** è modificabile, ma la prossima sincronizzazione sostituisce il tuo valore."
        },
        {
          "t": "p",
          "text": "Per molti membri, spunta le righe nella tabella e scegli **Bulk edit**. Usa **Set value**, **Clear**, **Add** o **Remove** e applica a tutti i selezionati; chi ha già quel valore viene saltato. **Mark as departed** termina l’affiliazione di tutti i selezionati con un unico stato e un’unica data di uscita."
        },
        {
          "t": "note",
          "text": "Le modifiche in blocco non si annullano. Leggi l’anteprima di quanti membri cambieranno prima di applicare."
        },
        {
          "t": "h",
          "text": "Zona pericolosa"
        },
        {
          "t": "p",
          "text": "In fondo al dettaglio di un membro, **Zona pericolosa** attiva o disattiva subito **Affiliazione al club** e **Accesso all’app**. Quando qualcuno lascia il club, usa **Member left**: imposta stato nel registro e data di uscita, disattiva affiliazione e accesso e rimuove la persona dai roster di questa stagione. **Elimina definitivamente** mostra prima ogni record dipendente e chiede di digitare DELETE. Il contatto ClubDesk non viene mai eliminato."
        },
        {
          "t": "note",
          "text": "Disattivare **Affiliazione al club** non è un’uscita: nessuna data di uscita e nulla arriva a ClubDesk. Usa invece **Member left**."
        },
        {
          "t": "h",
          "text": "Workspace SQL (superadmin)"
        },
        {
          "t": "p",
          "text": "**Admin → Superadmin → Workspace SQL** esegue query in sola lettura; premi **Esegui** o Ctrl/Cmd-Invio. I risultati sono limitati a 1000 righe e si esportano in **CSV** o **Excel**. Le ultime 20 query restano in **Recenti** (solo in questo browser). **Chiedi all'IA** trasforma una richiesta in linguaggio naturale in SQL e tiene le domande recenti in **Memoria**, così la domanda successiva affina la stessa query. Attiva **Modalità scrittura** solo per modificare i dati. Ogni esecuzione viene registrata con l’SQL e il tuo nome."
        }
      ]
    },
    "admintools": {
      "title": "Strumenti admin",
      "summary": "Dove si trova ogni pagina admin, a cosa serve e come la modalità admin cambia ciò che vedi.",
      "body": [
        {
          "t": "p",
          "text": "Le pagine admin stanno sotto **Admin** nella barra del desktop o **Altro → Admin** sul telefono. **Tutti gli strumenti admin** elenca, con ricerca, le pagine che puoi aprire, con **Sezione** e **Accesso** (**Admin**, **Admin del club** o **Superadmin**)."
        },
        {
          "t": "h",
          "text": "Modalità admin"
        },
        {
          "t": "p",
          "text": "La **Modalità admin** sotto **Options** cambia la portata dei dati, non il menu: attiva, tutte le squadre compaiono in calendario, partite, allenamenti, eventi e assenze e gli admin di sport hanno i poteri di allenatore sulle pagine delle squadre; disattivata, vedi ciò che vede un membro. Le pagine admin si aprono in entrambe. Interruttore, banner dorato e variante per il comitato: vedi la sezione Orientarsi nell'app."
        },
        {
          "t": "h",
          "text": "Le pagine admin"
        },
        {
          "t": "ul",
          "items": [
            "**Pianificazione & palestre**: **Pianificazione** (vedi la sezione Spielplanung), **Fasce palestra** con palestre e chiusure (vedi la sezione Amministrazione del piano palestra) e **Trova palestre**.",
            "**Operazioni di gara**: **Assegnazione refertisti** (vedi la sezione Assegnare i servizi segnapunti); **Arbitri pallavolo** associa gli arbitri alle squadre coperte (la sincronizzazione settimanale riaggiunge chi ha la licenza); **Spese arbitrali** (sola lettura).",
            "**Membri & comunicazione**: **Iscrizioni** e **Annunci** (vedi le sezioni Iscrizioni e Comunicazione del club); **Trasferimenti** internazionali (**Verifica VIS adesso** interroga la FIVB); **Feedback volley**.",
            "**E-mail del club**: **Posta del club** (solo admin del club), **Modelli e-mail**, **Garage delle e-mail** con caselle e password del club.",
            "**Dati & analisi**: **Banca dati** (vedi la sezione Banca dati e workspace SQL) e **Statistiche**."
          ]
        },
        {
          "t": "h",
          "text": "Strumenti superadmin"
        },
        {
          "t": "ul",
          "items": [
            "**Infrastruttura**: stato di servizi, sincronizzazioni e job pianificati; **Esegui ora** avvia subito una sincronizzazione.",
            "**Qualità dei dati**: la scheda **ClubDesk sync** segue il percorso guidato (da **1. Sync down** a **5. Fix groups**) con **Do the next step**; per ogni differenza decidi se vince **ClubDesk** o **Wiedisync**. **Tutto il club** controlla partite, membri, quote e licenze segnapunti, con **Correggi tutto**.",
            "**Nuclei familiari** (vedi la sezione Nuclei familiari e account famiglia).",
            "**Audit log**: modifiche, accessi ed eventi di sistema degli ultimi 90 giorni.",
            "**Log degli errori**: errori in tempo reale di app e sito, con **Archivia**, **Importante** e **Silenzia tutti quelli di questo tipo**.",
            "**Workspace SQL** (vedi la sezione Banca dati e workspace SQL) e **Bugfixes**: **Correggi** avvia una correzione automatica, **Distribuire su Dev** e **Distribuire su Prod** la pubblicano; le correzioni compaiono poi in **Options → Stato**."
          ]
        },
        {
          "t": "h",
          "text": "Ruoli, licenze e squadre"
        },
        {
          "t": "p",
          "text": "Ruoli e flag di Spielplaner per tutto il club si impostano sul membro in **Banca dati** sotto **Roles & access**, solo dagli admin del club. Lì si modifica anche lo stato della licenza; **Licenziata** arriva di norma dalla sincronizzazione Swiss Volley / Basketplan, che non declassa mai. Le squadre non si creano nell'app; lo staff si aggiunge con **Gestisci lo staff** sulla pagina della squadra in modalità admin (vedi la sezione Editor del roster)."
        },
        {
          "t": "note",
          "text": "Azioni della zona pericolosa, visualizzazione delle password, **Visualizza come questo membro** ed esecuzioni SQL finiscono nell'**Audit log** a tuo nome. Modifiche in blocco, **Member left** ed eliminazioni non si annullano."
        }
      ]
    }
  }
}
