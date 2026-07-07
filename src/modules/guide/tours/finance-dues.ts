import { Wallet } from 'lucide-react'
import type { TourDefinition } from '../types'

export const financeDuesTour: TourDefinition = {
  id: 'finance-dues',
  titleKey: 'guide:tours.financeDues.title',
  descriptionKey: 'guide:tours.financeDues.description',
  icon: Wallet,
  section: 'member',
  canAccess: () => true,
  route: '/finance/dues',
  steps: [
    {
      target: '[data-tour="payout-iban"]',
      titleKey: 'guide:tours.financeDues.steps.iban.title',
      bodyKey: 'guide:tours.financeDues.steps.iban.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="dues-list"]',
      titleKey: 'guide:tours.financeDues.steps.list.title',
      bodyKey: 'guide:tours.financeDues.steps.list.body',
      placement: 'top',
    },
    {
      target: '[data-tour="dues-pay"]',
      titleKey: 'guide:tours.financeDues.steps.pay.title',
      bodyKey: 'guide:tours.financeDues.steps.pay.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="dues-status"]',
      titleKey: 'guide:tours.financeDues.steps.status.title',
      bodyKey: 'guide:tours.financeDues.steps.status.body',
      placement: 'bottom',
    },
  ],
}
