import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import common from './locales/en/common'
import nav from './locales/en/nav'
import jsExport from './locales/en/jsExport'
import calendar from './locales/en/calendar'
import games from './locales/en/games'
import trainings from './locales/en/trainings'
import absences from './locales/en/absences'
import scorer from './locales/en/scorer'
import teams from './locales/en/teams'
import hallenplan from './locales/en/hallenplan'
import spielplanung from './locales/en/spielplanung'
import auth from './locales/en/auth'
import events from './locales/en/events'
import home from './locales/en/home'
import legal from './locales/en/legal'
import admin from './locales/en/admin'
import participation from './locales/en/participation'
import notifications from './locales/en/notifications'
import gameScheduling from './locales/en/gameScheduling'
import basketballScheduling from './locales/en/basketballScheduling'
import teamLinks from './locales/en/teamLinks'
import scorerAssign from './locales/en/scorerAssign'
import join from './locales/en/join'
import feedback from './locales/en/feedback'
import tasks from './locales/en/tasks'
import carpool from './locales/en/carpool'
import polls from './locales/en/polls'
import bugfixes from './locales/en/bugfixes'
import guide from './locales/en/guide'
import invitations from './locales/en/invitations'
import announcements from './locales/en/announcements'
import messaging from './locales/en/messaging'
import broadcast from './locales/en/broadcast'
import fines from './locales/en/fines'
import pwa from './locales/en/pwa'
import forms from './locales/en/forms'
import finance from './locales/en/finance'

import deCommon from './locales/de/common'
import deNav from './locales/de/nav'
import deJsExport from './locales/de/jsExport'
import deCalendar from './locales/de/calendar'
import deGames from './locales/de/games'
import deTrainings from './locales/de/trainings'
import deAbsences from './locales/de/absences'
import deScorer from './locales/de/scorer'
import deTeams from './locales/de/teams'
import deHallenplan from './locales/de/hallenplan'
import deSpielplanung from './locales/de/spielplanung'
import deAuth from './locales/de/auth'
import deEvents from './locales/de/events'
import deHome from './locales/de/home'
import deLegal from './locales/de/legal'
import deAdmin from './locales/de/admin'
import deParticipation from './locales/de/participation'
import deNotifications from './locales/de/notifications'
import deGameScheduling from './locales/de/gameScheduling'
import deBasketballScheduling from './locales/de/basketballScheduling'
import deTeamLinks from './locales/de/teamLinks'
import deScorerAssign from './locales/de/scorerAssign'
import deJoin from './locales/de/join'
import deFeedback from './locales/de/feedback'
import deTasks from './locales/de/tasks'
import deCarpool from './locales/de/carpool'
import dePolls from './locales/de/polls'
import deBugfixes from './locales/de/bugfixes'
import deGuide from './locales/de/guide'
import deInvitations from './locales/de/invitations'
import deAnnouncements from './locales/de/announcements'
import deMessaging from './locales/de/messaging'
import deBroadcast from './locales/de/broadcast'
import deFines from './locales/de/fines'
import dePwa from './locales/de/pwa'
import deForms from './locales/de/forms'
import deFinance from './locales/de/finance'

import frCommon from './locales/fr/common'
import frNav from './locales/fr/nav'
import frCalendar from './locales/fr/calendar'
import frGames from './locales/fr/games'
import frTrainings from './locales/fr/trainings'
import frAbsences from './locales/fr/absences'
import frScorer from './locales/fr/scorer'
import frTeams from './locales/fr/teams'
import frHallenplan from './locales/fr/hallenplan'
import frSpielplanung from './locales/fr/spielplanung'
import frAuth from './locales/fr/auth'
import frEvents from './locales/fr/events'
import frHome from './locales/fr/home'
import frLegal from './locales/fr/legal'
import frAdmin from './locales/fr/admin'
import frParticipation from './locales/fr/participation'
import frNotifications from './locales/fr/notifications'
import frGameScheduling from './locales/fr/gameScheduling'
import frBasketballScheduling from './locales/fr/basketballScheduling'
import frTeamLinks from './locales/fr/teamLinks'
import frScorerAssign from './locales/fr/scorerAssign'
import frFeedback from './locales/fr/feedback'
import frTasks from './locales/fr/tasks'
import frCarpool from './locales/fr/carpool'
import frPolls from './locales/fr/polls'
import frBugfixes from './locales/fr/bugfixes'
import frGuide from './locales/fr/guide'
import frInvitations from './locales/fr/invitations'
import frAnnouncements from './locales/fr/announcements'
import frMessaging from './locales/fr/messaging'
import frBroadcast from './locales/fr/broadcast'
import frFines from './locales/fr/fines'
import frPwa from './locales/fr/pwa'
import frFinance from './locales/fr/finance'

