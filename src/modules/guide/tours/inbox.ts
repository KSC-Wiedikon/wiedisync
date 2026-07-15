import { MessagesSquare } from 'lucide-react'
import type { TourDefinition } from '../types'
import { messagingFeatureEnabled } from '../../../utils/messagingFeatureFlag'

export const inboxTour: TourDefinition = {
  id: 'inbox',
  titleKey: 'guide:tours.inbox.title',
  descriptionKey: 'guide:tours.inbox.description',
  icon: MessagesSquare,
  section: 'member',
  // Gate on the same feature flag the /inbox page enforces, so the tour only
  // appears for members who can actually reach messaging.
  canAccess: (a) => messagingFeatureEnabled(a.user?.id),
  route: '/inbox',
  steps: [
    {
      target: '[data-tour="inbox-new"]',
      titleKey: 'guide:tours.inbox.steps.new.title',
      bodyKey: 'guide:tours.inbox.steps.new.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="inbox-conversations"]',
      titleKey: 'guide:tours.inbox.steps.conversations.title',
      bodyKey: 'guide:tours.inbox.steps.conversations.body',
      placement: 'top',
    },
  ],
}
