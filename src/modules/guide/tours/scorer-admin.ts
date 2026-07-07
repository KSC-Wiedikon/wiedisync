import { UserCog } from 'lucide-react'
import type { TourDefinition } from '../types'

export const scorerAdminTour: TourDefinition = {
  id: 'scorer-admin',
  titleKey: 'guide:tours.scorerAdmin.title',
  descriptionKey: 'guide:tours.scorerAdmin.description',
  icon: UserCog,
  section: 'admin',
  canAccess: (a) => a.isAdmin,
  route: '/admin/scorer-assign',
  steps: [
    {
      target: '[data-tour="season-select"]',
      titleKey: 'guide:tours.scorerAdmin.steps.overview.title',
      bodyKey: 'guide:tours.scorerAdmin.steps.overview.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="auto-assign"]',
      titleKey: 'guide:tours.scorerAdmin.steps.run.title',
      bodyKey: 'guide:tours.scorerAdmin.steps.run.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="team-summary"]',
      titleKey: 'guide:tours.scorerAdmin.steps.summary.title',
      bodyKey: 'guide:tours.scorerAdmin.steps.summary.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="manual-assign"]',
      titleKey: 'guide:tours.scorerAdmin.steps.assign.title',
      bodyKey: 'guide:tours.scorerAdmin.steps.assign.body',
      placement: 'top',
    },
  ],
}
