// src/modules/admin/components/MemberDepartModal.tsx
//
// "Member left" for ONE person — the single-member twin of
// ExplorerBulkDepartModal, reachable from the member's danger zone.
//
// Why it exists at all: departing was only ever entered by scrolling back up to
// the field grid and knowing that `register_status` is the column that means
// "left the club". The danger zone is where an operator looks for "this person
// is out", and the four toggles that used to be its only content are the LOW
// LEVEL switches — flipping "Club membership" off alone leaves the register
// saying they are still a member, with no exit date, and Data Health then
// reports them as "Former members without an exit date".
//
// Everything it writes lives in departMember.ts, shared with the bulk action, so
// the two cannot answer differently.
//
// ⚠ The roster preview is fetched, not guessed. "This also removes them from 2
// current rosters: D2, DU20" is the sentence that stops a mid-season departure
// being entered by somebody who only meant to fix the register. It is also a
// PRECONDITION, not decoration: if the team list cannot be read the button
// stays disabled, because writing the four member columns while silently
// skipping the roster half is the one half-applied outcome worth refusing.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertTriangle, Loader2 } from 'lucide-react'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import DatePicker from '@/components/ui/DatePicker'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { fetchItems } from '../../../lib/api'
import { todayLocal } from '../../../utils/dateHelpers'
import { useConfirm } from '../../../components/ConfirmProvider'
import {
  DEPARTED_ORDERED, alreadyDeparted, buildDepartPatch, departMember,
} from './departMember'

interface Props {
  open: boolean
  onClose: () => void
  memberId: string
  memberName: string
  /** The member record as the detail page holds it. */
  member: Record<string, unknown>
  /** Fired after a successful departure with the patch and the server response. */
  onDeparted: (patch: Record<string, unknown>, updated: Record<string, unknown>) => void
}

/** The active-team rosters this member currently sits on. */
interface RosterPreview {
  activeTeamIds: string[]
  teamNames: string[]
}

