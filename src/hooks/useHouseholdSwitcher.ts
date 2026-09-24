/**
 * Open the household account chooser from anywhere in the app shell.
 *
 * The chooser is mounted ONCE (by `HouseholdSwitcherProvider` in Layout); the
 * account bar, the desktop avatar menu and the mobile More sheet all open that
 * single instance instead of each mounting their own modal.
 *
 * The provider component lives in `components/HouseholdSwitcher.tsx` — a module
 * exports either components or non-components (react-refresh / Fast Refresh).
 */

import { createContext, useContext } from 'react'

export interface HouseholdSwitcherContextValue {
  openSwitcher: () => void
}

export const HouseholdSwitcherContext = createContext<HouseholdSwitcherContextValue | null>(null)

const NOOP: HouseholdSwitcherContextValue = { openSwitcher: () => {} }

/** Outside the provider (e.g. a page rendered without the app shell) it is a no-op. */
export function useHouseholdSwitcher(): HouseholdSwitcherContextValue {
  return useContext(HouseholdSwitcherContext) ?? NOOP
}
