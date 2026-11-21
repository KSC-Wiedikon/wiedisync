import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { kscwApi } from '../../../lib/api'
import { apiErrorCode } from '../../../lib/apiErrorCode'
import { useAuth } from '../../../hooks/useAuth'
import type { HallSlot, Team } from '../../../types'

/** Mirrors MAX_MESSAGE in kscw-endpoints/src/hall-plan.js. */
const MAX_MESSAGE = 2000

interface Props {
  /** The teams holding the slot. */
  teams: Team[]
  hallId: string | null
  /** The slot's day this week, YYYY-MM-DD. */
  date: string
  startTime: string
  endTime: string
  slotType: HallSlot['slot_type']
}

const SLOT_TYPE: Record<string, string> = { training: 'training', game: 'game', event: 'event' }

/**
 * "Write to the coaches" on a hall slot: any member can message the coaches and
 * team responsibles of the team holding it. The server sends the mail (POST
 * /kscw/hallenplan/contact) — the leaders' addresses never reach the browser;
 * the sender's goes out as Reply-To, which the hint says. Teams the member
 * leads are left out: they would be writing to themselves.
 */
export default function SlotContactForm({ teams, hallId, date, startTime, endTime, slotType }: Props) {
  const { t } = useTranslation('hallenplan')
  const { coachTeamIds } = useAuth()
  const [openTeam, setOpenTeam] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sentTo, setSentTo] = useState<string[]>([])

  const contactable = teams.filter((tm) => !coachTeamIds.includes(String(tm.id)))
  if (contactable.length === 0 || !date) return null

  const single = contactable.length === 1

  async function send(team: Team) {
    setSending(true)
    try {
      await kscwApi('/hallenplan/contact', {
        method: 'POST',
        body: {
          team: Number(team.id),
          hall: hallId ? Number(hallId) : null,
          date,
          start_time: startTime,
          end_time: endTime,
          slot_type: SLOT_TYPE[slotType] ?? 'other',
          message,
        },
      })
      toast.success(t('contactSent', { team: team.name }))
      setSentTo((s) => [...s, String(team.id)])
      setOpenTeam(null)
      setMessage('')
    } catch (err) {
      const code = apiErrorCode(err)
      const key = code === 'no_recipients' ? 'contactNoRecipients'
        : code === 'rate_limited' ? 'contactRateLimited'
          : code === 'no_sender_email' ? 'contactNoSenderEmail'
            : 'contactFailed'
      toast.error(t(key))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mt-4 space-y-2 border-t border-border pt-3">
      {contactable.map((team) => {
        const id = String(team.id)
        const label = single ? t('contactCoaches') : t('contactCoachesOf', { team: team.name })
        if (openTeam !== id) {
          return (
            <div key={id} className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                icon={<Mail />}
                onClick={() => { setOpenTeam(id); setMessage('') }}
              >
                {label}
              </Button>
              {sentTo.includes(id) && (
                <span className="text-xs text-muted-foreground">{t('contactSentShort')}</span>
              )}
            </div>
          )
        }
        return (
          <div key={id} className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">
              {label}
              <Textarea
                autoFocus
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={MAX_MESSAGE}
                rows={4}
                placeholder={t('contactPlaceholder')}
                className="mt-1.5 font-normal"
              />
            </label>
            <p className="text-xs text-muted-foreground">{t('contactHint')}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                icon={<Mail />}
                loading={sending}
                disabled={sending || !message.trim()}
                onClick={() => void send(team)}
              >
                {t('contactSend')}
              </Button>
              <Button size="sm" variant="ghost" disabled={sending} onClick={() => setOpenTeam(null)}>
                {t('common:cancel')}
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
