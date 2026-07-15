import { CalendarRange } from 'lucide-react'
import type { TourDefinition } from '../types'

export const calendarTour: TourDefinition = {
  id: 'calendar',
  titleKey: 'guide:tours.calendar.title',
  descriptionKey: 'guide:tours.calendar.description',
  icon: CalendarRange,
  section: 'member',
  canAccess: () => true,
  route: '/calendar',
  steps: [
    {
      target: '[data-tour="calendar-view"]',
      titleKey: 'guide:tours.calendar.steps.view.title',
      bodyKey: 'guide:tours.calendar.steps.view.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="calendar-filter"]',
      titleKey: 'guide:tours.calendar.steps.filter.title',
      bodyKey: 'guide:tours.calendar.steps.filter.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="calendar-ical"]',
      titleKey: 'guide:tours.calendar.steps.ical.title',
      bodyKey: 'guide:tours.calendar.steps.ical.body',
      placement: 'bottom',
    },
    {
      target: '[data-tour="calendar-grid"]',
      titleKey: 'guide:tours.calendar.steps.grid.title',
      bodyKey: 'guide:tours.calendar.steps.grid.body',
      placement: 'top',
    },
  ],
}
