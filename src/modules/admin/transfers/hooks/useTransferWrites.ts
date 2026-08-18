/**
 * Every write `/admin/transfers` performs, plus the two pieces of transient
 * state a write needs.
 *
 * All three writes go through the Directus ITEMS API rather than a custom
 * endpoint, so Directus records the acting user in `directus_activity` and the
 * revision trail for free (CLAUDE.md → "Audit logging (actor capture)").
 */

import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { usePrompt } from '../../../../components/ConfirmProvider'
import { useAuth } from '../../../../hooks/useAuth'
import { useMutation } from '../../../../hooks/useMutation'
import { memberName } from '../../../../utils/relations'
import { normaliseVisPlayerNo } from '../utils/visTransfer'
import type { TransferMember, TransferStatus } from '../types'

export interface TransferWrites {
  savingId: string | null
  noteDrafts: ReadonlyMap<string, string>
  setNoteDraft: (memberId: string, value: string) => void
  setStatus: (m: TransferMember, next: TransferStatus | null) => Promise<void>
  saveNote: (m: TransferMember, value: string) => Promise<void>
  linkVisPlayer: (m: TransferMember) => Promise<void>
}

export function useTransferWrites(): TransferWrites {
  const { t } = useTranslation('admin')
  const { user } = useAuth()
  const { update } = useMutation('members')
  const prompt = usePrompt()

  // Note drafts live here (not in the row) so typing never triggers a
  // render-phase state write from a prop — the React #301 pattern. They are
  // intentionally never cleared: after a save the draft already equals the
  // server value, so keeping it avoids a flash of the stale row while the
  // invalidated `members` query refetches.
  const [noteDrafts, setNoteDrafts] = useState<Map<string, string>>(new Map())
  // ⚠ A single id, never a Set: one row saves at a time, and every cell's
  // `disabled` is `savingId === id`.
  const [savingId, setSavingId] = useState<string | null>(null)

  const setNoteDraft = useCallback((memberId: string, value: string) => {
    setNoteDrafts((prev) => new Map(prev).set(memberId, value))
  }, [])

  // Legal name, not the nickname: this is an administrative attribution record,
  // the same convention as `confirmed_by_name` in game-scheduling.
  const actorName = memberName(user) || null

  const setStatus = useCallback(async (m: TransferMember, next: TransferStatus | null) => {
    setSavingId(String(m.id))
    try {
      // Both attribution columns are written on EVERY status change, never just
      // on the way in: leaving a stale `transfer_done_at` on a row that is back
      // to pending would assert a completion that no longer holds.
      const payload: Record<string, unknown> = next === 'done'
        ? {
            transfer_status: 'done',
            transfer_done_at: new Date().toISOString(),
            transfer_done_by_name: actorName,
          }
        : { transfer_status: next, transfer_done_at: null, transfer_done_by_name: null }
      // Items API (not a custom endpoint) so Directus records the actor in
      // directus_activity + the revision trail for free.
      await update(m.id, payload)
    } catch {
      toast.error(t('trSaveFailed'))
    } finally {
      setSavingId(null)
    }
  }, [actorName, update, t])

  const saveNote = useCallback(async (m: TransferMember, value: string) => {
    const trimmed = value.trim()
    if (trimmed === String(m.transfer_note ?? '').trim()) return
    setSavingId(String(m.id))
    try {
      await update(m.id, { transfer_note: trimmed || null })
    } catch {
      toast.error(t('trSaveFailed'))
    } finally {
      setSavingId(null)
    }
  }, [update, t])

  /**
   * Hand-link a member to a VIS player number (migration 312) — the escape
   * hatch for the people name matching cannot reach: a married name, a
   * transliteration, a spelling only VIS knows.
   *
   * ⚠ It writes `vis_player_no_manual`, NEVER `vis_player_no`. The checker
   * rewrites `in_vis`/`vis_player_no` for the WHOLE cohort on every run, so a
   * value typed into those columns would quietly disappear at the next sweep;
   * the override lives in a column the sweep reads and never writes.
   *
   * ⚠ Saving also clears `vis_manual_vis_name`, the confirmation the sweep
   * wrote for the PREVIOUS number — otherwise a stale "VIS: …" name would
   * outlive the link it described and vouch for the new one.
   *
   * ⚠⚠ The no-op guard goes through `normaliseVisPlayerNo`. It used to be
   * `next === (m.vis_player_no_manual ?? null)`, comparing a `Number()` result
   * against a value that arrives as a STRING (`vis_player_no_manual` is not in
   * `KEEP_AS_NUMBER`, src/lib/api.ts) — so it never fired, and an admin who
   * opened the prompt on an already-confirmed link and just pressed OK wrote the
   * same number back, wiping the sweep's green "VIS: MUELLER, Anna" confirmation
   * for the amber "unconfirmed" warning while toasting success.
   *
   * Items API, not a custom endpoint, so Directus records the actor for free.
   * `usePrompt`, never a native `prompt()` — CLAUDE.md forbids browser dialogs.
   */
  const linkVisPlayer = useCallback(async (m: TransferMember) => {
    const answer = await prompt({
      title: t('trManualLinkTitle'),
      message: t('trManualLinkMessage', { name: memberName(m) }),
      defaultValue: m.vis_player_no_manual != null ? String(m.vis_player_no_manual) : '',
      placeholder: t('trManualLinkPlaceholder'),
    })
    if (answer === null) return
    const trimmed = answer.trim()
    const next = trimmed ? Number(trimmed) : null
    if (next !== null && (!Number.isInteger(next) || next <= 0)) {
      toast.error(t('trManualLinkInvalid'))
      return
    }
    if (next === normaliseVisPlayerNo(m.vis_player_no_manual)) return
    setSavingId(String(m.id))
    try {
      await update(m.id, { vis_player_no_manual: next, vis_manual_vis_name: null })
      toast.success(next === null ? t('trManualLinkCleared') : t('trManualLinkSaved'))
    } catch {
      toast.error(t('trSaveFailed'))
    } finally {
      setSavingId(null)
    }
  }, [prompt, update, t])

  return { savingId, noteDrafts, setNoteDraft, setStatus, saveNote, linkVisPlayer }
}
