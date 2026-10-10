import { useEffect, useState } from 'react'
import { nativeAppPlatform } from '../../../utils/pwa'
import { detectPlatform, type Platform } from './platform'

function readPlatform(): Platform {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return 'desktop'
  // The native apps count as installed: no install banner, no install steps.
  const standalone =
    nativeAppPlatform() !== null ||
    (navigator as unknown as { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  return detectPlatform({
    ua: navigator.userAgent,
    standalone,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    platform: navigator.platform || '',
  })
}

/** Live platform classification; re-evaluates if the app transitions to standalone. */
export function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>(readPlatform)
  useEffect(() => {
    const mql = window.matchMedia('(display-mode: standalone)')
    const handler = () => setPlatform(readPlatform())
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])
  return platform
}
