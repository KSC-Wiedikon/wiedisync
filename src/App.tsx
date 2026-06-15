import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import { QueryProvider } from './lib/query'
import { AuthProvider } from './hooks/useAuth'
import { ThemeProvider } from './hooks/useTheme'
import { AdminModeProvider } from './hooks/useAdminMode'
import { ConfirmProvider } from './components/ConfirmProvider'
import { TourProvider } from './modules/guide/TourProvider'
import Layout from './components/Layout'
import AdminRoute from './components/AdminRoute'
import SuperAdminRoute from './components/SuperAdminRoute'
import SpielplanerOrAdminRoute from './components/SpielplanerOrAdminRoute'
import AdminOrSpielplanerRoute from './components/AdminOrSpielplanerRoute'
import GamesPage from './modules/games/GamesPage'
import SpielplanungPage from './modules/spielplanung/SpielplanungPage'
import TrainingsPage from './modules/trainings/TrainingsPage'
import AbsencesPage from './modules/absences/AbsencesPage'
import ScorerPage from './modules/scorer/ScorerPage'
import CalendarPage from './modules/calendar/CalendarPage'
import HomePage from './modules/home/HomePage'
import TeamsPage from './modules/teams/TeamsPage'
import TeamDetail from './modules/teams/TeamDetail'
import PlayerProfile from './modules/teams/PlayerProfile'
import RosterEditor from './modules/teams/RosterEditor'
import InfraHealthPage from './modules/admin/InfraHealthPage'
import DataHealthPage from './modules/admin/DataHealthPage'
import AuditLogPage from './modules/admin/AuditLogPage'
import RefereeExpensesPage from './modules/admin/RefereeExpensesPage'
import ClubStatsPage from './modules/admin/ClubStatsPage'
import VolleyFeedbackPage from './modules/admin/VolleyFeedbackPage'
import AnmeldungenPage from './modules/admin/AnmeldungenPage'
import HallenplanPage from './modules/hallenplan/HallenplanPage'
import EmbedGamesPage from './modules/games/EmbedGamesPage'
import LoginPage from './modules/auth/LoginPage'
import SignUpPage from './modules/auth/SignUpPage'
import PendingPage from './modules/auth/PendingPage'
import ProfilePage from './modules/auth/ProfilePage'
import EventsPage from './modules/events/EventsPage'
import FormsPage from './modules/forms/FormsPage'
import FormBuilderPage from './modules/forms/FormBuilderPage'
import PublicFormPage from './modules/forms/PublicFormPage'
import FinesPage from './modules/fines/FinesPage'
import DatenschutzPage from './modules/legal/DatenschutzPage'
import ImpressumPage from './modules/legal/ImpressumPage'
import AuthRoute from './components/AuthRoute'
import ScorerAssignPage from './modules/scorer/ScorerAssignPage'
import AdminSetupPage from './modules/gameScheduling/pages/AdminSetupPage'
import AdminDashboardPage from './modules/gameScheduling/pages/AdminDashboardPage'
import BugfixDashboardPage from './modules/admin/BugfixDashboardPage'
import StatusPage from './modules/admin/StatusPage'
import ExplorePage from './modules/admin/ExplorePage'
import SqlWorkspacePage from './modules/admin/SqlWorkspacePage'
const AnimatedUIPage = lazy(() => import('./modules/admin/AnimatedUIPage'))
import AnnouncementsPage from './modules/admin/AnnouncementsPage'
import NewsArchivePage from './modules/news/NewsArchivePage'

import JoinPage from './modules/auth/JoinPage'
import SetPasswordPage from './modules/auth/SetPasswordPage'
import OAuthCallbackPage from './modules/auth/OAuthCallbackPage'
import PublicTerminplanungPage from './modules/gameScheduling/pages/PublicTerminplanungPage'
import OpponentFlowPage from './modules/gameScheduling/pages/OpponentFlowPage'
import FeedbackPage from './modules/feedback/FeedbackPage'
import ChangelogPage from './modules/changelog/ChangelogPage'
import { SentryErrorBoundary } from './lib/sentry'

