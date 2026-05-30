import { useEffect, useState } from 'react'
import { detectPlatform, type Platform } from './platform'

function readPlatform(): Platform {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return 'desktop'
  const standalone =
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
