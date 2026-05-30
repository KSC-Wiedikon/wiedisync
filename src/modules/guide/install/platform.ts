export type Platform = 'ios-safari' | 'ios-other' | 'android' | 'desktop' | 'standalone'

export interface PlatformSignals {
  ua: string
  standalone: boolean
  maxTouchPoints: number
  platform: string
}

/** Pure, side-effect-free platform classification. */
export function detectPlatform(s: PlatformSignals): Platform {
  if (s.standalone) return 'standalone'
  const ua = s.ua.toLowerCase()
  const isIOS = /iphone|ipad|ipod/.test(ua) || (s.platform === 'MacIntel' && s.maxTouchPoints > 1)
  if (isIOS) {
    const isOtherBrowser = /crios|fxios|edgios|opios|opt\//.test(ua)
    const isInApp = /fban|fbav|instagram|line\/|gsa|micromessenger/.test(ua)
    return !isOtherBrowser && !isInApp ? 'ios-safari' : 'ios-other'
  }
  if (/android/.test(ua)) return 'android'
  return 'desktop'
}
