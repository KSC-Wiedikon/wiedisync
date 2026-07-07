import { Receipt } from 'lucide-react'
import type { TourDefinition } from '../types'

export const expensesTour: TourDefinition = {
  id: 'expenses',
  titleKey: 'guide:tours.expenses.title',
  descriptionKey: 'guide:tours.expenses.description',
  icon: Receipt,
  section: 'member',
  canAccess: () => true,
  route: '/finance/expense',
  steps: [
    {
      target: '[data-tour="expense-upload"]',
      titleKey: 'guide:tours.expenses.steps.upload.title',
      bodyKey: 'guide:tours.expenses.steps.upload.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="expense-iban"]',
      titleKey: 'guide:tours.expenses.steps.iban.title',
      bodyKey: 'guide:tours.expenses.steps.iban.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="expense-submissions"]',
      titleKey: 'guide:tours.expenses.steps.submissions.title',
      bodyKey: 'guide:tours.expenses.steps.submissions.body',
      placement: 'top',
    },
  ],
}
