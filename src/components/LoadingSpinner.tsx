import { useEffect, useState } from 'react'

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  /**
   * Fixed caption shown under the spinner. When omitted (the common case on
   * full-page md/lg spinners) a rotating playful message is shown instead.
   * Pass an explicit label only when the wording matters (e.g. "Loading SVRZ
   * data…").
   */
  label?: string
  /**
   * Real progress 0–100. When provided the gold bar reflects it exactly and the
   * percentage is shown. When omitted the bar auto-climbs toward ~92% so it
   * still feels alive — the spinner unmounts (content takes over) once data
   * lands, so it never needs to visibly hit 100%.
   */
  progress?: number
  /** Show the gold progress bar + %. Defaults to true for md/lg, false for sm. */
  showProgress?: boolean
  /** Rotate playful messages. Defaults to true for md/lg, false for sm. */
  playful?: boolean
}

const sizeMap = {
  sm: 'h-10 w-10',
  md: 'h-24 w-24',
  lg: 'h-32 w-32',
}

// Whimsical brand flavour text — deliberately kept as a single English list
// (translating "Bamboozling" into five languages would defeat the joke). These
// rotate while data loads. Sentence case, one word/phrase each, trailing "…".
const PLAYFUL_MESSAGES = [
  'Fluttering…',
  'Bamboozling…',
  'Spiking the ball…',
  'Chalking the lines…',
  'Pumping up the balls…',
  'Warming up…',
  'Lacing up the shoes…',
  'Reticulating splines…',
  'Untangling the net…',
  'Herding the team…',
  'Polishing the trophy…',
  'Counting the points…',
  'Shuffling the lineup…',
  'Doing a little dance…',
  'Summoning the schedule…',
  'Bouncing around…',
  'Tightening the net…',
  'Rallying the troops…',
]

export default function LoadingSpinner({
  size = 'md',
  label,
  progress,
  showProgress,
  playful,
}: LoadingSpinnerProps) {
  const isSmall = size === 'sm'
  const wantProgress = showProgress ?? !isSmall
  // Playful messages only when no fixed label was requested.
  const wantPlayful = (playful ?? !isSmall) && !label

  // Rotating playful message — steps through the list every 1.6s.
  const [msgIndex, setMsgIndex] = useState(0)
  useEffect(() => {
    if (!wantPlayful) return
    const id = setInterval(() => {
      setMsgIndex((i) => (i + 1) % PLAYFUL_MESSAGES.length)
    }, 1600)
    return () => clearInterval(id)
  }, [wantPlayful])

  // Simulated progress — climbs with diminishing increments toward ~92% when no
  // real `progress` is supplied, so the bar never looks stuck.
  const [simPct, setSimPct] = useState(8)
  const hasRealProgress = typeof progress === 'number'
  useEffect(() => {
    if (!wantProgress || hasRealProgress) return
    const id = setInterval(() => {
      setSimPct((p) => (p >= 92 ? p : p + Math.max(0.5, (92 - p) * 0.12)))
    }, 350)
    return () => clearInterval(id)
  }, [wantProgress, hasRealProgress])

  const pct = hasRealProgress
    ? Math.min(100, Math.max(0, progress as number))
    : simPct

  const caption = label ?? (wantPlayful ? PLAYFUL_MESSAGES[msgIndex] : undefined)

  return (
    <div className={`flex flex-col items-center justify-center ${isSmall ? 'py-8' : 'min-h-[60vh]'}`}>
      <img
        src="/wiedisync_logo.svg"
        alt="Loading…"
        className={`${sizeMap[size]} animate-spin`}
        style={{ animationDuration: '2s' }}
      />

      {caption && (
        <p
          key={caption}
          className="mt-4 animate-fade-in text-sm text-gray-500 dark:text-gray-400"
        >
          {caption}
        </p>
      )}

      {wantProgress && (
        <div className="mt-4 flex w-48 max-w-[60vw] flex-col items-center">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gold-100 dark:bg-gold-400/15">
            <div
              className="h-full rounded-full bg-gold-400 transition-[width] duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="mt-1.5 text-xs font-medium tabular-nums text-gold-600 dark:text-gold-400">
            {Math.round(pct)}%
          </span>
        </div>
      )}
    </div>
  )
}
