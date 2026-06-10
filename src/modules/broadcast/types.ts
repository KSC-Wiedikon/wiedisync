/**
 * Broadcast contract types — mirror the backend (`POST /kscw/activities/:type/:id/broadcast`).
 *
 * Sources of truth:
 *   - Endpoint: directus/extensions/kscw-endpoints/src/index.js (broadcast routes)
 *   - Spec:     Broadcast Plan 01 (B8 frontend hooks + types)
 */

export type ActivityType = 'event' | 'game' | 'training'

export interface BroadcastActivity {
  type: ActivityType
  id: number
  title: string
  start_date?: string
  location?: string
  teamName?: string
  sport?: 'volleyball' | 'basketball' | null
}

export interface BroadcastChannels {
  email?: boolean
  push?: boolean
  /** Event-only. Creates/reuses an activity_chat conversation and posts the message there. */
  inApp?: boolean
}

// Broadcast audience keys — must match the backend VALID_AUDIENCE_STATUSES in
// broadcast-helpers.js. The first four are real participations.status values;
// `unanswered` is a synthetic audience (roster minus everyone who responded).
export type ParticipationStatus =
  | 'confirmed'
  | 'tentative'
  | 'declined'
  | 'waitlisted'
  | 'unanswered'

export interface BroadcastAudience {
  statuses: ParticipationStatus[]
  includeExternals?: boolean
}

export interface BroadcastPayload {
  channels: BroadcastChannels
  audience: BroadcastAudience
  subject?: string
  message: string
}

export interface BroadcastResponse {
  broadcastId: number
  recipientCount: number
  breakdown: { members: number; externals: number }
  delivery: {
    email: { sent: number; failed: number; errors?: Array<{ recipient: string; error: string }> }
    push: { sent: number; failed: number; expired: number }
    in_app?: {
      sent: number
      failed: number
      conversation_id: string | null
      message_id: string | null
    }
  }
  auditFailed?: boolean
}

export interface BroadcastPreviewResponse {
  recipientCount: number
  breakdown: { members: number; externals: number }
  sample: Array<{ name: string; kind: 'member' | 'external' }>
}

export interface BroadcastError {
  code: string
  message: string
  field?: string
  retryAfterSec?: number
}
