import type { ReactNode } from 'react'
import { getTeamColor, trimBBTeamName } from '../utils/teamColors'

interface TeamChipProps {
  team: string
  label?: string
  icon?: ReactNode
  size?: 'xs' | 'sm' | 'md'
  className?: string
}

export default function TeamChip({ team, label, icon, size = 'md', className = '' }: TeamChipProps) {
  const color = getTeamColor(team)
  const text = label ?? trimBBTeamName(team)

  return (
    <span
      // Fixed light-palette team colours can lose their edge on the dark page
      // background; a subtle inset ring keeps the chip defined in dark mode
      // (mirrors FilterChips). Brand bg/text stay untouched.
      // nowrap + max-w-full: a chip never breaks into a two-line pill in a
      // narrow rail; if the track really is too narrow the label ellipsizes
      // and the full name stays in `title`.
      title={text}
      className={`inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full font-semibold dark:ring-1 dark:ring-inset dark:ring-white/20 ${
        size === 'xs' ? 'px-2 py-0.5 text-[10px]' : size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'
      } ${className}`}
      style={{
        backgroundColor: color.bg,
        color: color.text,
        borderColor: color.border,
        borderWidth: '1px',
        borderStyle: 'solid',
      }}
    >
      {icon}
      <span className="min-w-0 truncate">{text}</span>
    </span>
  )
}