import itCommon from './locales/it/common'
import itNav from './locales/it/nav'
import itCalendar from './locales/it/calendar'
import itGames from './locales/it/games'
import itTrainings from './locales/it/trainings'
import itAbsences from './locales/it/absences'
import itScorer from './locales/it/scorer'
import itTeams from './locales/it/teams'
import itHallenplan from './locales/it/hallenplan'
import itSpielplanung from './locales/it/spielplanung'
import itAuth from './locales/it/auth'
import itEvents from './locales/it/events'
import itHome from './locales/it/home'
import itLegal from './locales/it/legal'
import itAdmin from './locales/it/admin'
import itParticipation from './locales/it/participation'
import itNotifications from './locales/it/notifications'
import itGameScheduling from './locales/it/gameScheduling'
import itBasketballScheduling from './locales/it/basketballScheduling'
import itTeamLinks from './locales/it/teamLinks'
import itScorerAssign from './locales/it/scorerAssign'
import itFeedback from './locales/it/feedback'
import itTasks from './locales/it/tasks'
import itCarpool from './locales/it/carpool'
import itPolls from './locales/it/polls'
import itBugfixes from './locales/it/bugfixes'
import itGuide from './locales/it/guide'
import itInvitations from './locales/it/invitations'
import itAnnouncements from './locales/it/announcements'
import itMessaging from './locales/it/messaging'
import itBroadcast from './locales/it/broadcast'
import itFines from './locales/it/fines'
import itPwa from './locales/it/pwa'
import itFinance from './locales/it/finance'

import gswCommon from './locales/gsw/common'
import gswNav from './locales/gsw/nav'
import gswCalendar from './locales/gsw/calendar'
import gswGames from './locales/gsw/games'
import gswTrainings from './locales/gsw/trainings'
import gswAbsences from './locales/gsw/absences'
import gswScorer from './locales/gsw/scorer'
import gswTeams from './locales/gsw/teams'
import gswHallenplan from './locales/gsw/hallenplan'
import gswSpielplanung from './locales/gsw/spielplanung'
import gswAuth from './locales/gsw/auth'
import gswEvents from './locales/gsw/events'
import gswHome from './locales/gsw/home'
import gswLegal from './locales/gsw/legal'
import gswAdmin from './locales/gsw/admin'
import gswParticipation from './locales/gsw/participation'
import gswNotifications from './locales/gsw/notifications'
import gswGameScheduling from './locales/gsw/gameScheduling'
import gswBasketballScheduling from './locales/gsw/basketballScheduling'
import gswTeamLinks from './locales/gsw/teamLinks'
import gswScorerAssign from './locales/gsw/scorerAssign'
import gswFeedback from './locales/gsw/feedback'
import gswTasks from './locales/gsw/tasks'
import gswJoin from './locales/gsw/join'
import gswCarpool from './locales/gsw/carpool'
import gswPolls from './locales/gsw/polls'
import gswBugfixes from './locales/gsw/bugfixes'
import gswGuide from './locales/gsw/guide'
import gswInvitations from './locales/gsw/invitations'
import gswAnnouncements from './locales/gsw/announcements'
import gswMessaging from './locales/gsw/messaging'
import gswBroadcast from './locales/gsw/broadcast'
import gswFines from './locales/gsw/fines'
import gswPwa from './locales/gsw/pwa'
import gswFinance from './locales/gsw/finance'

function getInitialLanguage(): string {
  if (typeof window === 'undefined') return 'de'
  const saved = localStorage.getItem('wiedisync-lang')
  if (saved) return saved
  // Detect browser language. English-first: unrecognised browsers fall back
  // to 'en' rather than 'de'. German speakers still get German because their
  // browser.language starts with 'de'.
  const browserLang = navigator.language?.slice(0, 2)
  const supported = ['de', 'en', 'fr', 'it']
  return supported.includes(browserLang) ? browserLang : 'en'
}

const savedLng = getInitialLanguage()

