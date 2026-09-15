// Page chrome of the written in-app guide (eager, small). The section text
// lives in guide-content.ts next to this file and is loaded on demand by
// GuidePage — keep it out of here so the boot bundle stays small.
export default {
  "page": {
    "title": "Anleitung",
    "subtitle": "So funktioniert Wiedisync, Seite für Seite",
    "searchPlaceholder": "Anleitung durchsuchen",
    "clearSearch": "Suche löschen",
    "contents": "Inhalt",
    "noResults": "Nichts gefunden für «{{query}}».",
    "backToTop": "Nach oben",
    "openSection": "Link zu diesem Abschnitt",
    "helpButton": "Anleitung zu dieser Seite öffnen",
    "groups": {
      "basics": "Grundlagen",
      "everyday": "Alltag",
      "finance": "Geld",
      "teams": "Teams & Coaching",
      "admin": "Admin & Planung"
    },
    "audience": {
      "everyone": "Alle",
      "coach": "Coaches & Teamverantwortliche",
      "captain": "Captains & Coaches",
      "spielplaner": "Spielplaner",
      "finance": "Finanzen",
      "vorstand": "Vorstand",
      "admin": "Admins"
    },
    "loading": "Anleitung wird geladen…",
    "openGuide": "Ganze Anleitung öffnen",
    "openPage": "Zu dieser Seite",
    "matchOne": "1 Treffer",
    "matchMany": "{{count}} Treffer",
    "linkCopied": "Link kopiert",
    "loadError": "Die Anleitung konnte nicht geladen werden. Prüfe deine Verbindung und versuch es nochmals."
  },
  "start": {
    "title": "Deine Startpunkte",
    "rolesTitle": "Du bist",
    "checklistTitle": "Erste Schritte",
    "progress": "{{done}} von {{total}} erledigt",
    "roles": {
      "player": "Spieler/in in {{teams}}",
      "coach": "Coach von {{teams}}",
      "tr": "Teamverantwortliche/r",
      "captain": "Captain",
      "spielplaner": "Spielplaner",
      "finance": "Finanzen",
      "vorstand": "Vorstand",
      "admin": "Admin",
      "superadmin": "Superadmin",
      "member": "Mitglied"
    },
    "items": {
      "install": "App auf den Homescreen legen",
      "installDesktop": "Auf dem Handy",
      "push": "Push-Benachrichtigungen einschalten",
      "pushUnsupported": "In diesem Browser nicht möglich",
      "pushDenied": "In den Browser-Einstellungen blockiert",
      "profile": "Profil vervollständigen",
      "photo": "Profilfoto hinzufügen",
      "iban": "IBAN eintragen und bestätigen"
    },
    "actions": {
      "showHow": "Zeig mir wie",
      "turnOn": "Einschalten",
      "open": "Öffnen"
    }
  }
}
