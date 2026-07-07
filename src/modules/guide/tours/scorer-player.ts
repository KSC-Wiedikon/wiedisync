import { ClipboardCheck } from 'lucide-react'
import type { TourDefinition } from '../types'

export const scorerPlayerTour: TourDefinition = {
  id: 'scorer-player',
  titleKey: 'guide:tours.scorerPlayer.title',
  descriptionKey: 'guide:tours.scorerPlayer.description',
  icon: ClipboardCheck,
  section: 'member',
  canAccess: () => true,
  route: '/scorer',
  steps: [
    {
      target: '[data-tour="assignment-list"]',
      titleKey: 'guide:tours.scorerPlayer.steps.duty.title',
      bodyKey: 'guide:tours.scorerPlayer.steps.duty.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="scorer-filters"]',
      titleKey: 'guide:tours.scorerPlayer.steps.filters.title',
      bodyKey: 'guide:tours.scorerPlayer.steps.filters.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="delegate-duty"]',
      titleKey: 'guide:tours.scorerPlayer.steps.delegate.title',
      bodyKey: 'guide:tours.scorerPlayer.steps.delegate.body',
      placement: 'bottom',
    },
  ],
}