const GuidePage = lazy(() => import('./modules/guide/GuidePage'))
const InboxPage = lazy(() => import('./modules/messaging/pages/InboxPage'))
const ConversationPage = lazy(() => import('./modules/messaging/pages/ConversationPage'))
const MessagingSettingsPage = lazy(() => import('./modules/messaging/pages/MessagingSettingsPage'))
const AdminReportsPage = lazy(() => import('./modules/admin/AdminReportsPage'))

// Stale lazy-import chunks (after a deploy) throw a different message per
// engine — Chromium: `Failed to fetch dynamically imported module`,
// Firefox desktop: `error loading dynamically imported module`, older
// Safari: `Importing a module script failed`, and crucially WebKit/iOS
// (Safari + Firefox iOS + Chrome iOS, where the SPA fallback serves
// index.html for a missing chunk): `'text/html' is not a valid JavaScript
// MIME type` / Chrome's strict-MIME `expected a JavaScript … module script
// but the server responded with a MIME type`. Detected here so we hot-reload
// once instead of stranding the user on a blank screen + Sentry noise.
function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk \d+ failed|ChunkLoadError|is not a valid JavaScript MIME type|expected a JavaScript(?:-or-Wasm)? module script but the server responded with a MIME type/i.test(msg)
}

const RELOAD_COOLDOWN_KEY = 'wiedisync-chunk-reload-ts'

function maybeReloadOnStaleChunk(error: unknown): boolean {
  if (!isChunkLoadError(error)) return false
  const now = Date.now()
  const last = Number(sessionStorage.getItem(RELOAD_COOLDOWN_KEY) || 0)
  if (now - last < 10_000) return false // reload-loop guard
  sessionStorage.setItem(RELOAD_COOLDOWN_KEY, String(now))
  window.location.reload()
  return true
}

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    if (maybeReloadOnStaleChunk(event.reason)) event.preventDefault()
  })
  window.addEventListener('error', (event) => {
    if (maybeReloadOnStaleChunk(event.error || event.message)) event.preventDefault()
  })
}

