import type { Platform } from './platform'

const STORAGE_KEY = 'wiedisync_pwa_install'
const SNOOZE_KEY = 'wiedisync_pwa_install_snoozed'

export interface BannerSignals {
  isMobile: boolean
  platform: Platform
  dismissed: boolean
  snoozed: boolean
}

/** Pure eligibility check for the install banner. */
export function computeShouldShow(s: BannerSignals): boolean {
  return s.isMobile && s.platform !== 'standalone' && !s.dismissed && !s.snoozed
}

export function readDismissed(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    return JSON.parse(raw).dismissed === true
  } catch {
    return false
  }
}

export function setDismissed(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ dismissed: true }))
  } catch {
    /* private mode / storage disabled — ignore */
  }
}

export function readSnoozed(): boolean {
  try {
    return sessionStorage.getItem(SNOOZE_KEY) === '1'
  } catch {
    return false
  }
}

export function setSnoozed(): void {
  try {
    sessionStorage.setItem(SNOOZE_KEY, '1')
  } catch {
    /* ignore */
  }
}
