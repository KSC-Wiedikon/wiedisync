import { useCallback, useState } from 'react'
import { useIsMobile } from '../../../hooks/useMediaQuery'
import { usePlatform } from './usePlatform'
import {
  computeShouldShow,
  readDismissed,
  readSnoozed,
  setDismissed,
  setSnoozed,
} from './bannerState'

export function useInstallBanner() {
  const isMobile = useIsMobile()
  const platform = usePlatform()
  const [dismissed, setDismissedState] = useState<boolean>(readDismissed)
  const [snoozed, setSnoozedState] = useState<boolean>(readSnoozed)

  const shouldShow = computeShouldShow({ isMobile, platform, dismissed, snoozed })

  const understood = useCallback(() => {
    setDismissed()
    setDismissedState(true)
  }, [])

  const remindLater = useCallback(() => {
    setSnoozed()
    setSnoozedState(true)
  }, [])

  const markInstalled = useCallback(() => {
    setDismissed()
    setDismissedState(true)
  }, [])

  return { shouldShow, platform, understood, remindLater, markInstalled }
}
