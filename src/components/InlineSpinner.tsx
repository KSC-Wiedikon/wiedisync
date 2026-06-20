interface Props {
  /** Extra classes — e.g. a colour (`text-red-700`) or size override. */
  className?: string
}

/**
 * Tiny in-button busy spinner. Inherits `currentColor` (so it matches the
 * surrounding text/button colour) and defaults to 3.5 × 3.5. Used by every
 * "Sync now"-style action button for a consistent busy state. For full-page /
 * section loading use {@link LoadingSpinner} instead.
 */
export default function InlineSpinner({ className = '' }: Props) {
  return (
    <span
      className={`inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      aria-hidden
    />
  )
}
