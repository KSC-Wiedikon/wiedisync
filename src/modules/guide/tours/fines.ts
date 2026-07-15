import { Gavel } from 'lucide-react'
import type { TourDefinition } from '../types'

export const finesTour: TourDefinition = {
  id: 'fines',
  titleKey: 'guide:tours.fines.title',
  descriptionKey: 'guide:tours.fines.description',
  icon: Gavel,
  section: 'member',
  canAccess: () => true,
  route: '/fines',
  steps: [
    {
      target: '[data-tour="fines-list"]',
      titleKey: 'guide:tours.fines.steps.list.title',
      bodyKey: 'guide:tours.fines.steps.list.body',
      placement: 'top',
    },
    {
      target: '[data-tour="fines-outstanding"]',
      titleKey: 'guide:tours.fines.steps.outstanding.title',
      bodyKey: 'guide:tours.fines.steps.outstanding.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="fines-filter"]',
      titleKey: 'guide:tours.fines.steps.filter.title',
      bodyKey: 'guide:tours.fines.steps.filter.body',
      placement: 'bottom',
    },
  ],
}
