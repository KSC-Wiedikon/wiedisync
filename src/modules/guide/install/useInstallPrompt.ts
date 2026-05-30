import { useCallback, useEffect, useRef, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

// Module-scope capture: beforeinstallprompt can fire before any component mounts.
let deferredPrompt: BeforeInstallPromptEvent | null = null
let listenersAttached = false
const CAPTURED_EVENT = 'kscw:bip-captured'

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

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable'

/**
 * Exposes whether a native install prompt is available (Android/desktop Chrome)
 * and a function to trigger it. `onInstalled` fires when the app is installed.
 */
export function useInstallPrompt(onInstalled?: () => void) {
  const [canInstall, setCanInstall] = useState<boolean>(() => deferredPrompt !== null)

  const onInstalledRef = useRef(onInstalled)
  useEffect(() => { onInstalledRef.current = onInstalled })

  useEffect(() => {
    ensureListeners()
    setCanInstall(deferredPrompt !== null)
    const onCaptured = () => setCanInstall(true)
    const onInstalledEvt = () => {
      setCanInstall(false)
      onInstalledRef.current?.()
    }
    window.addEventListener(CAPTURED_EVENT, onCaptured)
    window.addEventListener('appinstalled', onInstalledEvt)
    return () => {
      window.removeEventListener(CAPTURED_EVENT, onCaptured)
      window.removeEventListener('appinstalled', onInstalledEvt)
    }
  }, [])

  const promptInstall = useCallback(async (): Promise<InstallOutcome> => {
    const prompt = deferredPrompt
    if (!prompt) return 'unavailable'
    await prompt.prompt()
    const choice = await prompt.userChoice
    deferredPrompt = null
    setCanInstall(false)
    return choice.outcome
  }, [])

  return { canInstall, promptInstall }
}