i18n.use(initReactI18next).init({
  lng: savedLng,
  fallbackLng: {
    gsw: ['de', 'en'],
    default: ['en'],
  },
  ns: [
    'common',
    'nav',
    'calendar',
    'games',
    'trainings',
    'absences',
    'scorer',
    'teams',
    'hallenplan',
    'spielplanung',
    'auth',
    'events',
    'home',
    'legal',
    'admin',
    'participation',
    'notifications',
    'gameScheduling',
    'basketballScheduling',
    'scorerAssign',
    'join',
    'feedback',
    'tasks',
    'carpool',
    'polls',
    'bugfixes',
    'guide',
    'invitations',
    'announcements',
    'messaging',
    'broadcast',
    'fines',
    'pwa',
    'forms',
    'finance',
    'jsExport',
  ],
  defaultNS: 'common',
  resources: {
    en: {
      common,
      nav,
      calendar,
      games,
      trainings,
      absences,
      scorer,
      teams,
      hallenplan,
      spielplanung,
      auth,
      events,
      home,
      legal,
      admin,
      participation,
      notifications,
      gameScheduling,
      basketballScheduling,
      teamLinks,
      scorerAssign,
      join,
      feedback,
      tasks,
      carpool,
      polls,
      bugfixes,
      guide,
      invitations,
      announcements,
      messaging,
      broadcast,
      fines,
      pwa,
      forms,
      finance,
      jsExport,
    },
    de: {
      common: deCommon,
      nav: deNav,
      jsExport: deJsExport,
      calendar: deCalendar,
      games: deGames,
      trainings: deTrainings,
      absences: deAbsences,
      scorer: deScorer,
      teams: deTeams,
      hallenplan: deHallenplan,
      spielplanung: deSpielplanung,
      auth: deAuth,
      events: deEvents,
      home: deHome,
      legal: deLegal,
      admin: deAdmin,
      participation: deParticipation,
      notifications: deNotifications,
      gameScheduling: deGameScheduling,
      basketballScheduling: deBasketballScheduling,
      teamLinks: deTeamLinks,
      scorerAssign: deScorerAssign,
      join: deJoin,
      feedback: deFeedback,
      tasks: deTasks,
      carpool: deCarpool,
      polls: dePolls,
      bugfixes: deBugfixes,
      guide: deGuide,
      invitations: deInvitations,
      announcements: deAnnouncements,
      messaging: deMessaging,
      broadcast: deBroadcast,
      fines: deFines,
      pwa: dePwa,
      forms: deForms,
      finance: deFinance,
    },
    fr: {
      common: frCommon,
      nav: frNav,
      calendar: frCalendar,
      games: frGames,
      trainings: frTrainings,
      absences: frAbsences,
      scorer: frScorer,
      teams: frTeams,
      hallenplan: frHallenplan,
      spielplanung: frSpielplanung,
      auth: frAuth,
      events: frEvents,
      home: frHome,
      legal: frLegal,
      admin: frAdmin,
      participation: frParticipation,
      notifications: frNotifications,
      gameScheduling: frGameScheduling,
      basketballScheduling: frBasketballScheduling,
      teamLinks: frTeamLinks,
      scorerAssign: frScorerAssign,
      feedback: frFeedback,
      tasks: frTasks,
      carpool: frCarpool,
      polls: frPolls,
      bugfixes: frBugfixes,
      guide: frGuide,
      invitations: frInvitations,
      announcements: frAnnouncements,
      messaging: frMessaging,
      broadcast: frBroadcast,
      fines: frFines,
      pwa: frPwa,
      finance: frFinance,
    },
    it: {
      common: itCommon,
      nav: itNav,
      calendar: itCalendar,
      games: itGames,
      trainings: itTrainings,
      absences: itAbsences,
      scorer: itScorer,
      teams: itTeams,
      hallenplan: itHallenplan,
      spielplanung: itSpielplanung,
      auth: itAuth,
      events: itEvents,
      home: itHome,
      legal: itLegal,
      admin: itAdmin,
      participation: itParticipation,
      notifications: itNotifications,
      gameScheduling: itGameScheduling,
      basketballScheduling: itBasketballScheduling,
      teamLinks: itTeamLinks,
      scorerAssign: itScorerAssign,
      feedback: itFeedback,
      tasks: itTasks,
      carpool: itCarpool,
      polls: itPolls,
      bugfixes: itBugfixes,
      guide: itGuide,
      invitations: itInvitations,
      announcements: itAnnouncements,
      messaging: itMessaging,
      broadcast: itBroadcast,
      fines: itFines,
      pwa: itPwa,
      finance: itFinance,
    },
    gsw: {
      common: gswCommon,
      nav: gswNav,
      calendar: gswCalendar,
      games: gswGames,
      trainings: gswTrainings,
      absences: gswAbsences,
      scorer: gswScorer,
      teams: gswTeams,
      hallenplan: gswHallenplan,
      spielplanung: gswSpielplanung,
      auth: gswAuth,
      events: gswEvents,
      home: gswHome,
      legal: gswLegal,
      admin: gswAdmin,
      participation: gswParticipation,
      notifications: gswNotifications,
      gameScheduling: gswGameScheduling,
      basketballScheduling: gswBasketballScheduling,
      teamLinks: gswTeamLinks,
      scorerAssign: gswScorerAssign,
      join: gswJoin,
      feedback: gswFeedback,
      tasks: gswTasks,
      carpool: gswCarpool,
      polls: gswPolls,
      bugfixes: gswBugfixes,
      guide: gswGuide,
      invitations: gswInvitations,
      announcements: gswAnnouncements,
      messaging: gswMessaging,
      broadcast: gswBroadcast,
      fines: gswFines,
      pwa: gswPwa,
      finance: gswFinance,
    },
  },
  interpolation: {
    escapeValue: false,
  },
})

// Keep <html lang> in sync with the active locale. A stale lang attribute (the
// index.html default is "en") while content renders in another language is what
// nudges mobile browsers to auto-translate the page — which mutates the DOM out
// of band and crashes React's reconciler with a NotFoundError on insertBefore.
// gsw isn't well supported by assistive tech, so expose it as de-CH.
function syncDocumentLang(lng: string) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = lng === 'gsw' ? 'de-CH' : lng
}
syncDocumentLang(i18n.language || savedLng)
i18n.on('languageChanged', syncDocumentLang)

export default i18n
