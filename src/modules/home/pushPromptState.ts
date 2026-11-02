// "Get reminders on this device" on Home (2026-11-02): only 18 of 571 members
// with a login had push on, so most never saw a deadline reminder outside the
// app. Shown once per device: "Not now" hides it for good, the notifications
// panel keeps the switch.

const STORAGE_KEY = 'wiedisync_push_prompt'

export interface PushPromptSignals {
  /** This browser / app build can do push at all. */
  supported: boolean
  /** The subscription probe has not settled yet. */
  probing: boolean
  subscribed: boolean
  permission: NotificationPermission
  dismissed: boolean
  /** The install banner is up — one banner at a time (on an iPhone, installing comes first). */
  installBannerShown: boolean
  impersonating: boolean
}

/** Pure eligibility check for the push prompt. */
export function shouldShowPushPrompt(s: PushPromptSignals): boolean {
  return s.supported && !s.probing && !s.subscribed && s.permission !== 'denied'
    && !s.dismissed && !s.installBannerShown && !s.impersonating
}

export function readPushPromptDismissed(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw).dismissed === true : false
  } catch {
    return false
  }
}

export function setPushPromptDismissed(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ dismissed: true }))
  } catch {
    /* private mode / storage disabled — the prompt simply shows again */
  }
}
