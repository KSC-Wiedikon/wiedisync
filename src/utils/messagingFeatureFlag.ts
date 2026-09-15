/**
 * Gate for the KSCW messaging feature (Plans 02-06).
 *
 * Resolution order:
 *   1. If VITE_FEATURE_MESSAGING === 'true' → enabled for everyone.
 *   2. Else if VITE_FEATURE_MESSAGING_ALLOWLIST contains the caller's memberId
 *      → enabled for that member only (staged rollout to a test group).
 *   3. Else → disabled.
 *
 * Allowlist format: comma-separated member IDs (e.g. "8,42,180"). Whitespace
 * around commas is tolerated. An empty / unset allowlist means "nobody beyond
 * the global flag."
 *
 * Strict-string match against 'true' so VITE_FEATURE_MESSAGING=1 does not
 * accidentally enable in environments that use numeric truthy values.
 */
export function messagingFeatureEnabled(memberId?: number | string | null): boolean {
  if (import.meta.env.VITE_FEATURE_MESSAGING === 'true') return true
  if (memberId == null || memberId === '') return false
  const raw = import.meta.env.VITE_FEATURE_MESSAGING_ALLOWLIST
  if (!raw) return false
  const allowlist = String(raw).split(',').map(s => s.trim()).filter(Boolean)
  return allowlist.includes(String(memberId))
}
