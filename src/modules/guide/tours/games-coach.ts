import { CalendarDays } from 'lucide-react'
import type { TourDefinition } from '../types'

export const gamesCoachTour: TourDefinition = {
  id: 'games-coach',
  titleKey: 'guide:tours.gamesCoach.title',
  descriptionKey: 'guide:tours.gamesCoach.description',
  icon: CalendarDays,
  section: 'coach',
  canAccess: (a) => a.isCoach || a.isAdmin,
  route: '/games',
  steps: [
    {
      target: '[data-tour="games-dashboard-tab"]',
      titleKey: 'guide:tours.gamesCoach.steps.dashboard.title',
      bodyKey: 'guide:tours.gamesCoach.steps.dashboard.body',
      placement: 'bottom',
      spotlightClicks: true,
    },
    {
      target: '[data-tour="game-coach-stats"]',
      titleKey: 'guide:tours.gamesCoach.steps.stats.title',
      bodyKey: 'guide:tours.gamesCoach.steps.stats.body',
      placement: 'top',
    },
    {
      target: '[data-tour="game-card"]',
      titleKey: 'guide:tours.gamesCoach.steps.manage.title',
      bodyKey: 'guide:tours.gamesCoach.steps.manage.body',
      placement: 'bottom',
    },
  ],
}
