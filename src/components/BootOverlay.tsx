import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { isAuthenticated } from '../lib/api'
import { usePageLoading } from '../hooks/usePageReady'
import LoadingSpinner from './LoadingSpinner'

/**
 * The ONE boot spinner for the whole app — a single overlay instance that spans
 * every boot phase (session restore → team-context load → the active page's data
 * load) so the user sees one continuous spinner that fades into the app, never
 * two. Replaces the two previous separate spinners: AuthProvider's session-
 * restore spinner and Layout's boot-gate overlay.
 *
 * Rendered once near the top of the tree (inside AuthProvider + PageReadyProvider,
 * as a sibling of <Routes>) so it never unmounts/remounts between phases — the
 * spinning logo is literally the same element throughout the whole boot.
 */
export default function BootOverlay() {
  const { isLoading, teamsLoading } = useAuth()
  const pageLoading = usePageLoading()
  // The auth-restore phase: isAuthenticated() (a readable hint cookie) is true
  // exactly while a previous session is being restored, so this masks the same
  // window AuthProvider's old blocking spinner did. Plus the active page's own
  // data load. Layout gates its chrome on the same authBooting expression.
  const authBooting = (isLoading || teamsLoading) && isAuthenticated()
  const booting = authBooting || pageLoading

  // Keep mounted and fade out 250ms after booting ends, so the page content
  // (which mounts the instant loading clears) paints underneath before the
  // spinner disappears — no "spinner gone, data a beat later" flicker.
  const [mounted, setMounted] = useState(booting)
  if (booting && !mounted) setMounted(true)
  useEffect(() => {
    if (booting) return
    const t = setTimeout(() => setMounted(false), 250)
    return () => clearTimeout(t)
  }, [booting])

  if (!mounted) return null
  return (
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center bg-gray-50 transition-opacity duration-200 dark:bg-gray-900 ${
        booting ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
    >
      <LoadingSpinner showProgress={false} />
    </div>
  )
}
