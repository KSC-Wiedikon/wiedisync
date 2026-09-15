// Page chrome of the written in-app guide (eager, small). The section text
// lives in guide-content.ts next to this file and is loaded on demand by
// GuidePage — keep it out of here so the boot bundle stays small.
export default {
  "page": {
    "title": "Guide",
    "subtitle": "How Wiedisync works, page by page",
    "searchPlaceholder": "Search the guide",
    "clearSearch": "Clear search",
    "contents": "Contents",
    "noResults": "Nothing found for \"{{query}}\".",
    "backToTop": "Back to top",
    "openSection": "Link to this section",
    "helpButton": "Open the guide for this page",
    "groups": {
      "basics": "Basics",
      "everyday": "Everyday",
      "finance": "Money",
      "teams": "Teams & coaching",
      "admin": "Admin & scheduling"
    },
    "audience": {
      "everyone": "Everyone",
      "coach": "Coaches & team responsibles",
      "captain": "Captains & coaches",
      "spielplaner": "Spielplaner",
      "finance": "Finance",
      "vorstand": "Board",
      "admin": "Admins"
    },
    "loading": "Loading the guide…",
    "openGuide": "Open the full guide",
    "openPage": "Go to this page",
    "matchOne": "1 match",
    "matchMany": "{{count}} matches",
    "linkCopied": "Link copied",
    "loadError": "The guide could not be loaded. Check your connection and try again."
  },
  "start": {
    "title": "Your starting points",
    "rolesTitle": "You are",
    "checklistTitle": "Getting started",
    "progress": "{{done}} of {{total}} done",
    "roles": {
      "player": "Player in {{teams}}",
      "coach": "Coach of {{teams}}",
      "tr": "Team responsible",
      "captain": "Captain",
      "spielplaner": "Spielplaner",
      "finance": "Finance",
      "vorstand": "Board",
      "admin": "Admin",
      "superadmin": "Superadmin",
      "member": "Member"
    },
    "items": {
      "install": "Add the app to your home screen",
      "installDesktop": "On a phone",
      "push": "Turn on push notifications",
      "pushUnsupported": "Not supported in this browser",
      "pushDenied": "Blocked in your browser settings",
      "profile": "Complete your profile",
      "photo": "Add a profile photo",
      "iban": "Enter and confirm your IBAN"
    },
    "actions": {
      "showHow": "Show me how",
      "turnOn": "Turn on",
      "open": "Open"
    }
  }
}
