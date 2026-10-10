import { useState, useEffect, useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { API_URL, getCurrentMemberId, isImpersonating, kscwApi } from '../lib/api'
import { captureApiError } from '../lib/sentry'
import {
  hasNativeBridge, hasNativeFeature, isNativeBridgeError, nativeRequest, onNativeEvent,
  type NativePushState, type NativePushSubscription,
} from '../lib/nativeBridge'
import { toast } from 'sonner'
import { useAuth } from './useAuth'

interface PushState {
  /** Browser supports push notifications */
  supported: boolean
  /** Notification permission: 'default' | 'granted' | 'denied' */
  permission: NotificationPermission
  /** Currently subscribed to push */
  subscribed: boolean
  /** Loading state during subscribe/unsubscribe */
  loading: boolean
  /**
   * The service-worker probe that fills `subscribed` is still running. Until it
   * settles, `subscribed: false` only means "not known yet" — callers must not
   * paint it as "not subscribed" or wire a handler to it.
   */
  probing: boolean
}

/**
 * Feature-detect Web Push support. Brave on Android blocks FCM with no
 * user-facing toggle to re-enable it; desktop Brave has a toggle, so only
 * exclude mobile Brave.
 */
function detectPushSupport(): boolean {
  const hasApis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const isBraveMobile = 'brave' in navigator && /Android|Mobile/i.test(navigator.userAgent)
  return hasApis && !isBraveMobile
}

/** Whether a Web Push subscription already exists on this browser (see the probe effect). */
function probeWebSubscription(setState: Dispatch<SetStateAction<PushState>>): void {
  navigator.serviceWorker.ready
    .then(reg => reg.pushManager.getSubscription())
    .then(sub => {
      setState(s => ({ ...s, subscribed: !!sub, probing: false }))
    })
    // getSubscription() can reject; without this the row would stay disabled
    // forever, so a failed probe falls back to the "not subscribed" default.
    .catch(() => {
      setState(s => ({ ...s, probing: false }))
    })
}

// ── Native backend (Android app) ──────────────────────────────────────
// The app's WebView has no Push API. It registers with the user's UnifiedPush
// distributor (Sunup, ntfy) instead, and the endpoint it gets back is an
// ordinary Web Push endpoint — same VAPID key, same /web-push/subscribe row,
// same kscw-push Worker. Only the subscribe/probe plumbing differs.

/** POST /web-push/subscribe for a UnifiedPush registration — the browser path's body shape. */
function registerNativeSubscription(sub: NativePushSubscription) {
  return kscwApi('/web-push/subscribe', {
    method: 'POST',
    body: {
      endpoint: sub.endpoint,
      keys_p256dh: sub.keys?.p256dh || '',
      keys_auth: sub.keys?.auth || '',
      user_agent: navigator.userAgent,
    },
  })
}

/** member:endpoint last re-registered this page load — the hook remounts with every panel open. */
let resyncedKey: string | null = null

/**
 * Re-register a subscription the app already holds, so a distributor endpoint
 * that rotated (app closed, distributor reinstalled) reaches the server. The
 * server upserts on member + endpoint, so a repeat is harmless. Background work:
 * logged, never toasted.
 */
function resyncNativeSubscription(sub: NativePushSubscription, operation: string): void {
  // Read-only impersonation: kscwApi would refuse with a toast, and the device
  // must not be bound to the member being looked at.
  if (isImpersonating()) return
  const key = `${getCurrentMemberId()}:${sub.endpoint}`
  if (key === resyncedKey) return
  resyncedKey = key
  registerNativeSubscription(sub).catch((err) => {
    resyncedKey = null
    captureApiError(err, { operation })
  })
}

/** The server refused the endpoint's host (validatePushEndpoint, web-push.js) — e.g. a self-hosted ntfy. */
function isEndpointRejected(err: unknown): boolean {
  const e = err as { status?: number; body?: { error?: unknown } } | null
  return e?.status === 400 && e.body?.error === 'endpoint not accepted'
}

/**
 * Hook for managing push notification subscriptions.
 * Handles permission requests, SW subscription, and backend registration —
 * or, inside the Android app, the same through the native bridge (UnifiedPush).
 */
/**
 * App-wide, mounted once in Layout. Inside the Android app, keeps the server's
 * push row in step with the UnifiedPush endpoint the app holds: a distributor
 * can rotate the endpoint while the app is closed, and `usePushNotifications`
 * only runs while the notification panel or the guide is open — without this
 * a rotated endpoint would silently stop all pushes to this phone.
 */
export function useNativePushSync(): void {
  const { user } = useAuth()
  const userId = user?.id
  useEffect(() => {
    if (!userId || !hasNativeBridge()) return
    let cancelled = false
    let offEndpoint: (() => void) | undefined
    hasNativeFeature('push')
      .then(async (offered) => {
        if (!offered || cancelled) return
        // A non-null endpoint event only comes from a registration the member made.
        offEndpoint = onNativeEvent<{ subscription?: NativePushSubscription | null }>('push-endpoint', ({ subscription }) => {
          if (subscription) resyncNativeSubscription(subscription, 'useNativePushSync.pushEndpoint')
        })
        const { subscription } = await nativeRequest<NativePushState>('push.state')
        if (!cancelled && subscription) resyncNativeSubscription(subscription, 'useNativePushSync.resync')
      })
      .catch((err) => captureApiError(err, { operation: 'useNativePushSync' }))
    return () => {
      cancelled = true
      offEndpoint?.()
    }
  }, [userId])
}

export function usePushNotifications() {
  const { t } = useTranslation('notifications')
  // Support + permission are readable synchronously, so seed them in the lazy
  // initializer instead of writing them from an effect on mount.
  const [state, setState] = useState<PushState>(() => {
    // Inside the app, support is only known once the bridge answers `hello` —
    // start out probing so nothing paints a verdict before it does.
    if (hasNativeBridge()) {
      return { supported: true, permission: 'default', subscribed: false, loading: false, probing: true }
    }
    const supported = detectPushSupport()
    return {
      supported,
      permission: supported ? Notification.permission : 'default',
      subscribed: false,
      loading: false,
      // Unsupported browsers never run the probe below, so they must not start
      // out probing — the toggle row is not rendered for them at all.
      probing: supported,
    }
  })

  // Set once the bridge confirms it offers push; every action then goes native.
  const [native, setNative] = useState(false)
  // For the push-endpoint listener, which outlives the render it was made in.
  const subscribedRef = useRef(false)
  useEffect(() => { subscribedRef.current = state.subscribed }, [state.subscribed])

  // Whether a subscription already exists is only knowable asynchronously
  // (service-worker ready → PushManager) — that stays in an effect. It can pend
  // for hundreds of ms (serviceWorker.ready waits for an active worker, and
  // registration is fire-and-forget from sw-register.js), so `probing` marks the
  // window in which `subscribed: false` is a placeholder rather than an answer.
  // In the app the same question goes to the bridge (`hello`, then push.state).
  useEffect(() => {
    if (!hasNativeBridge()) {
      if (detectPushSupport()) probeWebSubscription(setState)
      return
    }

    let cancelled = false
    let offEndpoint: (() => void) | undefined
    hasNativeFeature('push')
      .then(async (offered) => {
        if (cancelled) return
        if (!offered) {
          // An app build without push: whatever the WebView itself supports.
          const supported = detectPushSupport()
          setState(s => ({ ...s, supported, permission: supported ? Notification.permission : 'default', probing: supported }))
          if (supported) probeWebSubscription(setState)
          return
        }
        setNative(true)
        // The distributor can hand out a new endpoint at any time (or drop it).
        offEndpoint = onNativeEvent<{ subscription?: NativePushSubscription | null }>('push-endpoint', ({ subscription }) => {
          if (!subscription) {
            setState(s => ({ ...s, subscribed: false }))
            return
          }
          if (subscribedRef.current) resyncNativeSubscription(subscription, 'usePushNotifications.pushEndpoint')
        })
        const probe = await nativeRequest<NativePushState>('push.state')
        if (cancelled) return
        setState(s => ({ ...s, permission: probe.permission, subscribed: probe.subscription != null, probing: false }))
        if (probe.subscription) resyncNativeSubscription(probe.subscription, 'usePushNotifications.resync')
      })
      .catch((err) => {
        captureApiError(err, { operation: 'usePushNotifications.probe' })
        if (!cancelled) setState(s => ({ ...s, probing: false }))
      })
    return () => {
      cancelled = true
      offEndpoint?.()
    }
  }, [])

  const subscribeNative = useCallback(async () => {
    setState(s => ({ ...s, loading: true }))
    let held: NativePushSubscription | null = null
    try {
      const vapidResp = await fetch(`${API_URL}/kscw/web-push/vapid-public-key`)
      if (!vapidResp.ok) throw new Error(`VAPID key fetch failed: ${vapidResp.status}`)
      const { publicKey } = await vapidResp.json()

      // The app asks for the Android notification permission, then waits on the
      // distributor's registration callback — both can take a while.
      const { subscription } = await nativeRequest<{ subscription: NativePushSubscription }>(
        'push.subscribe', { vapidPublicKey: publicKey }, 60_000,
      )
      held = subscription
      setState(s => ({ ...s, permission: 'granted' }))

      await registerNativeSubscription(subscription)
      resyncedKey = `${getCurrentMemberId()}:${subscription.endpoint}`
      setState(s => ({ ...s, subscribed: true, loading: false }))
      return true
    } catch (err) {
      // Same as the browser path's non-granted case: no toast, the row shows "blocked".
      if (isNativeBridgeError(err, 'permission_denied')) {
        setState(s => ({ ...s, permission: 'denied', loading: false }))
        return false
      }
      // The server never stored it — drop the app's registration too, or the
      // next probe would find it and paint "subscribed".
      if (held) nativeRequest('push.unsubscribe').catch(() => undefined)
      if (isNativeBridgeError(err, 'no_distributor')) {
        toast.error(t('pushNoDistributor'), { duration: 10_000 })
      } else if (isEndpointRejected(err)) {
        // kscwApi already logged the 400 (with the endpoint host).
        toast.error(t('pushServerNotSupported'), { duration: 10_000 })
      } else {
        captureApiError(err, { operation: 'usePushNotifications.subscribe' })
        toast.error(t('pushSubscribeFailed'))
      }
      setState(s => ({ ...s, loading: false }))
      return false
    }
  }, [t])

  const subscribe = useCallback(async () => {
    // Refuse while probing — we don't yet know whether this device is already
    // subscribed, so acting on it could re-subscribe an existing endpoint.
    if (!state.supported || state.loading || state.probing) return false
    if (native) return subscribeNative()

    setState(s => ({ ...s, loading: true }))

    try {
      // Request permission
      const permission = await Notification.requestPermission()
      setState(s => ({ ...s, permission }))

      if (permission !== 'granted') {
        setState(s => ({ ...s, loading: false }))
        return false
      }

      // Get VAPID public key from Directus (public endpoint, no auth needed)
      const vapidResp = await fetch(`${API_URL}/kscw/web-push/vapid-public-key`)
      if (!vapidResp.ok) throw new Error(`VAPID key fetch failed: ${vapidResp.status}`)
      const { publicKey } = await vapidResp.json()

      // Subscribe via PushManager
      const reg = await navigator.serviceWorker.ready
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Pass Uint8Array directly — some Chrome Android versions fail with .buffer
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      })

      const subJson = subscription.toJSON()

      // Register with Directus (uses kscwApi with 401 retry)
      await kscwApi('/web-push/subscribe', {
        method: 'POST',
        body: {
          endpoint: subJson.endpoint,
          keys_p256dh: subJson.keys?.p256dh || '',
          keys_auth: subJson.keys?.auth || '',
          user_agent: navigator.userAgent,
        },
      })

      setState(s => ({ ...s, subscribed: true, loading: false }))
      return true
    } catch (err) {
      // Route to Sentry/JSONL — the browser push APIs (permission, PushManager,
      // VAPID fetch) don't go through the api.ts helpers, so console-only would
      // hide Brave/FCM blocks + quota/network failures from the error log.
      captureApiError(err, { operation: 'usePushNotifications.subscribe' })
      const msg = (err instanceof Error ? err.message : '') || ''
      // Detect push service failures (Brave blocks FCM, network issues, etc.)
      if (msg.includes('push service') || msg.includes('AbortError') || err instanceof DOMException) {
        const isBrave = 'brave' in navigator
        toast.error(isBrave ? t('pushErrorBrave') : t('pushErrorGeneric'), { duration: 8000 })
      } else {
        toast.error(t('pushSubscribeFailed'))
      }
      setState(s => ({ ...s, loading: false }))
      return false
    }
  }, [state.supported, state.loading, state.probing, native, subscribeNative, t])

  const unsubscribe = useCallback(async () => {
    if (!state.supported || state.loading || state.probing) return false

    setState(s => ({ ...s, loading: true }))

    try {
      if (native) {
        // Server row first (needs the endpoint the app still holds), then the app.
        const { subscription } = await nativeRequest<NativePushState>('push.state')
        if (subscription) {
          await kscwApi('/web-push/unsubscribe', {
            method: 'POST',
            body: { endpoint: subscription.endpoint },
          })
        }
        await nativeRequest('push.unsubscribe')
        resyncedKey = null
        setState(s => ({ ...s, subscribed: false, loading: false }))
        return true
      }

      const reg = await navigator.serviceWorker.ready
      const subscription = await reg.pushManager.getSubscription()

      if (subscription) {
        const endpoint = subscription.endpoint

        // Unsubscribe from browser
        await subscription.unsubscribe()

        // Remove from Directus (uses kscwApi with 401 retry)
        await kscwApi('/web-push/unsubscribe', {
          method: 'POST',
          body: { endpoint },
        })
      }

      setState(s => ({ ...s, subscribed: false, loading: false }))
      return true
    } catch (err) {
      captureApiError(err, { operation: 'usePushNotifications.unsubscribe' })
      toast.error(t('pushUnsubscribeFailed'))
      setState(s => ({ ...s, loading: false }))
      return false
    }
  }, [state.supported, state.loading, state.probing, native, t])

  return {
    ...state,
    subscribe,
    unsubscribe,
  }
}

/** Convert base64url VAPID key to Uint8Array for PushManager.subscribe() */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
