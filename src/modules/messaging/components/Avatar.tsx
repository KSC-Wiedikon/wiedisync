import { useState } from 'react'
import { assetUrl } from '../../../lib/api'

const SIZE_CLASSES = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-base',
} as const

export type AvatarSize = keyof typeof SIZE_CLASSES

const FALLBACK_PALETTE = [
  'bg-sky-200 text-sky-900 dark:bg-sky-900/60 dark:text-sky-200',
  'bg-emerald-200 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-200',
  'bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200',
  'bg-rose-200 text-rose-900 dark:bg-rose-900/60 dark:text-rose-200',
  'bg-violet-200 text-violet-900 dark:bg-violet-900/60 dark:text-violet-200',
  'bg-teal-200 text-teal-900 dark:bg-teal-900/60 dark:text-teal-200',
]

function hashToPalette(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return FALLBACK_PALETTE[Math.abs(h) % FALLBACK_PALETTE.length]
}

function initialsFrom(alt: string, fallback?: string): string {
  if (fallback && fallback.length > 0) return fallback[0].toUpperCase()
  const parts = alt.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function resolveSrc(src: string | null | undefined): string | null {
  if (!src) return null
  if (/^https?:\/\//.test(src)) return src
  return assetUrl(src)
}

export interface AvatarProps {
  src?: string | null
  alt: string
  size?: AvatarSize
  fallback?: string
  className?: string
}

export default function Avatar({ src, alt, size = 'sm', fallback, className = '' }: AvatarProps) {
  const [errored, setErrored] = useState(false)
  const resolved = resolveSrc(src)
  const showImage = resolved && !errored
  const paletteClass = hashToPalette(alt || fallback || '?')
  const sizeClass = SIZE_CLASSES[size]
  const base = `inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden select-none ${sizeClass} ${className}`

  if (showImage) {
    return (
      <img
        src={resolved}
        alt={alt}
        onError={() => setErrored(true)}
        className={`${base} object-cover`}
      />
    )
  }
  return (
    <span
      aria-label={alt}
      className={`${base} ${paletteClass} font-medium`}
    >
      {initialsFrom(alt, fallback)}
    </span>
  )
}

export interface AvatarGroupProps {
  items: Array<{ src?: string | null; alt: string }>
  max?: number
  size?: AvatarSize
  className?: string
}

export function AvatarGroup({ items, max = 3, size = 'sm', className = '' }: AvatarGroupProps) {
  const visible = items.slice(0, max)
  const extra = items.length - visible.length
  return (
    <span className={`inline-flex items-center ${className}`}>
      {visible.map((it, i) => (
        <span key={i} className={i === 0 ? '' : '-ml-2 ring-2 ring-background rounded-full'}>
          <Avatar src={it.src ?? null} alt={it.alt} size={size} />
        </span>
      ))}
      {extra > 0 && (
        <span className={`-ml-2 ring-2 ring-background inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground ${SIZE_CLASSES[size]} font-medium`}>
          +{extra}
        </span>
      )}
    </span>
  )
}
