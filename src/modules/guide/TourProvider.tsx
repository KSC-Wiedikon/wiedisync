import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  Joyride,
  ACTIONS,
  EVENTS,
  STATUS,
  type EventData,
} from 'react-joyride'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { TourTooltip } from './TourTooltip'
import { TourContext, type TourContextValue } from './tourContext'
import { tourRegistry } from './tours'
import {
  DEFAULT_TOUR_STATE,
  TOUR_STORAGE_KEY,
  type TourDefinition,
  type TourState,
} from './types'

// ── Helpers ──────────────────────────────────────────────────────────

function loadState(): TourState {
  try {
    const raw = localStorage.getItem(TOUR_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_TOUR_STATE }
    return { ...DEFAULT_TOUR_STATE, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_TOUR_STATE }
  }
}

function saveState(state: TourState) {
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Private-mode / quota-exceeded: persistence is best-effort. Swallow so the
    // persistence useEffect can't throw and break render (loadState is guarded
    // the same way).
  }
}

// ── Provider ─────────────────────────────────────────────────────────

interface Props {
  children: ReactNode
}

export function TourProvider({ children }: Props) {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isMobile = useIsMobile()

  const [tourState, setTourState] = useState<TourState>(loadState)
  const [currentTour, setCurrentTour] = useState<TourDefinition | null>(null)
  const [run, setRun] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const startRouteRef = useRef<string | null>(null)

  // Persist state changes
  useEffect(() => {
    saveState(tourState)
  }, [tourState])

  // Route-change cleanup: abort tour if user navigates away mid-tour
  useEffect(() => {
    if (!currentTour || !run) return
    if (startRouteRef.current && location.pathname !== startRouteRef.current) {
      setRun(false)
      setCurrentTour(null)
      setStepIndex(0)
      startRouteRef.current = null
    }
  }, [location.pathname, currentTour, run])

  const availableTours = useMemo(
    () => tourRegistry.filter((t) => t.canAccess(auth)),
    [auth],
  )

  const isTourCompleted = useCallback(
    (tourId: string) => tourState.completed.includes(tourId),
    [tourState.completed],
  )

  const isTourDismissed = useCallback(
    (tourId: string) => tourState.dismissed.includes(tourId),
    [tourState.dismissed],
  )

  const skipTour = useCallback((tourId: string) => {
    setRun(false)
    setCurrentTour(null)
    setStepIndex(0)
    startRouteRef.current = null
    setTourState((prev) => {
      if (prev.dismissed.includes(tourId)) return prev
      return { ...prev, dismissed: [...prev.dismissed, tourId] }
    })
  }, [])

  const completeTour = useCallback((tourId: string) => {
    setRun(false)
    setCurrentTour(null)
    setStepIndex(0)
    startRouteRef.current = null
    setTourState((prev) => ({
      ...prev,
      completed: prev.completed.includes(tourId)
        ? prev.completed
        : [...prev.completed, tourId],
      dismissed: prev.dismissed.filter((id) => id !== tourId),
    }))
  }, [])

  const startTour = useCallback(
    (tourId: string) => {
      // Abort active tour first (concurrent guard)
      if (currentTour) {
        setRun(false)
        setCurrentTour(null)
        setStepIndex(0)
        startRouteRef.current = null
      }

      const tour = tourRegistry.find((t) => t.id === tourId)
      if (!tour) return

      const launch = () => {
        setCurrentTour(tour)
        setStepIndex(0)
        startRouteRef.current = tour.route
        // Wait for render via requestAnimationFrame before starting
        requestAnimationFrame(() => {
          setRun(true)
        })
      }

      if (location.pathname !== tour.route) {
        startRouteRef.current = tour.route
        navigate(tour.route)
        // Give the page time to mount after navigation
        requestAnimationFrame(() => {
          requestAnimationFrame(launch)
        })
      } else {
        launch()
      }
    },
    [currentTour, location.pathname, navigate],
  )

  const resetAllTours = useCallback(() => {
    setRun(false)
    setCurrentTour(null)
    setStepIndex(0)
    startRouteRef.current = null
    setTourState({ ...DEFAULT_TOUR_STATE })
  }, [])

  // Build Joyride steps from current tour, translating title/body keys
  const joyrideSteps = useMemo(() => {
    if (!currentTour) return []
    return currentTour.steps.map((step) => ({
      target: step.target,
      title: step.titleKey,   // Will be translated in TourTooltip via t()
      content: step.bodyKey,  // Will be translated in TourTooltip via t()
      placement: step.placement ?? ('auto' as const),
      skipBeacon: true,
      blockTargetInteraction: !(step.spotlightClicks ?? false),
    }))
  }, [currentTour])

  const handleJoyrideEvent = useCallback(
    (data: EventData) => {
      const { action, index, status, type } = data

      if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
        // Target not found: skip to next step
        setStepIndex(index + (action === ACTIONS.PREV ? -1 : 1))
      } else if (type === EVENTS.TOUR_END) {
        if (status === STATUS.FINISHED) {
          if (currentTour) completeTour(currentTour.id)
        } else if (status === STATUS.SKIPPED) {
          if (currentTour) skipTour(currentTour.id)
        }
        setRun(false)
        setStepIndex(0)
      }
    },
    [currentTour, completeTour, skipTour],
  )

  const value = useMemo<TourContextValue>(
    () => ({
      startTour,
      skipTour,
      completeTour,
      isTourCompleted,
      isTourDismissed,
      availableTours,
      currentTour,
      resetAllTours,
      tourState,
    }),
    [
      startTour,
      skipTour,
      completeTour,
      isTourCompleted,
      isTourDismissed,
      availableTours,
      currentTour,
      resetAllTours,
      tourState,
    ],
  )

  return (
    <TourContext.Provider value={value}>
      {children}
      {currentTour && (
        <Joyride
          steps={joyrideSteps}
          run={run}
          stepIndex={stepIndex}
          continuous
          scrollToFirstStep={!isMobile}
          tooltipComponent={TourTooltip}
          onEvent={handleJoyrideEvent}
          options={{
            overlayColor: isMobile ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.5)',
            zIndex: 10000,
          }}
        />
      )}
    </TourContext.Provider>
  )
}
