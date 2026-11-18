// Wait a short while for the shared Volleymanager account instead of giving up at once.
//
// Why: the hourly result sweep runs at :35, and the */5 Einsatzliste tick fires at the
// same second. The tick claims the account even when no game is due and lets go a few
// milliseconds later, but whichever cron gets there first wins. From 11.11 to 18.11.2026
// the sweep lost 25 of 42 runs that way: queued result pushes stopped at
// `vm_account_busy` and the opponent-report reads were skipped for the hour.
//
// `heldBy` returns the current holder or null (vmAccountHeldBy in index.js).
// Resolves to true once the account is free, false if it is still held after `maxMs`.
// It does NOT claim: the caller claims right after, and a job that slips in between
// is handled by the caller's normal busy path.
export const VM_ACCOUNT_WAIT_MS = 90 * 1000
export const VM_ACCOUNT_WAIT_STEP_MS = 2 * 1000

export async function waitForVmAccount(heldBy, {
  maxMs = VM_ACCOUNT_WAIT_MS,
  stepMs = VM_ACCOUNT_WAIT_STEP_MS,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const until = now() + maxMs
  while (heldBy()) {
    if (now() >= until) return false
    await sleep(stepMs)
  }
  return true
}
