import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from './components/ui/sonner'
import { QueryProvider } from './lib/QueryProvider'
import { AuthProvider } from './hooks/AuthProvider'
import { ThemeProvider } from './hooks/ThemeProvider'
import { AdminModeProvider } from './hooks/AdminModeProvider'
import { ConfirmProvider } from './components/ConfirmDialogProvider'
import { PageReadyProvider } from './hooks/PageReadyProvider'
import BootOverlay from './components/BootOverlay'
import { SentryErrorBoundary } from './lib/sentry'
import { reloadNow } from './lib/chunkReload'
import AccountingLayout from './components/AccountingLayout'
import LoginPage from './modules/auth/LoginPage'
import PendingPage from './modules/auth/PendingPage'
import SetPasswordPage from './modules/auth/SetPasswordPage'
import AccountingHome from './modules/finance/AccountingHome'

function AccountingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="space-y-4 p-8 text-center">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Something went wrong</h1>
        <p className="text-muted-foreground">An unexpected error occurred. Etwas ist schiefgelaufen.</p>
        <button
          className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9"
          onClick={() => reloadNow()}
        >
          Reload page
        </button>
      </div>
    </div>
  )
}

/**
 * Standalone root for accounting.wiedisync.kscw.ch — the club's books (the parallel
 * native ledger next to the ClubDesk mirror) for the treasurer, the board and the
 * auditors. Same provider stack as the member `App` and `SchedulingApp`; built via
 * `VITE_APP_TARGET=accounting` (`npm run build:accounting`). The `.kscw.ch` session
 * cookie is shared, so a member logged in on wiedisync.kscw.ch is logged in here.
 */
export default function AccountingApp() {
  useEffect(() => {
    document.title = 'Buchhaltung — KSC Wiedikon'
  }, [])

  return (
    <SentryErrorBoundary fallback={() => <AccountingFallback />}>
      <QueryProvider>
        <ThemeProvider>
          <AuthProvider>
            <AdminModeProvider>
              <ConfirmProvider>
                <BrowserRouter>
                  <PageReadyProvider>
                    <BootOverlay />
                    <Routes>
                      <Route path="login" element={<LoginPage />} />
                      <Route path="pending" element={<PendingPage />} />
                      <Route path="set-password" element={<SetPasswordPage />} />
                      <Route element={<AccountingLayout />}>
                        <Route index element={<AccountingHome />} />
                      </Route>
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </PageReadyProvider>
                </BrowserRouter>
                <Toaster mobileOffset={{ bottom: '16px' }} />
              </ConfirmProvider>
            </AdminModeProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryProvider>
    </SentryErrorBoundary>
  )
}