function SentryFallback({ error }: { error?: unknown } = {}) {
  if (typeof window !== 'undefined' && maybeReloadOnStaleChunk(error)) {
    return null
  }
  // Error boundary — cannot rely on i18n being loaded. Plain English + a
  // compact DE translation as bilingual fallback for the Swiss audience.
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="text-center space-y-4 p-8">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="text-muted-foreground">An unexpected error occurred. Etwas ist schiefgelaufen.</p>
        <button
          className="rounded-md bg-brand-600 px-4 py-2 text-white hover:bg-brand-700"
          onClick={() => window.location.reload()}
        >
          Reload page
        </button>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <SentryErrorBoundary fallback={({ error }) => <SentryFallback error={error} />}>
    <QueryProvider>
    <ThemeProvider>
    <AuthProvider>
      <AdminModeProvider>
      <ConfirmProvider>
      <BrowserRouter>
      <TourProvider>
        <Routes>
          {/* Standalone routes — no layout wrapper */}
          <Route path="embed/games" element={<EmbedGamesPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="signup" element={<SignUpPage />} />
          <Route path="pending" element={<PendingPage />} />

          <Route path="auth/callback" element={<OAuthCallbackPage />} />
          <Route path="join/:token" element={<JoinPage />} />
          <Route path="set-password" element={<SetPasswordPage />} />
          <Route path="terminplanung" element={<PublicTerminplanungPage />} />
          <Route path="terminplanung/:token" element={<OpponentFlowPage />} />
          <Route path="f/:slug" element={<PublicFormPage />} />

          <Route element={<Layout />}>
            <Route index element={<AuthRoute><HomePage /></AuthRoute>} />
            <Route path="calendar" element={<AuthRoute><CalendarPage /></AuthRoute>} />
            <Route path="games" element={<GamesPage />} />
            <Route path="trainings" element={<AuthRoute><TrainingsPage /></AuthRoute>} />
            <Route path="absences" element={<AuthRoute><AbsencesPage /></AuthRoute>} />
            <Route path="scorer" element={<AuthRoute><ScorerPage /></AuthRoute>} />
            <Route path="teams" element={<AuthRoute><TeamsPage /></AuthRoute>} />
            <Route path="teams/:teamSlug" element={<AuthRoute><TeamDetail /></AuthRoute>} />
            <Route path="teams/:teamSlug/roster/edit" element={<AuthRoute><RosterEditor /></AuthRoute>} />
            <Route path="teams/player/:memberId" element={<AuthRoute><PlayerProfile /></AuthRoute>} />
            <Route path="events" element={<AuthRoute><EventsPage /></AuthRoute>} />
            <Route path="forms" element={<AuthRoute><FormsPage /></AuthRoute>} />
            <Route path="forms/new" element={<AuthRoute><FormBuilderPage /></AuthRoute>} />
            <Route path="forms/:formId/edit" element={<AuthRoute><FormBuilderPage /></AuthRoute>} />
            <Route path="fines" element={<AuthRoute><FinesPage /></AuthRoute>} />
            <Route path="datenschutz" element={<DatenschutzPage />} />
            <Route path="impressum" element={<ImpressumPage />} />
            <Route path="feedback" element={<FeedbackPage />} />
            <Route path="changelog" element={<ChangelogPage />} />
            <Route path="guide" element={<AuthRoute><Suspense fallback={null}><GuidePage /></Suspense></AuthRoute>} />
            <Route path="profile" element={<AuthRoute><ProfilePage /></AuthRoute>} />
            <Route path="inbox" element={<AuthRoute><Suspense fallback={null}><InboxPage /></Suspense></AuthRoute>} />
            <Route path="inbox/:conversationId" element={<AuthRoute><Suspense fallback={null}><ConversationPage /></Suspense></AuthRoute>} />
            <Route path="options/messaging" element={<AuthRoute><Suspense fallback={null}><MessagingSettingsPage /></Suspense></AuthRoute>} />
            <Route path="admin/spielplanung" element={<SpielplanerOrAdminRoute><SpielplanungPage /></SpielplanerOrAdminRoute>} />
            <Route path="admin/hallenplan" element={<AdminRoute><HallenplanPage /></AdminRoute>} />
            <Route path="admin/terminplanung" element={<AdminOrSpielplanerRoute><AdminSetupPage /></AdminOrSpielplanerRoute>} />
            <Route path="admin/terminplanung/dashboard" element={<AdminOrSpielplanerRoute><AdminDashboardPage /></AdminOrSpielplanerRoute>} />
            <Route path="admin/scorer-assign" element={<AdminRoute><ScorerAssignPage /></AdminRoute>} />
            <Route path="admin/referee-expenses" element={<AdminRoute><RefereeExpensesPage /></AdminRoute>} />
            <Route path="admin/club-stats" element={<AdminRoute><ClubStatsPage /></AdminRoute>} />
            <Route path="admin/volley-feedback" element={<AdminRoute><VolleyFeedbackPage /></AdminRoute>} />
            <Route path="admin/anmeldungen" element={<AdminRoute><AnmeldungenPage /></AdminRoute>} />
            <Route path="admin/explore" element={<AdminRoute><ExplorePage /></AdminRoute>} />
            <Route path="admin/announcements" element={<AdminRoute><AnnouncementsPage /></AdminRoute>} />
            <Route path="admin/reports" element={<AdminRoute><Suspense fallback={null}><AdminReportsPage /></Suspense></AdminRoute>} />
            <Route path="news" element={<AuthRoute><NewsArchivePage /></AuthRoute>} />
            <Route path="admin/infra" element={<SuperAdminRoute><InfraHealthPage /></SuperAdminRoute>} />
            <Route path="admin/data-health" element={<SuperAdminRoute><DataHealthPage /></SuperAdminRoute>} />
            <Route path="admin/audit-log" element={<SuperAdminRoute><AuditLogPage /></SuperAdminRoute>} />
            <Route path="admin/sql" element={<SuperAdminRoute><SqlWorkspacePage /></SuperAdminRoute>} />
            <Route path="admin/animated-ui" element={<AdminRoute><Suspense fallback={null}><AnimatedUIPage /></Suspense></AdminRoute>} />
            <Route path="bugfixes" element={<SuperAdminRoute><BugfixDashboardPage /></SuperAdminRoute>} />
            <Route path="status" element={<AuthRoute><StatusPage /></AuthRoute>} />
          </Route>
        </Routes>
      </TourProvider>
      </BrowserRouter>
      <Toaster richColors position="top-center" />
      </ConfirmProvider>
      </AdminModeProvider>
    </AuthProvider>
    </ThemeProvider>
    </QueryProvider>
    </SentryErrorBoundary>
  )
}
