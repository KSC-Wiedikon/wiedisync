import type { ParticipationBase, ParticipationWithMember, Member } from '../types'
import { asObj } from './relations'

export type WarningLevel = 'red' | 'yellow'
export interface Warning {
  level: WarningLevel
  key: string
  params?: Record<string, unknown>
}

const VB_DEFAULT_MIN = 6
const BB_DEFAULT_MIN = 5

/** Count confirmed non-staff participations */
function countConfirmedPlayers(participations: ParticipationBase[]): number {
  return participations.filter((p) => p.status === 'confirmed' && !p.is_staff).length
}

/** Count confirmed non-staff, non-libero players (volleyball) */
function countConfirmedFieldPlayers(participations: ParticipationWithMember[]): number {
  return participations.filter((p) => {
    if (p.status !== 'confirmed' || p.is_staff) return false
    const positions = asObj<Pick<Member, 'id' | 'position'>>(p.member)?.position ?? []
    return !positions.includes('libero')
  }).length
}

/** Check if any staff member is confirmed */
function hasConfirmedCoach(participations: ParticipationBase[]): boolean {
  return participations.some((p) => p.status === 'confirmed' && p.is_staff)
}

export function getGameWarnings(
  participations: ParticipationWithMember[],
  sport: 'volleyball' | 'basketball',
  minParticipants?: number | null,
): Warning[] {
  const warnings: Warning[] = []

  if (sport === 'volleyball') {
    const min = minParticipants ?? VB_DEFAULT_MIN
    const fieldPlayers = countConfirmedFieldPlayers(participations)
    if (fieldPlayers < min) {
      warnings.push({ level: 'red', key: 'warningIncompleteTeam', params: { count: fieldPlayers, min } })
    }
  } else {
    const min = minParticipants ?? BB_DEFAULT_MIN
    const players = countConfirmedPlayers(participations)
    if (players < min) {
      warnings.push({ level: 'red', key: 'warningIncompleteTeam', params: { count: players, min } })
    }
  }

  if (!hasConfirmedCoach(participations)) {
    warnings.push({ level: 'yellow', key: 'warningNoCoach' })
  }

  return warnings
}

export function getTrainingWarnings(
  participations: ParticipationBase[],
  minParticipants: number | null | undefined,
): Warning[] {
  if (!minParticipants || minParticipants <= 0) return []
  const confirmed = countConfirmedPlayers(participations)
  if (confirmed < minParticipants) {
    return [{ level: 'red', key: 'warningBelowMin', params: { count: confirmed, min: minParticipants } }]
  }
  return []
}

export function getEventWarnings(
  participations: ParticipationBase[],
  minParticipants: number | null | undefined,
): Warning[] {
  if (!minParticipants || minParticipants <= 0) return []
  const confirmed = countConfirmedPlayers(participations)
  if (confirmed < minParticipants) {
    return [{ level: 'red', key: 'warningBelowMin', params: { count: confirmed, min: minParticipants } }]
  }
  return []
}
