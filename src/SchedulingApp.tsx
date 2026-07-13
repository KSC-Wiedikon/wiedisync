import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { QueryProvider } from './lib/QueryProvider'
import { AuthProvider } from './hooks/AuthProvider'
import { ThemeProvider } from './hooks/ThemeProvider'
import { AdminModeProvider } from './hooks/AdminModeProvider'
import { ConfirmProvider } from './components/ConfirmDialogProvider'
import { PageReadyProvider } from './hooks/PageReadyProvider'
import BootOverlay from './components/BootOverlay'
import { TourProvider } from './modules/guide/TourProvider'
import { SentryErrorBoundary } from './lib/sentry'
import { reloadNow } from './lib/chunkReload'
import SchedulingLayout from './components/SchedulingLayout'
import AdminOrSpielplanerRoute from './components/AdminOrSpielplanerRoute'
import MailboxRoute from './components/MailboxRoute'
import SpielplanerOrAdminRoute from './components/SpielplanerOrAdminRoute'
// Auth pages — pre-SSO, admins still log in on this origin until cookie-session
// SSO (Phase 2) shares the member-app login across the .kscw.ch subdomains.
import LoginPage from './modules/auth/LoginPage'
import PendingPage from './modules/auth/PendingPage'
import SetPasswordPage from './modules/auth/SetPasswordPage'
// Scheduling pages
import PublicTerminplanungPage from './modules/gameScheduling/pages/PublicTerminplanungPage'
import OpponentFlowPage from './modules/gameScheduling/pages/OpponentFlowPage'
import AdminSetupPage from './modules/gameScheduling/pages/AdminSetupPage'
import AdminDashboardPage from './modules/gameScheduling/pages/AdminDashboardPage'
import MailboxPage from './modules/gameScheduling/pages/MailboxPage'
import SpielplanungPage from './modules/spielplanung/SpielplanungPage'
import SchedulingHome from './modules/gameScheduling/pages/SchedulingHome'

function SchedulingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="space-y-4 p-8 text-center">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="text-muted-foreground">An unexpected error occurred. Etwas ist schiefgelaufen.</p>
        <button
          className="rounded-md bg-brand-600 px-4 py-2 text-white hover:bg-brand-700"
          onClick={() => reloadNow()}
        >
          Reload page
        </button>
      </div>
    </div>
  )
}

/**
 * Standalone root for the Spielplanung subdomain (spielplanung.wiedisync.kscw.ch).
 * Same provider stack as the member `App`, but a scheduling-only route tree and
 * a minimal shell (no member navigation). Built via `VITE_APP_TARGET=scheduling`.
 */
export default function SchedulingApp() {
  useEffect(() => {
    document.title = 'Spielplanung — KSC Wiedikon'
  }, [])

  return (
    <SentryErrorBoundary fallback={() => <SchedulingFallback />}>
      <QueryProvider>
        <ThemeProvider>
          <AuthProvider>
            <AdminModeProvider>
              <ConfirmProvider>
                <BrowserRouter>
                  <TourProvider>
                  <PageReadyProvider>
                    <BootOverlay />
                    <Routes>
                      {/* Public opponent flow — bare, no shell (as on the member app) */}
                      <Route path="terminplanung" element={<PublicTerminplanungPage />} />
                      <Route path="terminplanung/:token" element={<OpponentFlowPage />} />

                      {/* Auth (pre-SSO login on this origin) */}
                      <Route path="login" element={<LoginPage />} />
                      <Route path="pending" element={<PendingPage />} />
                      <Route path="set-password" element={<SetPasswordPage />} />

                      {/* `/` dispatches by access; bare so unauth bounces to /login
                          without flashing the shell (and no guard→/ redirect loop). */}
                      <Route index element={<SchedulingHome />} />

                      {/* Admin scheduling — minimal shell. The dashboard is the
                          section landing page; setup lives under /settings. */}
                      <Route element={<SchedulingLayout />}>
                        <Route
                          path="admin/terminplanung"
                          element={<AdminOrSpielplanerRoute><AdminDashboardPage /></AdminOrSpielplanerRoute>}
                        />
                        <Route
                          path="admin/terminplanung/settings"
                          element={<AdminOrSpielplanerRoute><AdminSetupPage /></AdminOrSpielplanerRoute>}
                        />
                        {/* Mailbox tab — Volleyball/Basketball toggle inside (per-sport gating in the page). */}
                        <Route
                          path="admin/terminplanung/mailbox"
                          element={<MailboxRoute><MailboxPage /></MailboxRoute>}
                        />
                        {/* Back-compat: the old dashboard URL now lives at the section root. */}
                        <Route
                          path="admin/terminplanung/dashboard"
                          element={<Navigate to="/admin/terminplanung" replace />}
                        />
                        <Route
                          path="admin/spielplanung"
                          element={<SpielplanerOrAdminRoute><SpielplanungPage /></SpielplanerOrAdminRoute>}
                        />
                      </Route>

                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </PageReadyProvider>
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
