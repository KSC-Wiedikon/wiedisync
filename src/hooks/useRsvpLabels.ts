import { useTranslation } from 'react-i18next'
import { useAuth } from './useAuth'

type AnswerStatus = 'confirmed' | 'tentative' | 'declined'

export interface RsvpLabels {
  /** First name of the household member being answered for, or '' when the
   *  login holder is answering for themself. */
  actingName: string
  /** Labels for the three answer buttons. Plain Yes / Maybe / No normally;
   *  while acting they carry the name ("Léon is coming"). */
  answer: Record<AnswerStatus, string>
  /** Labels for a saved status (Confirmed / Maybe / Declined / Waitlisted),
   *  name-bearing while acting. */
  status: Record<AnswerStatus | 'waitlisted', string>
  /** "Answering for {{name}}" caption for surfaces too narrow to put the name
   *  inside the buttons. '' when not acting. */
  answeringFor: string
}

/**
 * ⚠ The anti-mistake device for households (migration 348). While the main
 * account acts for a linked member, that member's NAME goes into the RSVP
 * labels themselves — under the thumb at the moment of the decision. Every
 * RSVP surface reads its labels from here so none can forget it.
 */
export function useRsvpLabels(): RsvpLabels {
  const { t } = useTranslation('participation')
  const { isActingForOther, user } = useAuth()
  const actingName = isActingForOther
    ? (user?.first_name || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || '')
    : ''

  if (actingName) {
    const confirmed = t('rsvpConfirmedFor', { name: actingName })
    const tentative = t('rsvpTentativeFor', { name: actingName })
    const declined = t('rsvpDeclinedFor', { name: actingName })
    return {
      actingName,
      answer: { confirmed, tentative, declined },
      status: { confirmed, tentative, declined, waitlisted: t('waitlisted') },
      answeringFor: t('common:householdAnsweringFor', { name: actingName }),
    }
  }
  return {
    actingName,
    answer: { confirmed: t('yes'), tentative: t('maybe'), declined: t('no') },
    status: {
      confirmed: t('confirmed'),
      tentative: t('tentative'),
      declined: t('declined'),
      waitlisted: t('waitlisted'),
    },
    answeringFor: '',
  }
}
