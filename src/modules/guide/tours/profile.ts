import { Settings } from 'lucide-react'
import type { TourDefinition } from '../types'

export const profileTour: TourDefinition = {
  id: 'profile',
  titleKey: 'guide:tours.profile.title',
  descriptionKey: 'guide:tours.profile.description',
  icon: Settings,
  section: 'basics',
  canAccess: () => true,
  route: '/profile',
  steps: [
    {
      target: '[data-tour="profile-contact"]',
      titleKey: 'guide:tours.profile.steps.contact.title',
      bodyKey: 'guide:tours.profile.steps.contact.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="profile-attendance"]',
      titleKey: 'guide:tours.profile.steps.attendance.title',
      bodyKey: 'guide:tours.profile.steps.attendance.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="profile-emails"]',
      titleKey: 'guide:tours.profile.steps.emails.title',
      bodyKey: 'guide:tours.profile.steps.emails.body',
      placement: 'top',
    },
    {
      target: '[data-tour="profile-privacy"]',
      titleKey: 'guide:tours.profile.steps.privacy.title',
      bodyKey: 'guide:tours.profile.steps.privacy.body',
      placement: 'bottom',
    },
  ],
}
