import { LayoutGrid } from 'lucide-react'
import type { TourDefinition } from '../types'

export const hallenplanCoachTour: TourDefinition = {
  id: 'hallenplan-coach',
  titleKey: 'guide:tours.hallenplanCoach.title',
  descriptionKey: 'guide:tours.hallenplanCoach.description',
  icon: LayoutGrid,
  section: 'admin',
  canAccess: (a) => a.isCoach || a.isAdmin,
  route: '/admin/hallenplan',
  steps: [
    {
      target: '[data-tour="week-nav"]',
      titleKey: 'guide:tours.hallenplanCoach.steps.overview.title',
      bodyKey: 'guide:tours.hallenplanCoach.steps.overview.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="claim-slot"]',
      titleKey: 'guide:tours.hallenplanCoach.steps.claim.title',
      bodyKey: 'guide:tours.hallenplanCoach.steps.claim.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="slot-types"]',
      titleKey: 'guide:tours.hallenplanCoach.steps.release.title',
      bodyKey: 'guide:tours.hallenplanCoach.steps.release.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="virtual-slots"]',
      titleKey: 'guide:tours.hallenplanCoach.steps.virtual.title',
      bodyKey: 'guide:tours.hallenplanCoach.steps.virtual.body',
      placement: 'bottom',
    },
  ],
}
