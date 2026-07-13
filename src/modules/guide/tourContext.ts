/**
 * Tour context object + its value type.
 *
 * Lives apart from `TourProvider.tsx` so that file only exports the provider
 * COMPONENT — react-refresh/only-export-components (Fast Refresh) requires a
 * module to export either components or non-components, not both. The
 * `useTour()` hook that reads this context is in `useTour.ts`.
 */

import { createContext } from 'react'
import type { TourDefinition, TourState } from './types'

export interface TourContextValue {
  startTour: (tourId: string) => void
  skipTour: (tourId: string) => void
  completeTour: (tourId: string) => void
  isTourCompleted: (tourId: string) => boolean
  isTourDismissed: (tourId: string) => boolean
  availableTours: TourDefinition[]
  currentTour: TourDefinition | null
  resetAllTours: () => void
  tourState: TourState
}

export const TourContext = createContext<TourContextValue | null>(null)
