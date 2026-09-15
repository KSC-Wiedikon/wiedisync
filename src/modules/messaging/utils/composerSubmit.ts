/**
 * Decide whether a keydown event on the composer textarea should submit.
 * Enter = submit; Shift+Enter = newline (default textarea behavior).
 * Extracted as a pure function so it can be unit-tested without jsdom.
 */
export function shouldSubmitOnKeyDown(
  event: { key: string; shiftKey: boolean; ctrlKey?: boolean; metaKey?: boolean }
): boolean {
  if (event.key !== 'Enter') return false
  if (event.shiftKey) return false
  // Ctrl+Enter or Cmd+Enter also falls through to submit — matches most chat
  // apps. Keep it simple: anything-except-shift+Enter submits.
  return true
}
