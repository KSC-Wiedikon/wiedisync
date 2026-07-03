import { useTranslation } from 'react-i18next'
import { Basketball, Volleyball } from '@phosphor-icons/react'
import ConflictBadge from './ConflictBadge'
import type { PositionedSlot } from '../utils/timeGrid'

/** Sport-specific ball icon watermark */
const SlotIcon = ({ sport }: { sport?: string }) => {
  if (sport === 'volleyball') return (
    <Volleyball weight="fill" className="absolute inset-0 m-auto h-[60%] w-[60%] opacity-15" />
  )
  if (sport === 'basketball') return (
    <Basketball weight="fill" className="absolute inset-0 m-auto h-[60%] w-[60%] opacity-15" />
  )
  return null
}

const FREED_COLOR = { bg: '#a7f3d0', text: '#064e3b', border: '#10b981' }
const CLOSURE_COLOR = { bg: '#1f2937', text: '#f87171', border: '#991b1b' }
const FALLBACK_COLOR = { bg: '#6b7280', text: '#ffffff', border: '#4b5563' }
const CLOSURE_PATTERN = /geschlossen|gesperrt|closed/i

/** Sport+type color scheme for hallenplan slots */
const SLOT_COLORS: Record<string, Record<string, { bg: string; text: string; border: string }>> = {
  volleyball: {
    training: { bg: '#4A55A2', text: '#ffffff', border: '#3b4589' },  // KSCW blue
    game:     { bg: '#FFC832', text: '#1a1a1a', border: '#e6b400' },  // KSCW gold
  },
  basketball: {
    training: { bg: '#f97316', text: '#ffffff', border: '#ea580c' },  // orange-500
    game:     { bg: '#FFC832', text: '#1a1a1a', border: '#e6b400' },  // KSCW gold
  },
}

function getSlotColor(sport: string | undefined, slotType: string) {
  const sportColors = SLOT_COLORS[sport ?? '']
  if (!sportColors) return FALLBACK_COLOR
  return sportColors[slotType] ?? FALLBACK_COLOR
}

/** Inline sport icon for slot content */
const SportIcon = ({ sport, className = '' }: { sport?: string; className?: string }) => {
  if (sport === 'volleyball') return (
    <Volleyball weight="regular" className={`inline-block shrink-0 ${className}`} size={12} />
  )
  if (sport === 'basketball') return (
    <Basketball weight="regular" className={`inline-block shrink-0 ${className}`} size={12} />
  )
  return null
}

interface SlotBlockProps {
  positioned: PositionedSlot
  teamName: string
  teamSport?: 'volleyball' | 'basketball'
  hasConflict: boolean
  isAdmin: boolean
  isCoach?: boolean
  coachTeamIds?: string[]
  compact?: boolean
  isBoosted?: boolean
  /** Number of hall columns this slot spans (default 1) */
  hallSpan?: number
  onClick: () => void
}

