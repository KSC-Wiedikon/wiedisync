import { mdiWhistleOutline } from '@mdi/js'

/**
 * Inline whistle SVG — the generic "game" icon across the app (nav tabs, home
 * appointment rows). Cup competitions use a trophy/medal instead; league play
 * uses the whistle.
 *
 * NOTE: do NOT use @mdi/react's <Icon> — its default export resolves to an
 * object (not a component) in the prod bundle, which crashed the home page with
 * React #130. The raw @mdi/js path string is interop-safe.
 */
export default function WhistleIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={mdiWhistleOutline} />
    </svg>
  )
}
