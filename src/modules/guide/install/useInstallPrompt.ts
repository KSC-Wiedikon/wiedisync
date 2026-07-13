import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

// Module-scope capture: beforeinstallprompt can fire before any component mounts.
let deferredPrompt: BeforeInstallPromptEvent | null = null
let listenersAttached = false
const CAPTURED_EVENT = 'kscw:bip-captured'
// Fired after `promptInstall` consumes the deferred prompt, so subscribers
// re-read the (now null) store — the old code did this with a local setState.
const CONSUMED_EVENT = 'kscw:bip-consumed'

function ensureListeners() {
  if (listenersAttached || typeof window === 'undefined') return
  listenersAttached = true
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    window.dispatchEvent(new Event(CAPTURED_EVENT))
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
  })
}

// Attach as early as this module is imported.
ensureListeners()

// `deferredPrompt` is an external store. The module-level 'appinstalled' listener
// above is registered first (at import time), so by the time a subscriber runs,
// `deferredPrompt` is already null — same ordering the old effect relied on.
function subscribeInstallPrompt(onStoreChange: () => void) {
  if (typeof window === 'undefined') return () => {}
  ensureListeners()
  window.addEventListener(CAPTURED_EVENT, onStoreChange)
  window.addEventListener('appinstalled', onStoreChange)
  window.addEventListener(CONSUMED_EVENT, onStoreChange)
  return () => {
    window.removeEventListener(CAPTURED_EVENT, onStoreChange)
    window.removeEventListener('appinstalled', onStoreChange)
    window.removeEventListener(CONSUMED_EVENT, onStoreChange)
  }
}

function getInstallPromptSnapshot() {
  return deferredPrompt !== null
}

function getInstallPromptServerSnapshot() {
  return false
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable'

/**
 * Exposes whether a native install prompt is available (Android/desktop Chrome)
 * and a function to trigger it. `onInstalled` fires when the app is installed.
 */
export function useInstallPrompt(onInstalled?: () => void) {
  const canInstall = useSyncExternalStore(
    subscribeInstallPrompt,
    getInstallPromptSnapshot,
    getInstallPromptServerSnapshot,
  )

  const onInstalledRef = useRef(onInstalled)
  useEffect(() => { onInstalledRef.current = onInstalled })

  // The `onInstalled` side effect stays an event subscription (the store only
  // carries the boolean).
  useEffect(() => {
    const onInstalledEvt = () => { onInstalledRef.current?.() }
    window.addEventListener('appinstalled', onInstalledEvt)
    return () => window.removeEventListener('appinstalled', onInstalledEvt)
  }, [])

  const promptInstall = useCallback(async (): Promise<InstallOutcome> => {
    const prompt = deferredPrompt
    if (!prompt) return 'unavailable'
    await prompt.prompt()
    const choice = await prompt.userChoice
    deferredPrompt = null
    window.dispatchEvent(new Event(CONSUMED_EVENT))
    return choice.outcome
  }, [])

  return { canInstall, promptInstall }
}
