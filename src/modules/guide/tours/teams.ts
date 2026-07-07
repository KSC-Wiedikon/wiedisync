import { Users } from 'lucide-react'
import type { TourDefinition } from '../types'

export const teamsTour: TourDefinition = {
  id: 'teams',
  titleKey: 'guide:tours.teams.title',
  descriptionKey: 'guide:tours.teams.description',
  icon: Users,
  section: 'member',
  canAccess: () => true,
  route: '/teams',
  steps: [
    {
      target: '[data-tour="teams-list"]',
      titleKey: 'guide:tours.teams.steps.list.title',
      bodyKey: 'guide:tours.teams.steps.list.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="teams-join"]',
      titleKey: 'guide:tours.teams.steps.join.title',
      bodyKey: 'guide:tours.teams.steps.join.body',
      placement: 'bottom',
    },
  ],
}
