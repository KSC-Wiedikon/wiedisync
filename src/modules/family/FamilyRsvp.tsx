import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createRecord, fetchItems, updateRecord } from '../../lib/api'
import { invalidateForCollection } from '../../lib/query'
import { usePrompt } from '../../components/ConfirmProvider'
import RsvpAnswerButtons from '../../components/RsvpAnswerButtons'
import { formatDate, formatTime, getDeadlineDate } from '../../utils/dateHelpers'
import type { RsvpStatus } from '../../utils/participationColors'
import type { Participation } from '../../types'
import type { FamilyItem } from './familyAgenda'

/**
 * Yes / Maybe / No for ONE household member on ONE activity, written with that
 * member's acting header (`actAs`) — the parent never switches accounts.
 *
 * Mirrors the card RSVP (ActivityParticipation): deadline lock, guest-tier
 * exclusion, whole-activity row only. Adds what the cards leave to the detail
 * modals: a required decline note is asked for before the write.
 */
export default function FamilyRsvp({ item, onSaved }: { item: FamilyItem; onSaved: () => void }) {
  const { t } = useTranslation('home')
  const prompt = usePrompt()
  const [optimistic, setOptimistic] = useState<RsvpStatus | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const { person } = item

  if (item.excluded) {
    return <p className="text-xs italic text-muted-foreground">{t('familyNotInvited')}</p>
  }

  const locked = item.respondBy ? getDeadlineDate(item.respondBy, item.time) < new Date() : false
  const value = optimistic ?? (item.mine?.status as RsvpStatus | undefined) ?? null

  async function answer(status: RsvpStatus) {
    let note = item.mine?.note ?? ''
    if (status === 'declined' && item.noteRequired && !note.trim()) {
      const v = await prompt({
        title: t('familyNoteTitle'),
        message: t('familyNoteMessage', { name: person.firstName }),
        placeholder: t('familyNotePlaceholder'),
      })
      if (v == null || !v.trim()) return
      note = v.trim()
    }
    const actAs = person.actAs
    setOptimistic(status)
    setSaved(false)
    setBusy(true)
    try {
      if (item.mine) {
        await updateRecord('participations', item.mine.id, { status, note }, { actAs })
      } else {
        try {
          await createRecord('participations', {
            member: person.memberId,
            activity_type: item.kind,
            activity_id: item.id,
            status,
            note,
            guest_count: 0,
            is_staff: false,
          }, { silentOnUnique: true, actAs })
        } catch (err) {
          // A row the list never saw (the auto-decline hook, another device):
          // update it instead — same recovery as useParticipation.
          if (!/has to be unique/i.test(err instanceof Error ? err.message : String(err))) throw err
          const [row] = await fetchItems<Participation>('participations', {
            filter: { _and: [
              { member: { _eq: person.memberId } },
              { activity_type: { _eq: item.kind } },
              { activity_id: { _eq: item.id } },
              { session_id: { _null: true } },
            ] },
            limit: 1,
            actAs,
          })
          if (!row) throw err
          await updateRecord('participations', row.id, { status, note }, { actAs })
        }
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      invalidateForCollection('participations')
      onSaved()
    } catch {
      setOptimistic(null)
      toast.error(t('familySaveError', { name: person.firstName }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1">
      <RsvpAnswerButtons
        compact
        activityType={item.kind}
        activityId={item.id}
        participations={item.participations}
        value={value}
        onSelect={(s) => { void answer(s) }}
        locked={locked}
        loading={busy}
        saved={saved}
        options={item.allowMaybe ? ['confirmed', 'tentative', 'declined'] : ['confirmed', 'declined']}
        hideCoachPresent
      />
      {item.respondBy && !locked && (
        <p className="text-[10px] leading-tight text-muted-foreground/80">
          {t('familyRespondBy')}: {formatDate(item.respondBy)}, {formatTime(item.respondBy) || item.time}
        </p>
      )}
    </div>
  )
}