export default function MemberDepartModal({
  open, onClose, memberId, memberName, member, onDeparted,
}: Props) {
  const { t } = useTranslation('admin')
  const confirm = useConfirm()

  const [status, setStatus] = useState<string>(() => {
    // A member already carrying a departed status keeps it — re-opening the
    // dialog to correct the DATE must not silently re-classify them.
    const current = String(member.register_status ?? '')
    return DEPARTED_ORDERED.includes(current) ? current : (DEPARTED_ORDERED[0] ?? 'Ehemaliges Mitglied')
  })
  const [exitDate, setExitDate] = useState<string>(() => {
    // An exit date that is ALREADY set is never overwritten: it is usually the
    // real, known leaving date and today is only a guess. Same rule the field
    // grid's prefill follows (ExplorerMemberFields.setField).
    const stored = String(member.austritt ?? '').slice(0, 10)
    return stored || todayLocal()
  })
  const [rosters, setRosters] = useState<RosterPreview | null>(null)
  const [rosterError, setRosterError] = useState(false)
  const [running, setRunning] = useState(false)

  // Roster preview. Two reads (active teams, then this member's rows on them)
  // rather than one filter walking `team.active` — the pattern CLAUDE.md
  // mandates for anything crossing a relation, and it gives us the names for
  // free. A failure disables the apply button (see the ⚠ at the top).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      try {
        const teams = await fetchItems<{ id: string; name: string }>('teams', {
          filter: { active: { _eq: true } },
          fields: ['id', 'name'],
          limit: -1,
        })
        const byId = new Map(teams.map((tm) => [String(tm.id), tm.name]))
        const ids = [...byId.keys()]
        const rows = ids.length
          ? await fetchItems<{ id: string; team: string }>('member_teams', {
            filter: { member: { _eq: memberId }, team: { _in: ids } },
            fields: ['id', 'team'],
            limit: -1,
          })
          : []
        if (cancelled) return
        setRosters({
          activeTeamIds: ids,
          teamNames: rows.map((r) => byId.get(String(r.team)) ?? String(r.team)),
        })
        setRosterError(false)
      } catch {
        if (cancelled) return
        setRosters(null)
        setRosterError(true)
      }
    })()
    return () => { cancelled = true }
  }, [open, memberId])

  const patch = useMemo(() => buildDepartPatch(status, exitDate), [status, exitDate])

  /**
   * Nothing left to do — the four columns already match AND no active roster is
   * left to drop. Both halves matter: a member switched off by the old toggle
   * still sits on every roster, and that IS work.
   */
  const noop = rosters !== null
    && alreadyDeparted(member, patch)
    && rosters.teamNames.length === 0

  const handleApply = useCallback(async () => {
    if (!exitDate) return
    // Two messages rather than one with `count: 0` — i18next resolves 0 to the
    // plural form in English, so a single key would confirm "comes off 0 current
    // rosters", which reads as a bug at exactly the wrong moment.
    const teamNames = rosters?.teamNames ?? []
    const ok = await confirm({
      title: t('explorerDepartConfirmTitle'),
      message: teamNames.length > 0
        ? t('explorerDepartConfirmMessageRosters', {
          name: memberName,
          status,
          date: exitDate.split('-').reverse().join('.'),
          count: teamNames.length,
          teams: teamNames.join(', '),
        })
        : t('explorerDepartConfirmMessage', {
          name: memberName,
          status,
          date: exitDate.split('-').reverse().join('.'),
        }),
      danger: true,
    })
    if (!ok) return

    setRunning(true)
    try {
      // `rosters` is non-null here — the button is disabled until the preview
      // lands, precisely so this call can never run with an empty team list it
      // mistook for "no active teams".
      const { updated, rostersDropped } = await departMember(
        memberId, patch, rosters?.activeTeamIds ?? [],
      )
      onDeparted(patch, updated)
      toast.success(
        rostersDropped > 0
          ? t('explorerDepartAppliedRosters', { name: memberName, count: rostersDropped })
          : t('explorerDepartApplied', { name: memberName }),
      )
      onClose()
    } catch {
      toast.error(t('explorerDepartError'))
    } finally {
      setRunning(false)
    }
  }, [exitDate, confirm, t, memberName, status, rosters, memberId, patch, onDeparted, onClose])

  return (
    <Modal
      open={open}
      onClose={running ? () => { /* a write in flight must finish */ } : onClose}
      title={t('explorerDepartTitle', { name: memberName })}
      size="md"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            {t('explorerDepartWarning')}
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">{t('explorerBulkDepartStatus')}</label>
          <Select value={status} onValueChange={setStatus} disabled={running}>
            <SelectTrigger className="min-h-[44px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEPARTED_ORDERED.map((v) => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">{t('explorerBulkDepartDate')}</label>
          <DatePicker value={exitDate} onChange={(v) => setExitDate(v || '')} disabled={running} />
          <p className="text-xs text-muted-foreground">{t('explorerBulkDepartDateHint')}</p>
        </div>

        <div className="rounded-lg border border-border bg-card p-3 text-sm">
          {rosterError ? (
            <p className="text-muted-foreground">{t('explorerDepartRostersUnavailable')}</p>
          ) : rosters === null ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('explorerDepartRostersLoading')}
            </p>
          ) : rosters.teamNames.length === 0 ? (
            <p className="text-muted-foreground">{t('explorerDepartNoRosters')}</p>
          ) : (
            <p className="text-foreground">
              {t('explorerDepartRosters', {
                count: rosters.teamNames.length,
                teams: rosters.teamNames.join(', '),
              })}
            </p>
          )}
          {noop && (
            <p className="mt-2 text-xs text-muted-foreground">{t('explorerDepartAlready')}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose} disabled={running} className="min-h-[44px]">
            {t('explorerBulkClose')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleApply}
            disabled={running || !exitDate || noop || rosterError || rosters === null}
            className="min-h-[44px]"
          >
            {running && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {t('explorerDepartApply')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
