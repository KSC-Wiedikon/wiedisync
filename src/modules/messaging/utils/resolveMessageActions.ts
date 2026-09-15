import type { MessageRow } from '../api/types'

export type MessageAction = 'edit' | 'delete' | 'report'

/**
 * Pure helper — which actions the current user may take on this message.
 * Follows spec §8:
 *   • Self: edit + delete (own). Cannot report own.
 *   • Coach/TR in a team conversation: delete any + report.
 *   • Anyone else (not self): report only.
 *   • Soft-deleted or poll messages: no actions.
 */
export function resolveMessageActions(
  msg: Pick<MessageRow, 'id' | 'sender' | 'type' | 'deleted_at'>,
  currentMemberId: string | null,
  opts: { isTeamModerator: boolean },
): Set<MessageAction> {
  const out = new Set<MessageAction>()
  if (!currentMemberId) return out
  if (msg.deleted_at != null) return out
  if (msg.type === 'poll') return out

  const isSelf = String(msg.sender) === String(currentMemberId)
  if (isSelf) { out.add('edit'); out.add('delete') }
  else {
    if (opts.isTeamModerator) out.add('delete')
    out.add('report')
  }
  return out
}
