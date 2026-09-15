// Page chrome of the written in-app guide (eager, small). The section text
// lives in guide-content.ts next to this file and is loaded on demand by
// GuidePage — keep it out of here so the boot bundle stays small.
export default {
  "page": {
    "title": "Guida",
    "subtitle": "Come funziona Wiedisync, pagina per pagina",
    "searchPlaceholder": "Cerca nella guida",
    "clearSearch": "Cancella ricerca",
    "contents": "Indice",
    "noResults": "Nessun risultato per «{{query}}».",
    "backToTop": "Torna su",
    "openSection": "Link a questa sezione",
    "helpButton": "Apri la guida di questa pagina",
    "groups": {
      "basics": "Basi",
      "everyday": "Quotidiano",
      "finance": "Soldi",
      "teams": "Squadre & coaching",
      "admin": "Admin & pianificazione"
    },
    "audience": {
      "everyone": "Tutti",
      "coach": "Coach & responsabili di squadra",
      "captain": "Capitani & coach",
      "spielplaner": "Pianificatori",
      "finance": "Finanze",
      "vorstand": "Comitato",
      "admin": "Admin"
    },
    "loading": "Caricamento della guida…",
    "openGuide": "Apri la guida completa",
    "openPage": "Vai a questa pagina",
    "matchOne": "1 risultato",
    "matchMany": "{{count}} risultati",
    "linkCopied": "Link copiato",
    "loadError": "Impossibile caricare la guida. Controlla la connessione e riprova."
  },
  "start": {
    "title": "I tuoi punti di partenza",
    "rolesTitle": "Sei",
    "checklistTitle": "Primi passi",
    "progress": "{{done}} di {{total}} fatti",
    "roles": {
      "player": "Giocatore/trice in {{teams}}",
      "coach": "Coach di {{teams}}",
      "tr": "Responsabile di squadra",
      "captain": "Capitano",
      "spielplaner": "Pianificatore",
      "finance": "Finanze",
      "vorstand": "Comitato",
      "admin": "Admin",
      "superadmin": "Superadmin",
      "member": "Membro"
    },
    "items": {
      "install": "Aggiungi l’app alla schermata Home",
      "installDesktop": "Su un telefono",
      "push": "Attiva le notifiche push",
      "pushUnsupported": "Non supportato da questo browser",
      "pushDenied": "Bloccato nelle impostazioni del browser",
      "profile": "Completa il tuo profilo",
      "photo": "Aggiungi una foto profilo",
      "iban": "Inserisci e conferma il tuo IBAN"
    },
    "actions": {
      "showHow": "Mostrami come",
      "turnOn": "Attiva",
      "open": "Apri"
    }
  }
}
