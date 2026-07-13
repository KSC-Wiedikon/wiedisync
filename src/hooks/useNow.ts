import { useEffect, useState } from 'react'

/**
 * Current epoch ms, re-rendered on an interval. For relative-time labels
 * ("5 minutes ago") and time-gated UI (a game flipping to read-only at kickoff)
 * that must go stale on their own, without reading the clock during render
 * (react-hooks/purity — `Date.now()` in a render body is an impure call whose
 * result changes unpredictably between renders).
 *
 * The clock is seeded once on mount and then advanced by a timer, so consumers
 * get a stable value within a render pass AND a value that keeps up with real
 * time instead of freezing until some unrelated state change re-renders them.
 *
 * @param intervalMs how often to re-read the clock. 60_000 (default) is right
 *   for minute-granularity labels and time gates; use a smaller value only if
 *   the UI needs sub-minute precision (each tick re-renders the consumer).
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