export default function SlotBlock({ positioned, teamName, teamSport, hasConflict, isAdmin, isCoach = false, coachTeamIds = [], compact = false, isBoosted = false, hallSpan = 1, onClick }: SlotBlockProps) {
  const { t } = useTranslation('hallenplan')
  const typeLabels: Record<string, string> = {
    training: t('typeTraining'),
    game: t('typeGame'),
    event: t('typeEvent'),
    away: t('typeAway'),
    other: '',
  }
  const { slot, top, height, left, width: baseWidth } = positioned
  // When spanning multiple hall columns, multiply the width
  const width = baseWidth * hallSpan
  const isVirtual = !!slot._virtual
  const isAway = !!slot._virtual?.isAway
  const isCancelled = !!slot._virtual?.isCancelled
  const isHallEvent = slot._virtual?.source === 'hall_event'
  const isHallClosure = isHallEvent && CLOSURE_PATTERN.test(slot.label || '')
  const isFreed = !!slot._virtual?.isFreed
  const isClaimed = !!slot._virtual?.isClaimed
  // A real slot with no team = manually created "free" slot
  const isManuallyFree = !isVirtual && !slot.team?.length

  const color = isHallClosure
    ? CLOSURE_COLOR
    : (isFreed || isManuallyFree)
      ? FREED_COLOR
      : isClaimed
        ? getSlotColor(teamSport, slot.slot_type)
        : isHallEvent
          ? { bg: '#e0f2fe', text: '#0c4a6e', border: '#7dd3fc' }
          : getSlotColor(teamSport, slot.slot_type)

  // Freed/claimed/manually-free slots are clickable for coaches; own-team real slots too
  const isOwnTeamSlot = isCoach && slot.team?.length && slot.team.some(t => coachTeamIds.includes(String(t)))
  const clickable = isVirtual || isAdmin || ((isFreed || isClaimed || isManuallyFree) && isCoach) || (isOwnTeamSlot && !isVirtual)

  // Virtual slots get dashed border; claimed slots get dotted border
  const borderStyle = isClaimed ? 'border-dotted' : isVirtual ? 'border-dashed' : ''

  const bgOpacity = (isFreed || isManuallyFree) ? 'cc' : isAway ? '66' : isCancelled ? '88' : 'e6'

  // Games render above other slots when overlapping in the same hall
  // Boosted slots go to z-40 (above everything)
  const isGame = slot.slot_type === 'game'
  const zClass = isBoosted ? 'z-40' : isGame ? 'z-30' : 'z-20'

  const gamePulseClass = isGame && !isFreed && !isClaimed && !isCancelled ? 'animate-game-pulse' : ''

  const awayStripes = isAway
    ? {
        backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 4px, ${color.border}33 4px, ${color.border}33 8px)`,
      }
    : undefined

  // Build tooltip: "Team \u2013 Type \u2013 HH:MM\u2013HH:MM"
  const tooltipParts: string[] = []
  if (teamName) tooltipParts.push(teamName)
  if (typeLabels[slot.slot_type]) tooltipParts.push(typeLabels[slot.slot_type])
  tooltipParts.push(`${slot.start_time?.slice(0, 5)}\u2013${slot.end_time?.slice(0, 5)}`)
  const tooltip = tooltipParts.join(' \u2013 ')

  // Compact mode: colored box with team name + type label inside
  if (compact) {
    const compactShowType = height >= 24
    const compactShowTime = height >= 36

    return (
      <div
        data-tour="slot-types"
        className={`absolute ${zClass} overflow-hidden rounded-sm border-l-2 ${borderStyle} px-0.5 py-px text-[9px] leading-tight shadow-sm ${gamePulseClass} ${
          clickable ? 'cursor-pointer hover:brightness-95' : ''
        }`}
        style={{
          top,
          height: Math.max(height - 1, 4),
          left: `${left}%`,
          width: `calc(${width}% - 1px)`,
          backgroundColor: color.bg + bgOpacity,
          color: color.text,
          borderColor: color.border,
          ...awayStripes,
        }}
        onClick={clickable ? (e) => { e.stopPropagation(); onClick() } : undefined}
        title={tooltip}
      >
        {hasConflict && <ConflictBadge />}
        <SlotIcon sport={teamSport} />
        <span className={`relative truncate font-semibold ${isCancelled && !isFreed ? 'line-through' : ''}`}>
          {(isFreed || isManuallyFree) ? t('slotFreed') : isClaimed ? t('slotClaimed') : typeLabels[slot.slot_type] || slot.label}
        </span>
        {compactShowType && teamName && (
          <div className={`relative flex items-center gap-0.5 truncate opacity-90 ${isCancelled && !isFreed ? 'line-through' : ''}`}>
            <SportIcon sport={teamSport} />
            <span className="truncate">{teamName}</span>
          </div>
        )}
        {compactShowTime && (
          <div className="relative opacity-70">
            <div>{slot.start_time?.slice(0, 5)} -</div>
            <div>{slot.end_time?.slice(0, 5)}</div>
          </div>
        )}
      </div>
    )
  }

  // Full mode
  const showDetails = height >= 48
  const showTime = height >= 36

  return (
    <div
      className={`absolute ${zClass} overflow-hidden rounded-md border-l-4 ${borderStyle} px-1.5 py-0.5 text-xs leading-tight shadow-sm transition-all ${gamePulseClass} ${
        clickable ? 'cursor-pointer hover:brightness-95' : ''
      }`}
      style={{
        top,
        height: height - 2,
        left: `${left}%`,
        width: `calc(${width}% - 2px)`,
        backgroundColor: color.bg + bgOpacity,
        color: color.text,
        borderColor: color.border,
        ...awayStripes,
      }}
      onClick={clickable ? (e) => { e.stopPropagation(); onClick() } : undefined}
      title={tooltip}
    >
      <div className="relative">
        {hasConflict && <ConflictBadge />}
        {/* Freed indicator (hand/grab icon) */}
        {isFreed && (
          <span
            className="absolute -right-0.5 -top-0.5 z-30 flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-white"
            title={t('slotFreed')}
          >
            <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </span>
        )}
        {/* Auto indicator for regular virtual slots */}
        {isVirtual && !isFreed && !isClaimed && (
          <span
            data-tour="virtual-slots"
            className="absolute -right-0.5 -top-0.5 z-30 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white/80 dark:bg-gray-800/80"
            title="Auto"
          >
            <svg className="h-2.5 w-2.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </span>
        )}
        <SlotIcon sport={teamSport} />
        {(isFreed || isManuallyFree) ? (
          <>
            <div className="relative flex items-center gap-1">
              <span className="font-bold uppercase">{t('slotFreed')}</span>
            </div>
            {showTime && (
              <div className="relative mt-0.5 opacity-80">
                <div>{slot.start_time?.slice(0, 5)} -</div>
                <div>{slot.end_time?.slice(0, 5)}</div>
              </div>
            )}
            {showDetails && slot.label && (
              <div className="relative mt-0.5 truncate text-[10px] opacity-70">{slot.label}</div>
            )}
          </>
        ) : isClaimed ? (
          <>
            <div className="relative flex items-center gap-1">
              <span className="truncate font-medium">{t('slotClaimed')}</span>
            </div>
            {showTime && (
              <div className="relative mt-0.5 opacity-80">
                <div>{slot.start_time?.slice(0, 5)} -</div>
                <div>{slot.end_time?.slice(0, 5)}</div>
              </div>
            )}
            {showDetails && teamName && (
              <div className="relative mt-0.5 truncate text-[10px] opacity-70">{teamName}</div>
            )}
          </>
        ) : (
          <>
            <div className="relative flex items-center gap-1">
              <span className={`truncate font-semibold ${isCancelled ? 'line-through' : ''}`}>
                {typeLabels[slot.slot_type] || slot.label}
              </span>
              <SportIcon sport={teamSport} />
            </div>
            {teamName && (
              <div className={`relative mt-0.5 truncate font-medium opacity-90 ${isCancelled ? 'line-through' : ''}`}>
                {teamName}
              </div>
            )}
            {showTime && (
              <div className={`relative mt-0.5 opacity-80 ${isCancelled ? 'line-through' : ''}`}>
                <div>{slot.start_time?.slice(0, 5)} -</div>
                <div>{slot.end_time?.slice(0, 5)}</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
