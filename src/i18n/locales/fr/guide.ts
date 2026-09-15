// Page chrome of the written in-app guide (eager, small). The section text
// lives in guide-content.ts next to this file and is loaded on demand by
// GuidePage — keep it out of here so the boot bundle stays small.
export default {
  "page": {
    "title": "Guide",
    "subtitle": "Comment fonctionne Wiedisync, page par page",
    "searchPlaceholder": "Rechercher dans le guide",
    "clearSearch": "Effacer la recherche",
    "contents": "Sommaire",
    "noResults": "Aucun résultat pour « {{query}} ».",
    "backToTop": "Haut de page",
    "openSection": "Lien vers cette section",
    "helpButton": "Ouvrir le guide de cette page",
    "groups": {
      "basics": "Bases",
      "everyday": "Au quotidien",
      "finance": "Argent",
      "teams": "Equipes & coaching",
      "admin": "Admin & planification"
    },
    "audience": {
      "everyone": "Tout le monde",
      "coach": "Coachs & responsables d’équipe",
      "captain": "Capitaines & coachs",
      "spielplaner": "Planificateurs",
      "finance": "Finances",
      "vorstand": "Comité",
      "admin": "Admins"
    },
    "loading": "Chargement du guide…",
    "openGuide": "Ouvrir le guide complet",
    "openPage": "Aller à cette page",
    "matchOne": "1 résultat",
    "matchMany": "{{count}} résultats",
    "linkCopied": "Lien copié",
    "loadError": "Le guide n’a pas pu être chargé. Vérifiez votre connexion et réessayez."
  },
  "start": {
    "title": "Vos points de départ",
    "rolesTitle": "Vous êtes",
    "checklistTitle": "Premiers pas",
    "progress": "{{done}} sur {{total}} faits",
    "roles": {
      "player": "Joueur/euse dans {{teams}}",
      "coach": "Coach de {{teams}}",
      "tr": "Responsable d’équipe",
      "captain": "Capitaine",
      "spielplaner": "Planificateur",
      "finance": "Finances",
      "vorstand": "Comité",
      "admin": "Admin",
      "superadmin": "Superadmin",
      "member": "Membre"
    },
    "items": {
      "install": "Ajouter l’app à l’écran d’accueil",
      "installDesktop": "Sur un téléphone",
      "push": "Activer les notifications push",
      "pushUnsupported": "Non pris en charge par ce navigateur",
      "pushDenied": "Bloqué dans les réglages du navigateur",
      "profile": "Compléter votre profil",
      "photo": "Ajouter une photo de profil",
      "iban": "Saisir et confirmer votre IBAN"
    },
    "actions": {
      "showHow": "Voir comment",
      "turnOn": "Activer",
      "open": "Ouvrir"
    }
  }
}
