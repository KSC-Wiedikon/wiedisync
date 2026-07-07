import { FileText } from 'lucide-react'
import type { TourDefinition } from '../types'

export const formsTour: TourDefinition = {
  id: 'forms',
  titleKey: 'guide:tours.forms.title',
  descriptionKey: 'guide:tours.forms.description',
  icon: FileText,
  section: 'member',
  canAccess: () => true,
  route: '/forms',
  steps: [
    {
      target: '[data-tour="forms-list"]',
      titleKey: 'guide:tours.forms.steps.list.title',
      bodyKey: 'guide:tours.forms.steps.list.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="forms-fill"]',
      titleKey: 'guide:tours.forms.steps.fill.title',
      bodyKey: 'guide:tours.forms.steps.fill.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="forms-create"]',
      titleKey: 'guide:tours.forms.steps.create.title',
      bodyKey: 'guide:tours.forms.steps.create.body',
      placement: 'bottom',
    },
  ],
}
